> 原文链接：[with 离开之后：读懂 Python 的上下文管理器 - 码日新 · 每日文章](https://daily.xplanc.org/python/with-离开之后：读懂-Python-的上下文管理器.md)

---

# with 离开之后：读懂 Python 的上下文管理器

写 Python 时，我们几乎每天都在用 `with`：打开文件、加锁、创建数据库连接、临时切换目录。它看起来像一种“语法糖”，但真正有价值的地方在于：**无论代码块如何结束，清理逻辑都能被可靠执行**。

这篇文章从 `with` 的执行规则讲起，带你手写一个上下文管理器，再用 `contextlib` 写出更简洁的实现，最后补上几个容易踩的坑。

## `with` 解决的是什么问题

先看一段典型代码：

```python
f = open("data.txt", "w", encoding="utf-8")
f.write("hello\n")
f.close()
```

如果 `write()` 抛出异常，`close()` 就不会执行。改成 `try/finally` 可以解决：

```python
f = open("data.txt", "w", encoding="utf-8")
try:
    f.write("hello\n")
finally:
    f.close()
```

`with` 做的事情本质上就是把“进入资源”和“退出时清理”这组动作固定下来：

```python
with open("data.txt", "w", encoding="utf-8") as f:
    f.write("hello\n")
```

这里的收益不只是少写几行代码，而是把“必须成对出现”的逻辑绑定在一起，降低遗漏清理步骤的概率。

## 上下文管理协议：`__enter__` 与 `__exit__`

一个对象只要实现了下面两个方法，就可以被 `with` 使用：

- `__enter__(self)`：进入上下文时调用，返回值会绑定给 `as` 后面的变量
- `__exit__(self, exc_type, exc, tb)`：离开上下文时调用，负责清理；如果块内发生异常，异常信息会传进来

可以把 `with` 近似理解为：

```python
manager = EXPR
value = manager.__enter__()
try:
    # 执行 with 块
    ...
except BaseException:
    if not manager.__exit__(exc_type, exc, tb):
        raise
else:
    manager.__exit__(None, None, None)
```

有两个细节值得记住：

1. `as` 拿到的是 `__enter__` 的返回值，不一定是管理器对象本身。
2. `__exit__` 返回 `True` 表示“异常已经处理，不要再向外抛出”；返回 `False` 或 `None`，异常会继续传播。

## 手写一个计时器上下文管理器

下面这个例子可以直接运行，它会统计代码块耗时，并演示异常信息如何传入 `__exit__`：

```python
import time


class Timer:
    def __init__(self, label: str):
        self.label = label
        self.start = 0.0

    def __enter__(self):
        self.start = time.perf_counter()
        print(f"[{self.label}] 开始")
        return self  # 绑定给 as 后的变量

    def __exit__(self, exc_type, exc, tb):
        elapsed = time.perf_counter() - self.start
        if exc_type is None:
            print(f"[{self.label}] 正常结束，用时 {elapsed:.4f}s")
        else:
            print(f"[{self.label}] 异常结束: {exc_type.__name__}: {exc}")
            print(f"[{self.label}] 用时 {elapsed:.4f}s")
        return False  # 不吞掉异常


if __name__ == "__main__":
    with Timer("任务A"):
        total = sum(range(1_000_00))

    try:
        with Timer("任务B"):
            1 / 0
    except ZeroDivisionError:
        print("异常已传播到外层")
```

运行后你会看到两次计时输出：第一次正常结束，第二次虽然块内出错，但清理逻辑依然执行了。这就是上下文管理器最核心的价值。

## 用 `contextlib.contextmanager` 写得更轻量

如果清理逻辑可以用“进入前 / 退出后”来描述，`contextlib.contextmanager` 往往更省事。它把一个生成器函数改造成上下文管理器：`yield` 之前是进入逻辑，`yield` 之后是退出逻辑。

```python
from contextlib import contextmanager
import os


@contextmanager
def pushd(path: str):
    old = os.getcwd()
    os.chdir(path)
    try:
        yield
    finally:
        os.chdir(old)


# 用法
# with pushd("/tmp"):
#     print(os.getcwd())
```

这里有一个关键点：**`yield` 必须放在 `try/finally` 中**。否则块内一旦抛异常，`yield` 后面的恢复代码就不会执行，目录也就切不回去了。

如果需要把资源对象交给 `as` 使用，可以 `yield` 出去：

```python
from contextlib import contextmanager


@contextmanager
def managed_resource(name: str):
    print(f"获取资源: {name}")
    resource = {"name": name}
    try:
        yield resource
    finally:
        print(f"释放资源: {name}")


with managed_resource("db-conn") as r:
    print("使用中:", r["name"])
```

## 同时管理多个资源

需要多个上下文时，可以在一条 `with` 语句里并列写出：

```python
with open("in.txt", "r", encoding="utf-8") as src, \
     open("out.txt", "w", encoding="utf-8") as dst:
    dst.write(src.read())
```

当资源数量在运行时才能确定，或者你希望动态收集上下文时，可以用 `contextlib.ExitStack`：

```python
from contextlib import ExitStack


filenames = ["a.txt", "b.txt", "c.txt"]

with ExitStack() as stack:
    files = [stack.enter_context(open(name, "w", encoding="utf-8")) for name in filenames]
    for i, f in enumerate(files):
        f.write(f"file {i}\n")
# 离开 with 后，所有文件都会按正确顺序关闭
```

`ExitStack` 的好处是：进入了多少个上下文，就会负责退出多少个；中途某一步失败时，已经成功进入的部分也会被清理。

## 常见误区与实践建议

| 场景 | 容易出的问题 | 建议做法 |
| --- | --- | --- |
| 手写类管理器 | `__exit__` 忘记考虑异常参数 | 始终按 `(exc_type, exc, tb)` 处理，默认返回 `False` |
| 生成器管理器 | `yield` 没放进 `try/finally` | 清理逻辑必须写在 `finally` 中 |
| 想吞掉异常 | 随手 `return True` | 只在明确知道如何恢复时才吞异常，并限制异常类型 |
| `as` 的理解偏差 | 以为总是拿到管理器本身 | 记住 `as` 绑定的是 `__enter__` 的返回值 |
| 多资源管理 | 手写多层嵌套，可读性差 | 优先用一条 `with` 管理多个，动态场景用 `ExitStack` |

还有一个容易忽略的点：并不是所有“有关闭方法”的对象都适合作为上下文管理器，但大多数需要成对打开/释放的资源都应该优先支持 `with`。如果你在写库代码，给资源对象实现上下文协议，通常比只提供 `close()` 更稳妥，也更符合 Python 使用者的预期。

## 小结

`with` 的本质不是少写 `finally`，而是把“使用资源”和“释放资源”绑定成一个明确的生命周期。理解它时，抓住三句话就够了：

- `__enter__` 决定进入时做什么，以及 `as` 得到什么；
- `__exit__` 决定离开时如何清理，以及是否吞掉异常；
- `contextlib` 和 `ExitStack` 能帮你用更少的样板代码表达同样的保证。

下次再写文件、锁、连接或临时状态切换时，不妨先问一句：这段逻辑是否应该被包进一个上下文管理器里？很多“偶发的资源泄漏”和“异常后状态没恢复”，都能在这一步被提前消掉。
