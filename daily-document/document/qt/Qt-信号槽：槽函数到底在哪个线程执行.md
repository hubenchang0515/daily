# Qt 信号槽：槽函数到底在哪个线程执行

“在工作线程里 emit 一下，槽函数就会在工作线程跑吧？”

不一定。Qt 里槽函数在哪个线程执行，不由信号定义在哪个类里决定，而由三件事共同决定：连接类型、发射信号时的当前线程、接收者对象所在线程。搞错这一点，轻则界面卡顿，重则随机崩溃。

## AutoConnection 在发射时判断

`connect` 默认使用 `Qt::AutoConnection`。它的规则很短：

- 发射信号的当前线程与接收者所在线程相同：使用 `DirectConnection`，槽函数立即在发射线程执行。
- 两者不同：使用 `QueuedConnection`，信号被包装成事件，投递到接收者线程的事件队列。

关键在于，这个判断发生在**信号发射时**，而不是 `connect` 调用时。后面调用 `moveToThread()`，连接类型会跟着变。

| 连接类型 | 槽在哪执行 | 是否排队 |
| --- | --- | --- |
| `DirectConnection` | 发射信号的线程 | 否，立即调用 |
| `QueuedConnection` | 接收者所在线程 | 是，需要事件循环 |
| `BlockingQueuedConnection` | 接收者所在线程 | 是，发射线程阻塞等待 |
| `AutoConnection` | 按发射时线程关系决定 | 视情况 |

还要注意，“发射线程”指的是执行 `emit` 那行代码的线程，不是 sender 对象的线程亲和性。通常两者一致；如果不一致，说明已经在跨线程直接调用 `QObject`，这本身就该避免。

## 一个最小可复现例子

下面这个程序让 worker 对象住进子线程，receiver 留在主线程。两者用默认的 `AutoConnection` 连接。

`CMakeLists.txt`：

```cmake
cmake_minimum_required(VERSION 3.16)
project(thread_signal LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_AUTOMOC ON)
find_package(Qt6 REQUIRED COMPONENTS Core)
add_executable(thread_signal main.cpp)
target_link_libraries(thread_signal PRIVATE Qt6::Core)
```

`main.cpp`：

```cpp
#include <QCoreApplication>
#include <QThread>
#include <QTimer>
#include <QDebug>

class Receiver : public QObject {
    Q_OBJECT
public slots:
    void onValue(int v) {
        qDebug() << "slot in" << QThread::currentThread()->objectName()
                 << "value" << v;
    }
};

class Worker : public QObject {
    Q_OBJECT
public slots:
    void start() {
        qDebug() << "emit in" << QThread::currentThread()->objectName();
        emit valueReady(42);
    }
signals:
    void valueReady(int v);
};

int main(int argc, char *argv[]) {
    QCoreApplication app(argc, argv);
    QThread::currentThread()->setObjectName("main");

    Receiver receiver;
    QThread thread;
    thread.setObjectName("worker");

    auto *worker = new Worker;
    worker->moveToThread(&thread);

    QObject::connect(&thread, &QThread::started,
                     worker, &Worker::start);
    QObject::connect(worker, &Worker::valueReady,
                     &receiver, &Receiver::onValue);
    QObject::connect(&thread, &QThread::finished,
                     worker, &QObject::deleteLater);

    thread.start();
    QTimer::singleShot(300, &app, [&] {
        thread.quit();
        thread.wait();
        app.quit();
    });
    return app.exec();
}

#include "main.moc"
```

构建并运行：

```bash
cmake -S . -B build
cmake --build build
./build/thread_signal
```

输出类似：

```text
emit in "worker"
slot in "main" value 42
```

`Worker::start` 在 worker 线程执行，因为它由 `QThread::started` 触发，而 worker 已经 `moveToThread` 过去了。`Receiver` 没有移动，仍住在主线程。于是 `valueReady` 发射时两边线程不同，`AutoConnection` 选择排队，槽函数最终在主线程执行。

## 改成 DirectConnection 会怎样

把连接改成：

```cpp
QObject::connect(worker, &Worker::valueReady,
                 &receiver, &Receiver::onValue,
                 Qt::DirectConnection);
```

