> 原文链接：[C++ 条件变量：wait 为什么必须放在 while 里 - 码日新 · 每日文章](https://daily.xplanc.org/cpp/C++-条件变量：wait-为什么必须放在-while-里.md)

---

# C++ 条件变量：wait 为什么必须放在 while 里

一段看起来毫无问题的生产者—消费者代码，单线程跑一万次都对，压测时却偶尔卡死，或者从空队列里 `pop` 出一个不存在的元素。很多人第一反应是“锁没加对”，但真正的原因往往藏在那行 `cv.wait(lock)` 上。

## 一个会偶发崩溃的队列

先看一段很常见的写法：

```cpp
#include <condition_variable>
#include <mutex>
#include <queue>

std::mutex mtx;
std::condition_variable cv;
std::queue<int> q;

void consumer() {
    std::unique_lock<std::mutex> lock(mtx);
    if (q.empty()) {
        cv.wait(lock);       // 醒来后直接往下走
    }
    int v = q.front();       // q 可能还是空的
    q.pop();
}
```

问题出在 `if`。`cv.wait(lock)` 返回，只代表“线程被唤醒了”，不代表“条件成立了”。它可能因为别的原因醒来，而队列依旧是空的。此时 `q.front()` 就是未定义行为。

正确的骨架只有一种：

```cpp
std::unique_lock<std::mutex> lock(mtx);
cv.wait(lock, [&] { return !q.empty(); });
int v = q.front();
q.pop();
```

带谓词的 `wait` 内部等价于：

```cpp
while (!pred()) {
    wait(lock);
}
```

也就是说，它把“检查条件”和“继续等待”放进了一个循环。这不是风格问题，而是正确性问题。

## 唤醒不等于条件成立

条件变量允许**虚假唤醒**（spurious wakeup）。C++ 标准明确写了：`wait` 可以在没有被 `notify` 的情况下返回。POSIX 的 `pthread_cond_wait` 同样允许这种行为，底层实现出于信号处理、futex 竞争等原因，确实可能提前返回。

所以下面这两种写法都不安全：

```cpp
cv.wait(lock);                    // 醒来就往下走
if (q.empty()) cv.wait(lock);     // 只检查一次
```

它们把“被唤醒”误当成了“条件满足”。而条件变量本身不保存任何状态，它没有记忆，也没有计数器。判断条件是否成立，永远只能看被互斥量保护的那份共享数据。

## 丢失的唤醒：条件变量不会记账

比虚假唤醒更隐蔽的是**丢失唤醒**。它不是 `wait` 提前返回，而是该醒的线程永远醒不过来。

典型场景是把判断条件换成了原子变量，并且不加锁：

```cpp
std::atomic<bool> ready{false};
std::mutex mtx;
std::condition_variable cv;

// 等待方
void waiter() {
    std::unique_lock<std::mutex> lock(mtx);
    while (!ready.load()) {   // 检查时没有持有保护 ready 的锁
        cv.wait(lock);
    }
}
```

时间线可以是这样：

| 时刻 | 等待方 | 通知方 |
| --- | --- | --- |
| t1 | 读到 `ready == false` | |
| t2 | | 执行 `ready = true` |
| t3 | | 调用 `notify_one()`，此时没有等待者 |
| t4 | 进入 `wait`，释放锁并睡眠 | |

通知发生在 `wait` 之前，而条件变量不会把这次通知存起来，于是等待方睡到天荒地老。要避免它，检查条件和进入等待必须是同一个原子动作——这正是 `wait` 在持锁状态下“释放锁并睡眠”的意义。共享状态的读写必须在同一把互斥量下完成，`std::atomic` 替代不了这把锁。

一个容易混淆的点：如果条件确实是在锁内检查的，那么 `if (q.empty()) cv.wait(lock);` 并不会丢失唤醒，因为生产者拿不到锁，无法在“检查”和“等待”之间插入修改。它的问题只是虚假唤醒。丢失唤醒几乎总是来自“没在锁内检查条件”。

## 一份可以直接用的实现

把上面的规则落到代码里，一个带关闭语义的队列大致是这样：

```cpp
#include <condition_variable>
#include <mutex>
#include <queue>

class WorkQueue {
public:
    void push(int v) {
        {
            std::lock_guard<std::mutex> lock(mtx_);
            q_.push(v);
        }
        cv_.notify_one();
    }

    // 返回 false 表示队列已关闭且取空
    bool pop(int& out) {
        std::unique_lock<std::mutex> lock(mtx_);
        cv_.wait(lock, [this] { return !q_.empty() || closed_; });
        if (q_.empty()) {
            return false;
        }
        out = q_.front();
        q_.pop();
        return true;
    }

    void close() {
        {
            std::lock_guard<std::mutex> lock(mtx_);
            closed_ = true;
        }
        cv_.notify_all();
    }

private:
    std::mutex mtx_;
    std::condition_variable cv_;
    std::queue<int> q_;
    bool closed_ = false;
};
```

编译时记得带上线程库：

```bash
g++ -std=c++17 -pthread queue.cpp -o queue
```

几个关键点：

- `closed_` 和 `q_` 由同一把锁保护，谓词里同时检查“有数据”和“已关闭”。
- `close()` 用 `notify_all()`，因为可能有多个消费者在等；只唤醒一个，其余线程会一直睡着。
- `pop()` 在谓词成立后仍要再判断一次 `q_.empty()`，因为“被唤醒”可能是由于关闭，而不是因为有数据。
- `push()` 在解锁之后再 `notify_one()`，避免被唤醒的线程立刻又去抢一把还被占着的锁。

## 几个容易踩的细节

**notify 要不要持锁？** 修改共享状态必须在锁内；`notify` 本身在锁内锁外都正确。锁外通知通常更好，能减少“刚醒就阻塞”的无谓竞争。但不要为了省这一次加锁，把状态修改也挪到锁外。

**`wait_for` 的返回值别忽略。** 带谓词的版本返回 `bool`，表示是条件满足还是超时；不带谓词的版本返回 `std::cv_status`。超时醒来同样要重新检查条件。

**析构时还有线程在等，是未定义行为。** 关闭顺序应该是：置位 `closed_`、`notify_all()`、`join()` 所有线程，最后才让条件变量析构。

**`condition_variable` 只接受 `std::unique_lock<std::mutex>`。** 用 `lock_guard` 编译不过；如果锁的类型不是 `std::mutex`，要用 `std::condition_variable_any`。

**`notify_one` 与 `notify_all` 不是性能选项。** 一个元素配多个消费者时，`notify_all` 会造成惊群，但配合谓词仍然正确；`notify_one` 更省，前提是每次状态变化只需要一个线程处理。关闭、广播类事件则必须用 `notify_all`。

## 小结

条件变量的使用可以压缩成三条规则：

1. 共享状态永远在互斥量保护下读写，别用原子变量绕过锁。
2. 等待永远写成 `cv.wait(lock, pred)`，让“检查—等待”成为循环。
3. 状态改变后通知，关闭时广播，析构前先 `join`。

`wait` 返回只说明线程醒了，不说明世界变了。把这句话记住，大部分偶发的卡死和空指针崩溃，都能在代码审查阶段被拦下来。
