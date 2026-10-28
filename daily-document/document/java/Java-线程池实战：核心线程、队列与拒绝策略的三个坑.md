# Java 线程池实战：核心线程、队列与拒绝策略的三个坑

很多人第一次配置线程池，是照着某篇博客写下 `new ThreadPoolExecutor(10, 20, 60, TimeUnit.SECONDS, new LinkedBlockingQueue<>())`。上线后一切正常，直到流量翻倍：接口 P99 从 80ms 涨到 3 秒，堆内存一路爬升，Full GC 之后也回不到原来的水位。

线程池只有七个构造参数，但它们彼此耦合。下面从“线程池到底什么时候创建线程”讲起，再说三个最常见的坑。

## 线程池什么时候创建线程

`ThreadPoolExecutor.execute()` 的判断顺序是固定的，记住这四步，后面所有问题都能推出来：

1. 当前工作线程数 < `corePoolSize`：新建一个核心线程，直接把任务交给它；
2. 否则尝试把任务放进 `workQueue`；
3. 入队失败（队列满）：若线程数 < `maximumPoolSize`，新建非核心线程；
4. 队列满且线程数已达上限：交给 `RejectedExecutionHandler`。

关键在于顺序：**队列没满，就不会扩容到 `maximumPoolSize`**。

| 参数 | 作用 | 常见误解 |
| --- | --- | --- |
| `corePoolSize` | 常驻工作线程数 | 以为任务一多就会超过它 |
| `maximumPoolSize` | 线程数上限 | 以为它先于队列生效 |
| `keepAliveTime` | 空闲线程存活时间 | 以为对核心线程也生效 |
| `workQueue` | 等待队列 | 以为只是缓冲，不占内存 |
| `threadFactory` | 线程创建方式 | 用默认命名，`jstack` 里全是 `pool-1-thread-1` |
| `handler` | 拒绝策略 | 以为只有抛异常一种 |

## 坑一：无界队列让 maximumPoolSize 形同虚设

`Executors.newFixedThreadPool(n)` 的内部实现是 `core = max = n`，外加一个 `LinkedBlockingQueue`（默认容量 `Integer.MAX_VALUE`）。也就是说，队列几乎永远不会满，第 3、4 步永远走不到。

```java
import java.util.concurrent.*;

public class FixedPoolOOM {
    public static void main(String[] args) {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        for (int i = 0; ; i++) {
            final int id = i;
            pool.execute(() -> {
                try {
                    Thread.sleep(1000);          // 模拟慢任务
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
            if (i % 10000 == 0) {
                System.out.println("已提交 " + id);
            }
        }
    }
}
```

用 `java -Xmx64m FixedPoolOOM` 跑，几秒后就会抛 `OutOfMemoryError`（通常是 `Java heap space`）。此时 `jstack` 里只有两个 worker 线程，剩下的任务全都以链表节点的形式躺在队列里——**队列也是堆内存**，任务对象、参数、闭包捕获的引用都会被一起持有。

正确的做法是显式构造，并把队列容量当作一个必须计算的参数：

```java
ThreadPoolExecutor pool = new ThreadPoolExecutor(
        8, 16,
        60L, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(200),        // 有界，满了才扩容/拒绝
        r -> new Thread(r, "order-worker"),
        new ThreadPoolExecutor.CallerRunsPolicy()
);
```

但这里有个必须想清楚的取舍：队列长度 200 意味着突发流量要先塞满 200 个任务才会扩容到 16 个线程。如果你希望“先扩容扛突发”，队列就要设得很小（甚至用 `SynchronousQueue`）；如果你希望“排队削峰、线程数稳定”，就把 `max` 设得接近 `core`。**这两种目标不能同时要**，很多参数表看起来漂亮，实际是把两个目标混在了一起。

## 坑二：submit 把异常吞掉了

`execute()` 和 `submit()` 的异常行为完全不同：

```java
ExecutorService pool = Executors.newSingleThreadExecutor();

pool.execute(() -> {
    throw new IllegalStateException("execute 的异常");
});
// 控制台会打印堆栈：线程的 UncaughtExceptionHandler 接住了它

Future<?> future = pool.submit(() -> {
    throw new IllegalStateException("submit 的异常");
});
// 控制台静悄悄，任务“成功”结束
```

`submit()` 会把任务包装成 `FutureTask`，`FutureTask.run()` 内部 `catch (Throwable)` 把异常存进结果里，等你去 `get()` 时才以 `ExecutionException` 抛出。如果不调用 `get()`，这个异常就彻底消失了——监控上看是成功的，业务上数据却没写进去。

两种补救方式：

```java
// 方式一：确实需要结果，就 get()
try {
    future.get(3, TimeUnit.SECONDS);
} catch (ExecutionException e) {
    log.error("任务失败", e.getCause());
} catch (TimeoutException e) {
    future.cancel(true);
}
```