输出就会变成：

```text
emit in "worker"
slot in "worker" value 42
```

槽函数直接在 worker 线程里被调用，像一次普通函数调用。这时如果 `onValue` 里访问了 `ui->label` 或其他只能由 GUI 线程碰的对象，程序就可能崩溃。`DirectConnection` 不会帮你切线程，它只是省掉了排队。

## QueuedConnection 不是“自动安全”

排队连接解决了线程切换，但也带来几个约束。

**参数会被拷贝。** 信号参数需要被复制进事件里，所以自定义类型必须可拷贝，并且要让元类型系统认识它。Qt 5 中通常这样写：

```cpp
struct Reading {
    int value;
};
Q_DECLARE_METATYPE(Reading)

// 在建立连接前注册
qRegisterMetaType<Reading>("Reading");
```

信号可以声明为 `void ready(Reading r);`。Qt 6 对信号槽里出现的类型大多会自动注册，但显式注册仍然最稳，尤其是类型名经过 typedef 或位于命名空间时。

**接收者线程必须有事件循环。** 排队信号最终要靠 `QCoreApplication::exec()` 或 `QThread::exec()` 分发。如果继承了 `QThread` 并重写 `run()`，里面却是一个没有 `exec()` 的死循环，那么投递过去的槽永远不会执行。事件不是“另一个线程直接调用”，它只是躺在队列里。

**对象销毁后，未处理的事件会被清理。** 接收者被销毁时，Qt 会断开连接并移除它的待处理事件。但如果连接的是没有上下文对象的 lambda，lambda 捕获的 `this` 或裸指针不会自动失效。更安全的写法是传入上下文对象：

```cpp
connect(worker, &Worker::valueReady, this, [this](int v) {
    label->setText(QString::number(v));
});
```

这样 lambda 会在 `this` 所在线程执行，并且 `this` 销毁时连接自动断开。

## 三个容易踩的坑

**第一，`QThread` 对象本身住在创建它的线程。** 很多人把 worker 的信号连接到 `QThread` 的槽，以为槽会在子线程跑。实际上 `QThread` 对象通常在主线创建，它的线程亲和性仍是主线程。要让代码在子线程执行，接收者必须是已经 `moveToThread` 过去的 worker 对象。

**第二，`AutoConnection` 不等于异步。** 同线程下它就是直接调用，会阻塞发射者。如果槽里做了耗时操作，界面照样卡住。要异步，得换线程，而不是只写一个 `connect`。

**第三，`BlockingQueuedConnection` 不能在同一线程使用。** 它会让发射线程阻塞，等待接收者线程执行完槽。如果两边是同一个线程，就没有线程去执行槽，直接死锁。它只适合明确的跨线程等待，而且要小心接收者线程被其他任务堵住。

## 一条保守的连接准则

- UI 更新统一放在 GUI 线程：worker 发信号，界面对象作接收者，保持默认 `AutoConnection`。
- `DirectConnection` 只用于同线程，或确实能证明线程安全的对象；不要用它“顺便”跨线程。
- lambda 连接尽量带上下文对象，让生命周期和线程归属都明确。
- 跨线程传递自定义类型时，先确认它可拷贝，并完成元类型注册。
- 接收线程要有事件循环；重写 `run()` 时别忘了调用 `exec()`。
- 不要从别的线程直接调用 `QObject` 的方法，用信号槽或 `QMetaObject::invokeMethod` 把调用送回对象所属线程。

信号槽的线程行为并不神秘，记住一句话就够了：**槽函数在哪里执行，看的是发射信号的那一刻，接收者住在哪个线程，以及你选了哪种连接方式。**

---

> 原文链接：[Qt 信号槽：槽函数到底在哪个线程执行](https://daily.xplanc.org/qt/Qt-%E4%BF%A1%E5%8F%B7%E6%A7%BD%EF%BC%9A%E6%A7%BD%E5%87%BD%E6%95%B0%E5%88%B0%E5%BA%95%E5%9C%A8%E5%93%AA%E4%B8%AA%E7%BA%BF%E7%A8%8B%E6%89%A7%E8%A1%8C.md)
