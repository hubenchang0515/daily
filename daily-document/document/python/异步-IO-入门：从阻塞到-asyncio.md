# 异步 IO 入门：从阻塞到 asyncio

写 Python 时，我们常遇到这样的场景：程序大部分时间都在等待网络响应、磁盘读写或数据库查询。如果每个等待都阻塞主线程，CPU 只能干瞪眼。异步 IO 的核心思路就是：**在等待期间把执行权交出去，让程序去处理别的任务**。

## 同步、异步与并发

先理清几个容易混淆的概念：

| 模型 | 特点 | 典型场景 |
| --- | --- | --- |
| 同步阻塞 | 一步做完再做下一步 | 简单脚本、顺序处理 |
| 多线程 | 由操作系统切换线程 | IO 密集，但线程开销大 |
| 多进程 | 绕过 GIL，真并行 | CPU 密集计算 |
| 异步 IO | 单线程内协作式切换 | 高并发网络请求 |

异步 IO 不是“多线程的替代品”，它更适合 **IO 密集型** 任务。对于纯 CPU 计算，多进程仍然更合适。

## 事件循环与协程

asyncio 的核心是事件循环（event loop）。它维护一个任务队列，哪个任务在等待 IO，就先挂起；IO 就绪后再恢复执行。

定义协程使用 `async def`，等待异步操作使用 `await`：

```python
import asyncio

async def hello():
    print("开始")
    await asyncio.sleep(1)
    print("结束")

asyncio.run(hello())
```

`asyncio.sleep(1)` 不会阻塞线程，而是告诉事件循环：“我 1 秒后再继续”。这正是异步的关键。

## 并发执行多个任务

串行 `await` 仍然是排队执行。要并发，使用 `asyncio.gather`：

```python
import asyncio
import time

async def fetch(name: str, delay: float) -> str:
    print(f"{name} 开始")
    await asyncio.sleep(delay)
    print(f"{name} 完成")
    return name

async def main():
    start = time.perf_counter()
    results = await asyncio.gather(
        fetch("A", 1),
        fetch("B", 2),
        fetch("C", 1.5),
    )
    print(results, f"总耗时 {time.perf_counter() - start:.2f}s")

asyncio.run(main())
```

三个任务几乎同时开始，总耗时约 2 秒，而不是 4.5 秒。保存为 `demo.py` 后运行：

```bash
python demo.py
```

## 超时、取消与异常

生产环境中，必须给异步操作设置边界。`asyncio.wait_for` 可以在超时后取消任务：

```python
async def main():
    try:
        await asyncio.wait_for(fetch("慢任务", 5), timeout=2)
    except TimeoutError:
        print("任务超时，已取消")

asyncio.run(main())
```

注意：超时取消的是协程，如果协程内部持有连接或文件句柄，应在 `finally` 中释放资源。Python 3.11+ 可以直接捕获内置的 `TimeoutError`。

## 三个常见坑

1. **在协程里调用阻塞函数**。例如 `requests.get()`、`time.sleep()` 会卡住整个事件循环。解决办法是丢到线程池：

   ```python
   import asyncio
   import requests

   async def get_url(url: str):
       return await asyncio.to_thread(requests.get, url, timeout=5)
   ```

2. **忘记 `await`**。调用协程函数只会返回协程对象，不会执行。看到 `RuntimeWarning: coroutine was never awaited` 就要检查。

3. **以为异步等于多核并行**。事件循环运行在单线程中，CPU 密集任务请用 `multiprocessing` 或 `concurrent.futures.ProcessPoolExecutor`。

## 什么时候该用异步

判断标准很简单：**任务是否在等 IO，且并发量是否较大**。爬虫、API 网关、WebSocket 服务、批量数据库查询都适合；图像处理、数值计算则不适合。

如果是新项目，可以从 `asyncio` 标准库起步；需要 HTTP 客户端时再引入 `aiohttp` 或 `httpx`。关键是先把“等待时不占着线程”这个思维建立起来，剩下的 API 都是围绕它展开的。

---

> 原文链接：[异步 IO 入门：从阻塞到 asyncio](https://daily.xplanc.org/python/%E5%BC%82%E6%AD%A5-IO-%E5%85%A5%E9%97%A8%EF%BC%9A%E4%BB%8E%E9%98%BB%E5%A1%9E%E5%88%B0-asyncio.md)
