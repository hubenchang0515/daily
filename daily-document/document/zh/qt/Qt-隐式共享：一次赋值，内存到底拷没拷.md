> 原文链接：[Qt 隐式共享：一次赋值，内存到底拷没拷 - 码日新 · 每日文章](https://daily.xplanc.org/zh/qt/Qt-隐式共享：一次赋值，内存到底拷没拷.md)

---

# Qt 隐式共享：一次赋值，内存到底拷没拷

把一整个 `QString` 赋给另一个变量，看起来像一次昂贵的深拷贝，在 Qt 里却几乎不花时间。真正的拷贝被推迟到“有人要改它”的那一刻，这就是隐式共享（implicit sharing，也称写时复制 COW）。它让按值传递字符串和容器变得很便宜，但也带来几类隐蔽的坑：刚拿到的指针突然失效、迭代器指向了另一份数据、明明只是读却触发了整块拷贝。下面从一次赋值讲起，说清楚它什么时候共享、什么时候 detach，以及怎样避开那些看不见的副本。

## 一次赋值之后，内存里发生了什么

```cpp
#include <QString>
#include <QDebug>

int main()
{
    auto buf = [](const QString &s) { return s.constData(); };

    QString a = "hello";
    QString b = a;                      // 浅拷贝：只把引用计数加一

    qDebug() << (buf(a) == buf(b));     // true，暂时指向同一块数据

    b[0] = 'H';                         // 写入触发 detach，b 拿到自己的副本

    qDebug() << a;                      // "hello"
    qDebug() << b;                      // "Hello"
    qDebug() << (buf(a) == buf(b));     // false
}
```

`QString b = a;` 并没有复制那几个字符，只是让两个对象指向同一块数据，并把引用计数加一。当 `b[0] = 'H'` 发生时，Qt 发现这块数据不止一个主人，于是先给 `b` 分配一块新内存、把内容拷过去，再修改新内存——这个过程叫 detach（分离）。`a` 因此完全没被影响。

同样的机制不止 `QString`：`QByteArray`、`QList`、`QVector`、`QMap`、`QHash`、`QImage`、`QPixmap` 等大多数 Qt 值类都用了隐式共享。这也是为什么在 Qt 里写 `void f(QString s)` 通常没什么性能问题——按值传进去只是加一次引用计数，只有你在函数里改它才会真正拷贝。

## 哪些操作会 detach

判断规则其实很简单：**只有可能修改数据的操作才会 detach，只读操作不会。**

| 操作 | 是否 detach |
| --- | --- |
| `QString b = a;`（拷贝构造 / 赋值） | 否 |
| `a.at(0)`、`a.constData()`、`a.size()` | 否 |
| `a[0] = 'X'`、`a.data()`、`a += "x"` | 是 |
| 非常量容器上的 `a.begin()` / `a.end()` | 是 |
| `a[0]`（即使只是为了读） | 是 |

最后一行最容易被忽略。`QList` 的非常量 `operator[]` 返回的是 `T&`，编译器必须假设你会改它，所以调用它就会 detach。只读遍历时请用 `at()`：

```cpp
for (int i = 0; i < list.size(); ++i)
    use(list.at(i));    // 不 detach

use(list[0]);           // 即使只是读，也已经拷贝了整份 list
```

如果你的容器是 `const` 引用传进来的，就只能调用 const 版本的 `operator[]`，自然不会误触发拷贝——这是“尽量用 const”在 Qt 里格外有价值的原因。

## 坑一：把 constData() 的指针存起来

`constData()` 返回的指针指向共享缓冲区，只要原对象不被修改、也不被销毁，它就有效。一旦中途发生 detach 或重新分配，这个指针就成了悬空指针：

```cpp
QString s = "abc";
const QChar *p = s.constData();
s += "def";             // 可能重新分配，p 指向的内存已失效
qDebug() << *p;         // 未定义行为
```

更常见的是和 `toUtf8()` 这类返回临时对象的函数一起用：

```cpp
const char *p = str.toUtf8().constData();   // 临时 QByteArray 在分号处就销毁了
qDebug() << p;                              // p 已经悬空
```

正确做法是把临时对象留到用完为止：

```cpp
QByteArray ba = str.toUtf8();
const char *p = ba.constData();
// 在 ba 的生命周期内、且不被修改的前提下使用 p
```

如果只是想打印，直接用 `qDebug() << str` 或 `qDebug() << qUtf8Printable(str)`，让临时对象的生命周期覆盖整条语句，就没有这个问题。

## 坑二：迭代器和写操作交叉

Qt 容器的 STL 风格迭代器在非常量容器上会触发 detach，这带来两个后果：一是意外拷贝，二是迭代器持有的指针可能因为别的副本写入而失效。

```cpp
QList<int> a{1, 2, 3};
QList<int> b = a;       // 共享

auto it = b.begin();    // 非常量迭代器，b 先 detach
*it = 9;                // 改的是 b 自己那份

qDebug() << a;          // (1, 2, 3)
qDebug() << b;          // (9, 2, 3)
```

这里行为符合预期，但代价是 `a` 和 `b` 已经分道扬镳。真正危险的是在持有指针或迭代器的同时，让“另一个副本”发生写入：那份数据一旦 detach，你手里的旧指针仍指向原缓冲区，而它随时可能被释放。规则很简单——**拿到 `data()` / `constData()` 指针或迭代器之后，不要再修改任何共享这份数据的对象**。

## 坑三：容器里的元素还会再 detach 一次

隐式共享可以嵌套，于是“改一个元素”可能触发两层拷贝：

```cpp
QList<QString> a{"foo", "bar"};
QList<QString> b = a;   // 外层 QList 共享，里面的 QString 也共享

b[0][0] = 'F';          // b[0] 非常量，外层先 detach；QString 再 detach

qDebug() << a;          // ("foo", "bar")
qDebug() << b;          // ("Foo", "bar")
```

写 `b[0]` 时，外层 `QList` 分离出自己的数组；紧接着对这个 `QString` 的第 0 个字符赋值，又让这个字符串分离一次。两次拷贝都发生在你看不到的地方。理解这一点，就能解释为什么有时修改“一个副本里的一个字段”，性能和内存表现会比你预期的大得多。

## 想自己写一个 COW 类

如果你的类也持有大块数据，可以借用 Qt 的脚手架：把数据放进继承 `QSharedData` 的类里，再用 `QSharedDataPointer` 持有它。

```cpp
#include <QSharedData>
#include <QSharedDataPointer>

class PointData : public QSharedData {
public:
    int x = 0, y = 0;
};

class Point {
public:
    void setX(int v) { d->x = v; }   // 非常量 -> 会在写入前 detach
    int x() const { return d->x; }
private:
    QSharedDataPointer<PointData> d;
};
```

`QSharedDataPointer::operator->` 的非常量版本会在访问前检查引用计数并按需拷贝，常量版本则不会——隐式共享的这套逻辑，Qt 已经替你封装好了。

## 小结

隐式共享的核心只有一句话：**拷贝是免费的，修改才收费**。由此可以推出几条实用习惯：只读时用 `at()` 和 `constData()`，别用非常量的 `operator[]`；拿到裸指针后别再改原对象，临时对象先存成局部变量再取指针；不要把“按值传参”当成性能问题，真正该盯住的是函数内部那些不经意的写入。搞懂了 detach 发生的时机，那些“指针突然失效”“改 b 却不影响 a”的怪现象，就都有了解释。

## 相关文章

- [Qt 链接报 vtable 未定义，问题常常不在你的代码里](https://daily.xplanc.org/zh/qt/Qt-链接报-vtable-未定义，问题常常不在你的代码里.md)
- [QSettings 写了，重启怎么又没了](https://daily.xplanc.org/zh/qt/QSettings-写了，重启怎么又没了.md)
- [Qt 信号槽：槽函数到底在哪个线程执行](https://daily.xplanc.org/zh/qt/Qt-信号槽：槽函数到底在哪个线程执行.md)

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