```java
// 方式二：统一在钩子里兜底，适合“提交后不关心返回值”的场景
new ThreadPoolExecutor(8, 8, 0L, TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<>(100)) {
    @Override
    protected void afterExecute(Runnable r, Throwable t) {
        if (t != null) {
            log.error("任务异常", t);
        } else if (r instanceof Future<?> f && f.isDone()) {
            try {
                f.get();
            } catch (ExecutionException e) {
                log.error("任务异常", e.getCause());
            } catch (CancellationException ignored) {
                // 被取消的任务不算失败
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }
};
```

`afterExecute` 在任务结束时一定会被调用；`FutureTask.get()` 在任务已完成的情况下不会阻塞，所以这种写法是安全的。

## 坑三：核心线程不退出，停机也停不干净

`keepAliveTime` 默认只对非核心线程生效。核心线程处理完任务后会阻塞在 `workQueue.take()` 上，一直等到 `shutdown()` 才退出。如果服务在容器里频繁滚动发布，或者你想让空闲时段的线程资源还给系统，需要显式打开：

```java
pool.allowCoreThreadTimeOut(true);   // 要求 keepAliveTime > 0
```

另一个问题是停机。`shutdown()` 只是不再接收新任务，队列里的任务仍会执行完；`shutdownNow()` 会中断工作线程并返回队列中尚未开始的任务，但**它依赖任务响应中断**——一个死循环里不检查中断标志的任务，照样跑不完。

比较稳妥的关闭流程：

```java
pool.shutdown();
if (!pool.awaitTermination(30, TimeUnit.SECONDS)) {
    List<Runnable> pending = pool.shutdownNow();   // 取回没跑的任务，落库或告警
    log.warn("强制关闭，丢弃 {} 个任务", pending.size());
    if (!pool.awaitTermination(10, TimeUnit.SECONDS)) {
        log.error("线程池未能关闭");
    }
}
```

顺带一提：线程复用会让 `ThreadLocal` 的值残留到下一个任务。用完记得在 `finally` 里 `remove()`，否则轻则数据串味，重则内存泄漏。

## 参数怎么估

线程数不是拍脑袋来的。对混合型任务，可以用这个经典公式粗估：

```
线程数 ≈ CPU 核数 × 目标 CPU 利用率 × (1 + 等待时间 / 计算时间)
```

纯 CPU 密集型任务，等待时间为 0，线程数取核数或核数 +1 即可；IO 密集型任务等待时间远大于计算时间，可以放大到核数的数倍。但放大之前先确认下游（数据库连接池、HTTP 客户端）能不能承受这个并发，否则只是把压力转移到了别处。

队列长度则用“能接受的最大延迟 ÷ 单任务耗时”来估算。比如单任务 50ms，允许排队 2 秒，队列就不该超过 40。

## 一份可以直接抄的模板

```java
public final class Pools {
    public static ThreadPoolExecutor orderPool() {
        AtomicInteger seq = new AtomicInteger();
        ThreadPoolExecutor pool = new ThreadPoolExecutor(
                8, 16,
                60L, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(200),
                r -> {
                    Thread t = new Thread(r, "order-worker-" + seq.incrementAndGet());
                    t.setDaemon(false);
                    return t;
                },
                new ThreadPoolExecutor.CallerRunsPolicy());
        pool.allowCoreThreadTimeOut(true);
        pool.prestartAllCoreThreads();
        return pool;
    }
}
```

`CallerRunsPolicy` 在池满时让调用方线程自己执行任务，形成天然背压，比直接丢弃安全；代价是会拖慢调用方，所以要确认调用链路上没有不能阻塞的线程（比如 Netty 的 event loop）。

最后，给线程起名字、把 `getActiveCount()`、`getQueue().size()`、`getCompletedTaskCount()` 暴露到监控里。线程池出问题时，最先能救你的不是参数，而是“队列什么时候开始堆积”这条曲线。

不同业务用不同的池，别让一个慢接口把全站的线程占满——这条经验，比任何参数配置都值钱。

---

> 原文链接：[Java 线程池实战：核心线程、队列与拒绝策略的三个坑](https://daily.xplanc.org/java/Java-%E7%BA%BF%E7%A8%8B%E6%B1%A0%E5%AE%9E%E6%88%98%EF%BC%9A%E6%A0%B8%E5%BF%83%E7%BA%BF%E7%A8%8B%E3%80%81%E9%98%9F%E5%88%97%E4%B8%8E%E6%8B%92%E7%BB%9D%E7%AD%96%E7%95%A5%E7%9A%84%E4%B8%89%E4%B8%AA%E5%9D%91.md)
