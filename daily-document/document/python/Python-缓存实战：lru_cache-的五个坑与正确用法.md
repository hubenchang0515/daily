# Python 缓存实战：lru_cache 的五个坑与正确用法

`lru_cache` 是 Python 标准库里最容易被随手加上的优化之一。给一个慢函数套上装饰器，命中率看起来也不错，于是代码上线。直到某天发现内存只涨不降，或者接口返回了旧数据，才回头检查这个装饰器。

它确实好用，但它的行为边界比多数人以为的要窄。下面这五个坑，基本覆盖了日常使用中最容易出问题的地方。

## 先搞清楚它缓存了什么

`lru_cache` 的本质是：用**位置参数和关键字参数拼出来的键**去查一个字典，命中就直接返回旧结果，未命中才执行函数体。

```python
from functools import lru_cache

@lru_cache(maxsize=128)
def area(width, height):
    print(f"计算 {width}x{height}")
    return width * height

area(3, 4)                # 计算 3x4
area(3, 4)                # 命中，无输出
area(width=3, height=4)   # 计算 3x4
area(height=4, width=3)   # 又计算一次

print(area.cache_info())
# CacheInfo(hits=1, misses=3, maxsize=128, currsize=3)
```

三个基础事实：

- 所有参数必须可哈希，传 `list`、`dict`、`set` 会在调用时直接抛 `TypeError`。
- 默认 `typed=False`，`f(3)` 和 `f(3.0)` 会共用一条缓存；需要区分类型时写 `@lru_cache(typed=True)`。
- `maxsize` 取 2 的幂时，LRU 淘汰的效率最好；`maxsize=None`（或 3.9+ 的 `@cache`）表示不淘汰，缓存会一直长。

## 坑一：关键字参数的写法会改变缓存键

上面的输出已经说明了问题：`area(3, 4)`、`area(width=3, height=4)`、`area(height=4, width=3)` 是三个不同的键。

| 调用 | 缓存键（简化） | 是否命中 |
| --- | --- | --- |
| `area(3, 4)` | `(3, 4)` | 首次 |
| `area(width=3, height=4)` | `(kwd_mark, 'width', 3, 'height', 4)` | 否 |
| `area(height=4, width=3)` | `(kwd_mark, 'height', 4, 'width', 3)` | 否 |
| `area(3, 4)` | `(3, 4)` | 是 |

同一个函数，调用方写法不统一，缓存就会被拆成多份。更隐蔽的情况是外层封装把参数从位置改成关键字，命中率瞬间归零，但代码看起来完全正常。

**建议**：对需要缓存的函数，在团队内约定一种调用风格；或者在函数入口把参数归一化，再用一个内部函数做真正的缓存。

## 坑二：可变对象会让缓存返回旧结果

```python
from functools import lru_cache

class Query:
    def __init__(self, text):
        self.text = text

@lru_cache(maxsize=8)
def run(q):
    return q.text.upper()

q = Query("select 1")
print(run(q))   # SELECT 1
q.text = "select 2"
print(run(q))   # 仍然是 SELECT 1
```

`Query` 没有定义 `__hash__`，默认按对象身份哈希。改 `q.text` 不会改变缓存键，缓存自然不知道结果已经过期。

这不是 `lru_cache` 的 bug，而是所有"按值缓存"都要面对的问题：**缓存假设输入不变**。实践中的做法是只缓存不可变输入，把真正影响结果的字段拆成参数：

```python
@lru_cache(maxsize=1024)
def run_text(text: str) -> str:
    return text.upper()

print(run_text(q.text))
```

如果确实要缓存可变对象，就必须在修改对象时手动 `cache_clear()`，或者引入版本号、时间戳一类的字段参与键的构造。

## 坑三：装饰实例方法，等于给对象判了"无期"

这是最典型的内存泄漏来源：

```python
class Report:
    def __init__(self, name):
        self.name = name

    @lru_cache(maxsize=None)
    def render(self):
        return f"<h1>{self.name}</h1>"
```

装饰器作用在类属性上，缓存是**整个类共享**的，而键里包含 `self`。也就是说，缓存会强引用每一个调用过 `render()` 的实例，实例永远不会被回收。

用 `weakref` 验证一下：

```python
import gc, weakref

r = Report("年报")
r.render()
ref = weakref.ref(r)

del r
gc.collect()
print(ref())   # 仍然存在，被缓存持有

Report.render.cache_clear()
gc.collect()
print(ref())   # None
```

修复方式是把缓存放到模块级纯函数上，让键只包含真正影响结果的数据：

```python
@lru_cache(maxsize=1024)
def _render(name: str) -> str:
    return f"<h1>{name}</h1>"

class Report:
    def __init__(self, name: str):
        self.name = name

    def render(self) -> str:
        return _render(self.name)
```

