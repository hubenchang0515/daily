> 原文链接：[Kotlin 协程：被 catch 吞掉的取消 - 码日新 · 每日文章](https://daily.xplanc.org/zh/kotlin/Kotlin-协程：被-catch-吞掉的取消.md)

---

# Kotlin 协程：被 catch 吞掉的取消

一次“取消明明调用了却没停下来”的排查，最后往往不是 `cancel()` 写错了，而是某段 `try/catch` 把取消信号当普通异常处理掉了。协程的取消靠 `CancellationException` 传递，而它恰好是 `Exception` 的子类，会被宽泛的 `catch (e: Exception)` 和 `runCatching` 顺手接住。本文从可复现的例子出发，解释这次吞掉到底改变了什么，以及怎样写才能让取消和异常各走各的路。

## 一次“取消没生效”的排查

先看一段看起来很正常的代码。它循环执行任务，每轮用 `delay` 挂起，外面在 100 毫秒后取消：

```kotlin
import kotlinx.coroutines.*

fun main() = runBlocking {
    val job = launch {
        repeat(1_000_000) { i ->
            try {
                delay(10)
                if (i % 1000 == 0) println("step $i")
            } catch (e: Exception) {
                if (i < 3) println("caught: ${e::class.simpleName}")
            }
        }
        println("loop finished")
    }

    delay(100)
    job.cancelAndJoin()
    println("job cancelled")
}
```

预期是循环在第三次 `delay` 附近停下，实际输出类似：

```text
step 0
step 1
caught: JobCancellationException
caught: JobCancellationException
caught: JobCancellationException
...
loop finished
job cancelled
```

`cancel()` 发出来了，`Job` 也确实进入了取消状态，但循环一路跑到了 `repeat` 结束。原因藏在那句宽泛的 `catch (e: Exception)` 里：`delay` 是一个取消点，协程被取消后每次调用 `delay` 都会立刻抛出 `JobCancellationException`；异常被 catch 住之后，循环继续，而 `delay` 不再挂起，于是剩下的几十万次迭代在极短时间内空转完。

取消没有失败，它只是被“消化”了。

## CancellationException 不是普通业务错误

`CancellationException` 继承自 `IllegalStateException`，因此也是 `Exception` 的子类。它和 `IOException`、`IllegalArgumentException` 这类异常的一个关键区别是：它不是“出错了”，而是结构化并发用来通知协程“请停止”的信号。

协作式取消依赖几个取消点：

- `delay`、`yield` 等挂起函数会在挂起前检查取消状态；
- `Job.ensureActive()` 和 `CoroutineScope.ensureActive()` 主动检查，未取消则正常返回，已取消则抛异常；
- `isActive` 只是读取状态，不会抛异常，适合放在 `while (isActive)` 这种循环条件里。

一旦把取消异常当成普通错误吞掉，协程上下文里的取消状态并不会被撤销，但你的代码会继续往下走。后果通常不是“崩了”，而是更隐蔽的行为：循环空转、回调继续执行、本该跳过的副作用又发生了一次。

正确的做法是把取消异常单独挑出来重新抛出：

```kotlin
repeat(1_000_000) { i ->
    try {
        delay(10)
        ensureActive()   // 没有挂起点时也能检查取消
        doBusiness(i)
    } catch (e: CancellationException) {
        throw e          // 交还给结构化并发
    } catch (e: Exception) {
        println("business failed: ${e.message}")
    }
}
```

注意顺序：`catch (e: CancellationException)` 必须写在 `catch (e: Exception)` 前面，否则永远轮不到它。

## runCatching 会把取消也装进 Result

`runCatching` 的实现思路是“接住一切 Throwable，包装成 `Result`”。这在同步代码里很好用，放到协程里却容易出事，因为 `Throwable` 的范围比 `Exception` 还大，自然也包括 `CancellationException`。

看一个超时的例子：

```kotlin
fun main() = runBlocking {
    withTimeout(100) {
        val result = runCatching {
            delay(500)
            "done"
        }
        println("result = $result")
        println("isActive = ${currentCoroutineContext().job.isActive}")
    }
}
```

`withTimeout` 到点后会抛出 `TimeoutCancellationException`（它是 `CancellationException` 的子类）。但这里它被 `runCatching` 包进了 `Result.failure`，于是 `withTimeout` 块继续往下执行，打印出失败结果和 `isActive = false`。代码块没有被当作“超时”结束，而是作为“一次带失败返回值的计算”继续跑。

如果确实想处理超时，有两个更清晰的写法：

```kotlin
// 写法一：只把业务结果收进 Result，取消照样往外抛
withTimeout(100) {
    val result = runCatching { parse(input) }  // parse 是普通函数，不含 suspend 取消点
    println(result)
}

// 写法二：超时即返回空值，不让它变成异常
val value = withTimeoutOrNull(100) {
    delay(500)
    "done"
}
println(value) // null
```

顺带说一句，`Result` 并不适合拿来做协程的公开返回类型。把它留给 `runCatching` 的局部使用，异常传播交给结构化并发，通常更省心。

## launch、async 和异常处理器各管一段

取消异常之外，普通异常的传播路径也经常被混淆。下面这张表可以当作速查：

| 启动方式 | 异常去哪 | 何时抛给调用方 |
| --- | --- | --- |
| `launch` | 交给根作用域的 `CoroutineExceptionHandler`，没有则到线程的未捕获异常处理器 | 不会在 `join()` 处抛 |
| `async` | 封存在 `Deferred` 里 | `await()` 时抛 |
| `supervisorScope` 的子协程 | 各自独立处理，不会取消兄弟协程 | 取决于启动方式 |

一个常见误判是给作用域装了 `CoroutineExceptionHandler`，却发现 `async` 里的异常“没进 handler”：

```kotlin
val handler = CoroutineExceptionHandler { _, e ->
    println("handler: ${e.message}")
}
val scope = CoroutineScope(SupervisorJob() + handler)

scope.launch { throw RuntimeException("launch failed") }.join()

val deferred = scope.async { throw RuntimeException("async failed") }
try {
    deferred.await()
} catch (e: Exception) {
    println("await: ${e.message}")
}
```

输出里只有 launch 的异常进入 handler；async 的异常要等 `await()` 才会出现。取消也是同理：被取消的 `Deferred` 在 `await()` 时抛 `CancellationException`，如果你在外层用 `runCatching { deferred.await() }` 接住它，调用方就看不到“这里被取消过”的信号。

## 清理代码要单独安排

还有一处容易踩坑：`finally` 块里的挂起调用。协程被取消后处于取消状态，此时在 `finally` 里调用 `delay`、发起网络请求这类挂起函数，会立刻抛出 `CancellationException`，清理代码可能只执行了一半。

把必须完成的清理放进 `NonCancellable` 上下文：

```kotlin
val job = launch {
    try {
        delay(1_000)
    } finally {
        withContext(NonCancellable) {
            delay(100)          // 模拟关闭连接、落盘等收尾动作
            println("cleanup done")
        }
    }
}
```

`NonCancellable` 只影响这一段代码是否响应取消，不会把整个 `Job` 复活；它之外的协程仍然是取消状态。

## 写协程时记住这几条

- 不要写裸的 `catch (e: Exception)` 包住整段协程体；先单独捕获并重新抛出 `CancellationException`。
- `runCatching` 用在对普通同步结果的包装上，别用它兜住带挂起点的整块逻辑。
- 循环里至少放一个取消点：`delay`、`yield` 或 `ensureActive()`；只判断 `isActive` 而不挂起，长循环仍会占满线程。
- `withTimeout` 里不要吞掉 `TimeoutCancellationException`；只需要“超时返回空”时用 `withTimeoutOrNull`。
- `async` 的异常和取消在 `await()` 处才暴露，别指望 `CoroutineExceptionHandler` 替你处理。
- `finally` 里的清理若必须完成，用 `withContext(NonCancellable)` 包起来。

取消是协程生命周期的一部分，不是失败。把 `CancellationException` 当成需要原样传递的信号，而不是需要记录的报错，大多数“取消没生效”的问题都会消失。

## 相关文章

- [Kotlin 扩展函数：写在类外面的方法，运行时去哪了](https://daily.xplanc.org/zh/kotlin/Kotlin-扩展函数：写在类外面的方法，运行时去哪了.md)

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
