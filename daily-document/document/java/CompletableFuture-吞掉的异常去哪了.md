# CompletableFuture 吞掉的异常去哪了

一次线上问题：订单支付成功后，异步任务负责发通知、写积分、更新报表。上线第二天，有用户反馈没收到通知，但日志干干净净，监控也没报错，任务看起来“成功”了。

最后定位到一行代码：`CompletableFuture` 里的异常，没有人接。

## 一个没有堆栈的失败

先看最小复现：

```java
import java.util.concurrent.CompletableFuture;

public class SilentFailure {
    public static void main(String[] args) throws Exception {
        CompletableFuture<Void> f = CompletableFuture
                .<String>supplyAsync(() -> {
                    throw new IllegalStateException("库存扣减失败");
                })
                .thenAccept(v -> System.out.println("后续逻辑"));

        Thread.sleep(300);
        System.out.println("isCompletedExceptionally = " + f.isCompletedExceptionally());
    }
}
```

运行结果只有一行：

```
isCompletedExceptionally = true
```

没有异常堆栈，没有“后续逻辑”，程序正常退出。如果这是 Web 应用里的一个异步分支，控制台和日志文件里同样什么都不会留下。

原因不复杂：`CompletableFuture` 把异常当成一种“结果”保存了下来。`supplyAsync` 内部会在 `run()` 里 `catch (Throwable ex)`，然后调用 `completeThrowable(ex)`，把异常封装进结果对象。异常没有逃出线程，自然不会触发 `Thread.UncaughtExceptionHandler`，也不会被全局异常处理器看到。

换句话说：**异常不是被吞了，是被存起来了，只是没人去取。**

## 谁会真正“取走”异常

只有两种情况会让异常重新出现在你面前：

1. 调用 `join()` 或 `get()` 等待结果；
2. 注册了 `exceptionally`、`handle`、`whenComplete` 这类回调。

几种方式的区别如下：

| 方法 | 触发时机 | 对结果的影响 | 常见用途 |
| --- | --- | --- | --- |
| `join()` | 调用时阻塞 | 抛出 `CompletionException` | 链路末端取结果 |
| `get()` | 调用时阻塞 | 抛出 `ExecutionException` | 需要处理中断时 |
| `exceptionally` | 仅异常时 | 可返回兜底值 | 降级 |
| `handle` | 成功、异常都执行 | 可返回新值 | 统一转换 |
| `whenComplete` | 成功、异常都执行 | 不能改结果值 | 记日志、清理资源 |
| `thenApply` / `thenAccept` | 仅成功时 | 继续传递或消费 | 正常业务流程 |

注意 `join()` 抛的是非受检的 `CompletionException`，真正的业务异常在 `getCause()` 里；`get()` 则抛 `ExecutionException`，同时还可能抛 `InterruptedException`。日志里如果只打印 `e.getMessage()`，经常只能看到一层包装，建议统一解包。

## 五个容易踩的细节

### 1. `thenApply` 返回 Future，会套娃

```java
// 错误：类型是 CompletableFuture<CompletableFuture<Order>>
CompletableFuture<CompletableFuture<Order>> bad =
        CompletableFuture.supplyAsync(() -> "u1")
                .thenApply(uid -> CompletableFuture.supplyAsync(() -> query(uid)));
```

`thenApply` 的返回值会被原样包进新的 Future。需要扁平化时用 `thenCompose`：

```java
CompletableFuture<Order> ok =
        CompletableFuture.supplyAsync(() -> "u1")
                .thenCompose(uid -> CompletableFuture.supplyAsync(() -> query(uid)));
```

### 2. `whenComplete` 里再抛异常，会盖掉原始异常

```java
future.whenComplete((r, e) -> {
    throw new RuntimeException("记录日志失败");
});
```

这个回调抛出的异常会成为新 Future 的完成原因，原来的 `e` 就丢了。日志、埋点这类“旁路逻辑”本身必须 `try-catch`，不能让它们影响主链路。

### 3. `allOf` 之后不 `join`，等于没等

```java
CompletableFuture.allOf(a, b, c);          // 没有 join，异常无人知晓
CompletableFuture.allOf(a, b, c).join();   // 至少能把异常带回来
```

`allOf` 返回的是 `CompletableFuture<Void>`，等所有任务结束后才完成；只要有一个失败，它就是异常完成。但它只保留其中一个失败原因，多个任务同时失败时，其余异常看不到。需要完整信息就逐个 `handle` 收集。

### 4. 默认线程池是公共的

不传 `Executor` 时，`supplyAsync` 用的是 `ForkJoinPool.commonPool()`，并行度默认是 `CPU 核数 - 1`。在里面做阻塞 IO、等锁、远程调用，会把公共池占满，连带影响同进程里所有使用公共池的代码，包括并行流。

业务异步任务应该显式传入自己的线程池：

```java
ExecutorService pool = Executors.newFixedThreadPool(8);
CompletableFuture<Order> f =
        CompletableFuture.supplyAsync(() -> load(id), pool);
```

### 5. `orTimeout` 不会真的取消任务

Java 9 起可以用 `orTimeout`：

```java
future.orTimeout(2, TimeUnit.SECONDS);
```

它只是让这个 Future 以 `TimeoutException` 异常完成，底层任务仍在继续跑。如果任务后面还要写数据库，就会出现“调用方以为失败了，数据其实写进去了”的情况。超时之后要配合 `cancel(true)`，并让任务内部响应中断。

## 一个统一的封装

与其在每个调用点重复写日志，不如在链路末端统一处理：

```java
static Throwable unwrap(Throwable t) {
    while ((t instanceof CompletionException
            || t instanceof ExecutionException)
            && t.getCause() != null) {
        t = t.getCause();
    }
    return t;
}

static <T> CompletableFuture<T> logged(CompletableFuture<T> future, String name) {
    return future.whenComplete((r, e) -> {
        if (e != null) {
            log.error("[{}] 异步任务失败", name, unwrap(e));
        }
    });
}
```

使用时：

```java
CompletableFuture<Order> f = logged(
        CompletableFuture.supplyAsync(() -> load(id), pool), "loadOrder");

try {
    Order order = f.join();   // 异常会在这里重新抛出
    render(order);
} catch (CompletionException e) {
    throw new BizException("加载订单失败", unwrap(e));
} finally {
    pool.shutdown();
}
```

`whenComplete` 返回的新 Future 仍会保持异常完成状态，所以日志记录不会改变调用方的行为；`join()` 再把异常带回请求线程，交给统一的异常处理。

## 收尾检查清单

- 每个 `CompletableFuture` 都要有人消费：`join`、`get`，或者至少一个异常回调。
- 日志包装放在链路末端，而不是散落在每个 `thenApply` 里。
- 异步任务显式指定线程池，不要把阻塞操作丢进 `commonPool`。
- 超时要配合取消，确认任务是否真的停止。
- 单元测试里断言异常路径，而不只测成功分支。

异步代码最危险的地方不是写错，而是错了却没有声音。给每个 Future 安排一个“收尸人”，比事后加日志便宜得多。

---

> 原文链接：[CompletableFuture 吞掉的异常去哪了](https://daily.xplanc.org/java/CompletableFuture-%E5%90%9E%E6%8E%89%E7%9A%84%E5%BC%82%E5%B8%B8%E5%8E%BB%E5%93%AA%E4%BA%86.md)