如果缓存的是无参属性，用 `functools.cached_property` 更合适：结果存在实例自己的 `__dict__` 里，实例销毁时缓存一起消失。需要按参数缓存实例方法，可以考虑 `cachetools.cachedmethod`，它把缓存挂在实例上，不会反向持有对象。

另外别忘了：缓存同样强引用**参数**。用 `maxsize=None` 缓存用户输入、大文件内容或 ORM 对象，本质上是在写一个没有上限的字典。

## 坑四：async def 不能被直接缓存

```python
import asyncio
from functools import lru_cache

@lru_cache(maxsize=None)
async def fetch(url: str) -> str:
    await asyncio.sleep(0.1)
    return f"ok:{url}"

async def main():
    await fetch("https://example.com")
    await fetch("https://example.com")   # RuntimeError

asyncio.run(main())
```

第二次调用命中了缓存，返回的是**同一个协程对象**，而协程只能被 await 一次，于是抛出：

```text
RuntimeError: cannot reuse already awaited coroutine
```

`lru_cache` 缓存的是"调用产生的协程"，不是"协程执行完的结果"。正确做法是缓存结果，或者缓存正在执行的 `Task`：

```python
import asyncio

_cache: dict[str, str] = {}
_pending: dict[str, asyncio.Task] = {}

async def fetch(url: str) -> str:
    if url in _cache:
        return _cache[url]

    task = _pending.get(url)
    if task is None:
        task = asyncio.create_task(_do_fetch(url))
        _pending[url] = task

    try:
        result = await task
    finally:
        _pending.pop(url, None)

    _cache[url] = result
    return result
```

这样并发请求同一个 URL 时只会真正发起一次调用。注意这段代码只适用于单事件循环；跨线程或跨循环请直接用 `async-lru` 的 `@alru_cache`。

## 坑五：没有 TTL，清理还是全局的

`lru_cache` 不支持过期时间，参数里没有 `ttl`。想失效只能手动调用 `cache_clear()`，而它是**全局**的：

```python
@lru_cache(maxsize=128)
def get_config(key):
    ...

get_config.cache_clear()   # 所有 key 一起清空
```

如果业务需要"60 秒后自动过期"，标准库帮不上忙，可以换 `cachetools`：

```python
from cachetools import TTLCache, cached

cache = TTLCache(maxsize=1024, ttl=60)

@cached(cache)
def get_config(key):
    ...
```

需要跨进程、持久化或更大容量时，再考虑 `diskcache` 这类方案。

## 并发下它只保证字典安全

`lru_cache` 是线程安全的，但这个"安全"只针对内部字典：它不会因为并发读写而崩溃。它**不保证函数只执行一次**。官方文档明确说明，如果另一个线程在首次调用完成并写入缓存之前发起调用，函数可能被重复执行。

```python
import time
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

calls = 0

@lru_cache(maxsize=None)
def slow(x):
    global calls
    calls += 1
    time.sleep(0.2)
    return x * 2

with ThreadPoolExecutor(max_workers=8) as pool:
    list(pool.map(slow, [1] * 8))

print(calls)   # 通常会大于 1
```

对幂等的纯函数，重复计算只是浪费；但对"扣库存""发消息"这类有副作用的操作，就不能靠 `lru_cache` 做单飞。需要严格只执行一次时，自己加锁，或用 `Task` / `Future` 做请求合并。

## 怎么选

| 场景 | 推荐做法 |
| --- | --- |
| 纯函数、参数可哈希、结果稳定 | `@lru_cache(maxsize=N)` |
| 无参实例属性 | `functools.cached_property` |
| 实例方法带参数 | 模块级纯函数 + 不可变键，或 `cachetools.cachedmethod` |
| 异步函数 | `async-lru` 的 `@alru_cache`，或缓存 `Task` |
| 需要过期时间 | `cachetools.TTLCache`、`diskcache` |
| 缓存大对象、可重算 | `weakref.WeakValueDictionary`，或干脆不缓存 |

## 小结

- 缓存键由参数写法决定，位置参数和关键字参数不是一回事。
- 只缓存不可变输入；可变对象改了属性，缓存不会知道。
- 不要在类里直接装饰实例方法，`self` 会被缓存长期持有。
- `async def` 缓存的是协程对象，第二次 await 必然报错。
- 没有 TTL，`cache_clear()` 是全局操作。
- 线程安全不等于只执行一次，有副作用时请自己控制并发。

把这些边界想清楚，`lru_cache` 才是那个"一行就能提速"的工具，而不是下一场内存泄漏的起点。

---

> 原文链接：[Python 缓存实战：lru_cache 的五个坑与正确用法](https://daily.xplanc.org/python/Python-%E7%BC%93%E5%AD%98%E5%AE%9E%E6%88%98%EF%BC%9Alru_cache-%E7%9A%84%E4%BA%94%E4%B8%AA%E5%9D%91%E4%B8%8E%E6%AD%A3%E7%A1%AE%E7%94%A8%E6%B3%95.md)
