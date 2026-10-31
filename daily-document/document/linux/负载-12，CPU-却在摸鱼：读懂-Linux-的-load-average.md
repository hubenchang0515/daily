# 负载 12，CPU 却在摸鱼：读懂 Linux 的 load average

凌晨两点，监控告警：一台 8 核机器的 `load15` 超过了 10。

登录上去，`top` 却显示 CPU 空闲 75%，内存充足，磁盘也没报错。可服务的 P99 延迟已经从 80ms 涨到了 2s。

这是 load average 最容易被误解的地方：**它不是 CPU 使用率，而是“有多少任务在排队或者卡住”**。CPU 闲着的机器，负载一样可以很高。

## load average 到底在数什么

内核在每个 CPU 上维护运行队列，`load average` 统计的是下面两类任务的数量之和：

- **R（Running / Runnable）**：正在 CPU 上跑，或者已经就绪、等着被调度。
- **D（Uninterruptible Sleep）**：不可中断睡眠，通常卡在内核里等 IO 或锁。

然后对这两个数做指数衰减平均，得到 1、5、15 分钟三个值。它统计的是**任务个数**，不是百分比，也没有除以核数。

| 指标 | 含义 | 单位 |
| --- | --- | --- |
| load average | 可运行 + 不可中断的任务数 | 个 |
| CPU 使用率 | CPU 时间被占用的比例 | % |
| iowait | CPU 等 IO 的时间比例 | % |

所以 8 核机器上 load 为 8，意味着“平均有 8 个任务在跑或等”，刚好把核塞满；load 为 16 则是每个核排两个。但这条经验只在任务都处于 R 状态时成立。

如果这 12 个任务是 D 状态，它们根本没在用 CPU，只是卡在系统调用里。CPU 当然闲，`top` 里的 `id` 当然高。

另外一个常被忽略的点：**Linux 的 load 包含 D 状态，这是它和其他 Unix 不一样的地方**。很多老资料说“load 就是运行队列长度”，在 Linux 上并不准确。

## 先分清是“忙”还是“卡”

最快的方法是看 `vmstat` 的 `r` 和 `b` 两列：

```bash
vmstat 1 5
```

```
procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
 r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st
12  0      0 812345  20112 902144    0    0     4    88  920 1800 92  6  2  0  0
11  0      0 810020  20112 902300    0    0     0    96  880 1750 94  5  1  0  0
 1 13      0 809880  20112 902300    0    0  1024  4096  700 1200  3  1 21 75  0
```

- 第一段：`r=12`、`b=0`，12 个任务在抢 CPU，`us` 92%，这是真忙。
- 第二段：`r=1`、`b=13`，13 个任务处于不可中断睡眠，`wa` 75%，这是卡住了。

注意 `vmstat` 第一行是自开机以来的平均值，从第二行开始才有参考价值。

再看每个进程的状态：

```bash
ps -eo pid,stat,wchan:28,comm | awk '$2 ~ /^D/'
```

```
 4213 D    rpc_wait_bit_killable     php-fpm
 4288 D    rpc_wait_bit_killable     php-fpm
 4301 D    __lock_page_killable      mysqld
```

`wchan` 显示进程卡在哪个内核函数上。`rpc_wait_bit_killable` 基本就是 NFS 在等服务器响应，`__lock_page_killable` 是在等页锁，通常和磁盘或内存回收有关。

想看更完整的内核栈（需要 root）：

```bash
cat /proc/4213/stack
```

```
[<0>] rpc_wait_bit_killable+0x2c/0x90 [sunrpc]
[<0>] __rpc_execute+0x...
[<0>] rpc_execute+0x...
[<0>] nfs_file_read+0x...
```

到这里就能下结论了：不是 CPU 不够，是 NFS 挂了。

## 一个可以自己复现的实验

先制造纯 R 状态。找一台多核机器，跑四个死循环：

```bash
for i in $(seq 1 4); do
  (while :; do :; done) &
done
uptime
```

```
load average: 4.02, 1.31, 0.48
```

`load1` 会很快涨到 4 左右，同时 `top` 里能看到四个核接近 100%。这是“健康的”高负载。

再对比 D 状态。最典型的场景是挂载一个远端文件系统，然后把网线拔掉，再去读文件：

```bash
mount -t nfs 10.0.0.10:/data /mnt
cat /mnt/somefile
# 此时网络中断，cat 会卡在 D 状态
```

这时 `uptime` 的 load 会上去，`top` 的 CPU 却几乎是空的。而且 `kill -9` 对这个 `cat` 无效——因为它没有在用户态响应信号，内核不会中断一个不可中断的睡眠。

