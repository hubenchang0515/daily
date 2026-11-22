> 原文链接：[QSettings 写了，重启怎么又没了 - 码日新 · 每日文章](https://daily.xplanc.org/zh/qt/QSettings-写了，重启怎么又没了.md)

---

# QSettings 写了，重启怎么又没了

很多人第一次用 Qt 写配置，都会经历这样的困惑：明明调用了 `setValue()`，界面上也显示保存成功，可程序一重启，设置又回到了默认值。

这类问题通常不是 `QSettings` 坏了，而是几个细节没对齐：**写到了哪里、什么时候真正落盘、读的是不是同一份、键名和类型是否一致**。

## 先打印 fileName()，别猜它写哪了

`QSettings` 的默认存储位置和两个名字有关：

```cpp
QCoreApplication::organizationName()
QCoreApplication::applicationName()
```

如果这两个值没设置，或者在不同版本里改过，`QSettings` 就可能写到另一个位置。

建议在 `main.cpp` 里尽早设置：

```cpp
#include <QApplication>
#include <QCoreApplication>
#include <QSettings>
#include <QDebug>

int main(int argc, char *argv[])
{
    QCoreApplication::setOrganizationName("ExampleSoft");
    QCoreApplication::setApplicationName("NoteBook");

    QApplication app(argc, argv);

    QSettings settings;
    qInfo() << "Settings file:" << settings.fileName();

    return app.exec();
}
```

`fileName()` 会把实际使用的路径打印出来。不同平台上，它可能是文件路径，也可能是注册表键路径：

| 平台 | 常见位置 |
|---|---|
| Windows | `HKEY_CURRENT_USER\Software\ExampleSoft\NoteBook` |
| macOS | `~/Library/Preferences/...plist`，可能受 bundle identifier 影响 |
| Linux | `$XDG_CONFIG_HOME/ExampleSoft/NoteBook.conf` 或 `~/.config/ExampleSoft/NoteBook.conf` |

调试配置丢失问题时，第一步不是加日志说“保存成功”，而是把这个路径打出来，确认写入和读取指向同一个地方。

另外要注意：`QSettings` 对象如果在全局静态变量里创建，可能早于这些名字设置完成。更稳妥的做法是把配置访问封装起来，第一次使用时再创建实例。

## setValue() 不等于立刻写进磁盘

`setValue()` 只是把值放进 `QSettings` 的缓存，并不保证马上写入永久存储。正常情况下，对象析构时会写入；但如果你依赖析构，异常退出、崩溃、被强杀，都可能让配置来不及落盘。

保存关键配置时，建议显式调用 `sync()`，并检查状态：

```cpp
#include <QSettings>
#include <QDebug>

bool saveTheme(const QString &theme)
{
    QSettings settings;
    settings.setValue("UI/theme", theme);
    settings.sync();

    if (settings.status() != QSettings::NoError) {
        qWarning() << "Failed to save settings, status ="
                   << settings.status()
                   << "file =" << settings.fileName();
        return false;
    }

    return true;
}
```

这里有个容易忽略的点：`setValue()` 没有返回值，不会告诉你保存失败。`QSettings::status()` 才会告诉你有没有权限问题、格式问题等。

尤其在下面几种场景里，`sync()` 很值得加：

- 设置窗口点击“确定”后立刻关闭进程；
- 配置写入后马上启动子进程读取；
- 多个进程或窗口都可能改配置；
- 程序运行在权限受限的安装目录、容器或沙盒中。

## 多个 QSettings 对象别互相打架

下面这种代码看起来没什么问题，但容易埋坑：

```cpp
void MainWindow::saveState()
{
    QSettings s;
    s.setValue("MainWindow/geometry", saveGeometry());
}

void PreferencesDialog::saveState()
{
    QSettings s;
    s.setValue("UI/language", ui.languageCombo->currentData());
}
```

如果两个对象持有旧缓存，又先后写入、同步，就可能出现“我保存的还在，他保存的没了”的错觉。更推荐把配置访问集中到一个地方，比如一个 `SettingsService`：

```cpp
class SettingsService
{
public:
    static QString theme()
    {
        QSettings s;
        return s.value("UI/theme", "system").toString();
    }

    static void setTheme(const QString &theme)
    {
        QSettings s;
        s.setValue("UI/theme", theme);
        s.sync();
    }
};
```

这不是说一个程序里只能有一个 `QSettings` 对象，而是说：**同一份配置，最好只有一套读写入口**。这样键名、默认值、类型转换和同步策略都能统一。

## 键名、分组和类型要对得上

`QSettings` 的键支持用 `/` 分组：

```cpp
QSettings s;
s.setValue("UI/theme", "dark");
s.setValue("UI/language", "zh_CN");
```

等价于：

```cpp
QSettings s;
s.beginGroup("UI");
s.setValue("theme", "dark");
s.setValue("language", "zh_CN");
s.endGroup();
```

两种方式混用时，只要最终键一致，通常没问题。但团队项目里建议统一一种写法，避免拼错。

还有几个常见误区：

1. **不要依赖大小写差异区分配置项。**  
   不同平台上行为可能有差异，统一使用固定命名风格，例如 `UI/theme`、`Network/proxyHost`。

2. **`value(key, defaultValue)` 不会把默认值写回配置文件。**  
   它只是读取时返回一个默认值。

3. **枚举最好存字符串，而不是裸整数。**  
   如果以后调整枚举顺序，旧配置里的 `1` 可能就变成了另一种含义。

```cpp
enum class Theme {
    System,
    Light,
    Dark
};

QString themeToString(Theme theme)
{
    switch (theme) {
    case Theme::System: return "system";
    case Theme::Light:  return "light";
    case Theme::Dark:   return "dark";
    }
    return "system";
}

Theme themeFromString(const QString &text)
{
    if (text == "light") return Theme::Light;
    if (text == "dark")  return Theme::Dark;
    return Theme::System;
}
```

这样配置文件里至少是人能看懂的 `"dark"`，排查问题会轻松很多。

## 升级后读不到旧配置：记得迁移

如果你在某次升级中改了组织名、应用名，或者从默认存储改成 INI 文件，老用户就会“配置全丢”。

升级时可以做一次迁移：

```cpp
#include <QSettings>
#include <QDebug>

void migrateSettings()
{
    QSettings oldSettings("OldSoft", "OldNoteBook");
    QSettings newSettings;

    const QStringList keys = {"UI/theme", "UI/language", "MainWindow/geometry"};

    for (const QString &key : keys) {
        if (!newSettings.contains(key) && oldSettings.contains(key)) {
            newSettings.setValue(key, oldSettings.value(key));
        }
    }

    newSettings.sync();

    if (newSettings.status() != QSettings::NoError) {
        qWarning() << "Settings migration failed:" << newSettings.status();
    }
}
```

迁移时不要急着 `oldSettings.clear()`。先让新版本跑一段时间，确认用户配置确实读到了，再考虑清理旧数据。

## 如果你想要“看得见”的 ini 文件

有些工具希望配置跟着程序目录走，于是会这样写：

```cpp
QSettings s("config.ini", QSettings::IniFormat);
```

这确实会生成 `config.ini`，但要注意：程序安装到 `C:\Program Files` 或 `/usr/share` 这类目录后，普通用户通常没有写权限。

更稳的做法是放到用户可写目录：

```cpp
#include <QDir>
#include <QSettings>
#include <QStandardPaths>

QString settingsPath()
{
    QString dir = QStandardPaths::writableLocation(
        QStandardPaths::AppConfigLocation
    );

    QDir().mkpath(dir);
    return dir + "/settings.ini";
}

QSettings s(settingsPath(), QSettings::IniFormat);
```

这样既方便用户备份、检查配置，也不会因为权限问题保存失败。

## 排查清单

遇到“保存后又没了”，按这个顺序查：

1. 打印 `settings.fileName()`，确认写入和读取是同一个位置。
2. 检查组织名、应用名是否在创建 `QSettings` 前设置好。
3. 保存后调用 `sync()`，并检查 `status()`。
4. 确认没有多个对象同时持有旧缓存并互相覆盖。
5. 检查打包、升级后是否改过配置路径。
6. 如果用手写 INI 路径，确认目标目录真的可写。
7. 读取时确认键名、分组、类型都一致。

`QSettings` 很适合保存窗口位置、语言、主题、最近文件这类轻量配置。但它不是数据库，也不会帮你处理所有并发和迁移问题。把路径、同步和键名管理好，配置丢失这种问题基本就会从“玄学”变成一次普通的日志排查。

## 相关文章

- [Qt 链接报 vtable 未定义，问题常常不在你的代码里](https://daily.xplanc.org/zh/qt/Qt-链接报-vtable-未定义，问题常常不在你的代码里.md)
- [Qt 信号槽：槽函数到底在哪个线程执行](https://daily.xplanc.org/zh/qt/Qt-信号槽：槽函数到底在哪个线程执行.md)

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