要清理这四个死循环：

```bash
jobs -p | xargs kill
```

## 排查顺序

按这个顺序走，基本不会跑偏：

1. `uptime` 看三个值的变化趋势。`load1` 高而 `load15` 低，说明是刚发生的突发事件。
2. `vmstat 1` 看 `r` 和 `b`。`r` 大是 CPU 排队，`b` 大是 IO 或内核阻塞。
3. `ps` 过滤 D 状态，拿到 PID 和 `wchan`。
4. `cat /proc/<pid>/stack` 看内核栈。
5. 对症下药：`iostat -x 1` 看磁盘，`pidstat -d 1` 看哪个进程在读盘，`ss` 看网络。

如果内核是 4.20 以上，还有一个更直接的指标：PSI（Pressure Stall Information）。

```bash
cat /proc/pressure/io
```

```
some avg10=45.23 avg60=38.11 avg300=20.05 total=12345678
full avg10=30.12 avg60=25.00 avg300=12.00 total=9876543
```

`some` 表示“至少有一个任务因为 IO 停住”的时间占比，`full` 表示“所有任务都停住”的时间占比。这两个数字比 load average 精确得多，因为它直接量化了“卡了多久”，而不是“卡了几个”。

## 容器里的 load 是个陷阱

这是最容易踩的坑：**`/proc/loadavg` 没有做 namespace 隔离**。

容器里执行 `uptime`，看到的是**宿主机**的负载，不是这个容器的。同一台机器上跑二十个容器，每个容器里看到的都是同一个数字。

更麻烦的是核数。`nproc` 读的是 CPU 亲和性，容器通常没有限制亲和性，所以 8 核宿主机上给容器 0.5 核配额，`nproc` 照样输出 8。

结果就是：容器里 load 显示 30，你以为要扩容，其实隔壁容器在跑批处理，跟你没关系。

容器场景下应该看 cgroup 自己的指标：

```bash
cat /sys/fs/cgroup/cpu.stat
```

```
nr_periods 12034
nr_throttled 892
throttled_usec 42130000
```

`nr_throttled` 持续增长，说明容器被 CPU 配额限流了，任务在等配额，load 高但 CPU 用不满。这才是该扩容的信号。

cgroup v2 还提供了按 cgroup 统计的 PSI：

```bash
cat /sys/fs/cgroup/cpu.pressure
cat /sys/fs/cgroup/io.pressure
```

这些数字只反映当前 cgroup，不会被邻居干扰。

## 阈值该怎么定

不要背“load 超过核数就告警”。先看负载的构成：

| 现象 | 大概率原因 | 下一步 |
| --- | --- | --- |
| `r` 大、`us`/`sy` 高 | CPU 真不够 | 看热点函数，考虑扩容或优化 |
| `b` 大、`wa` 高 | 磁盘或网络存储慢 | `iostat -x`、`pidstat -d` |
| `b` 大、`wa` 低 | 内核里等锁、等 NFS | 看 `wchan` 和 `/proc/<pid>/stack` |
| `r` 大、`id` 高 | 被 cgroup 限流或虚拟化争抢 | 看 `cpu.stat`、`steal` |

实践中的做法是：**用 PSI 做告警，用 load 做辅助**。

比如设一条规则：`io.pressure` 的 `some avg60` 连续 5 分钟超过 30%，就告警。这个条件比“load > 8”稳定得多，也不会被宿主机上无关的容器带偏。

如果只能用 load，至少做两件事：一是用 `nproc` 归一化，二是确认 `b` 列不大。8 核机器 load 12 但 `b=0`，和 load 12 且 `b=12`，是完全不同的两个故障。

## 小结

load average 的三个数字背后，混着两种完全不同的东西：**想跑但没 CPU 的任务**，和**卡在内核里动不了的任务**。

前者加机器有用，后者加机器没用。分不清这两者，就会在 CPU 空闲的机器上一边扩容一边困惑。

下次看到负载告警，先别急着看 CPU 使用率。敲一条 `vmstat 1`，看 `r` 和 `b` 哪个大，答案基本就出来了。

---

> 原文链接：[负载 12，CPU 却在摸鱼：读懂 Linux 的 load average](https://daily.xplanc.org/linux/%E8%B4%9F%E8%BD%BD-12%EF%BC%8CCPU-%E5%8D%B4%E5%9C%A8%E6%91%B8%E9%B1%BC%EF%BC%9A%E8%AF%BB%E6%87%82-Linux-%E7%9A%84-load-average.md)
