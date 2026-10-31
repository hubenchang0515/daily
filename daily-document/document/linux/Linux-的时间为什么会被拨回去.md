# Linux 的时间为什么会被拨回去

凌晨两点多，监控里出现一批超时告警：某个服务里所有 30 秒超时的 RPC 在同一秒内集体失败。翻日志时更奇怪，同一台机器上连续几条日志的时间戳是倒着走的：

```
02:17:03.914  request started
02:17:03.902  request timeout
02:17:03.918  request started
```

机器没重启，进程也没重启，只是 `chronyd` 把系统时钟往回拨了 12 毫秒。对多数业务来说 12 毫秒不算什么，但对那些用“墙上时间”算超时、算租约、算间隔的代码来说，时间倒流足以让逻辑集体失灵。

这篇文章聊的就是这件事：Linux 有哪几种时间，NTP 到底怎么改时间，以及哪些代码写法会在时间跳变时出问题。

## 一台上其实有好几个时钟

应用里常说的“当前时间”，在 Linux 里对应好几个不同的时钟。用 `clock_gettime()` 可以分别取到：

| 时钟 | 含义 | 会被 NTP 改吗 | 会包含休眠吗 |
| --- | --- | --- | --- |
| `CLOCK_REALTIME` | 墙上时间，就是 `date` 看到的 | 会，可跳变也可微调 | 会 |
| `CLOCK_MONOTONIC` | 从开机起单调递增 | 不会跳变，但会被微调频率 | 不会 |
| `CLOCK_BOOTTIME` | 同 monotonic，但包含 suspend | 不会跳变 | 会 |
| `CLOCK_MONOTONIC_RAW` | 纯硬件计时，不受任何调整 | 不会 | 不会 |

关键区别只有一句话：**`REALTIME` 表示“现在是几点”，`MONOTONIC` 表示“过了多久”**。前者可以被人为修改，也可以被 NTP 修正；后者只会向前走，哪怕一次只走一点点。

很多 bug 来自把这两件事混为一谈。比如用墙上时间计算耗时：

```c
#include <stdio.h>
#include <sys/time.h>

/* 错误示范：用墙上时间算间隔 */
double elapsed_bad(struct timeval *start) {
    struct timeval now;
    gettimeofday(&now, NULL);
    return (now.tv_sec - start->tv_sec) +
           (now.tv_usec - start->tv_usec) / 1e6;
}
```

如果这期间时钟被往回拨了 1 秒，算出来的耗时就可能是负数，超时判断永远不会成立；如果被往前拨，所有请求会瞬间“超时”。

正确写法是换成单调时钟：

```c
#include <time.h>

double elapsed(struct timespec *start) {
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return (now.tv_sec - start->tv_sec) +
           (now.tv_nsec - start->tv_nsec) / 1e9;
}
```

各语言的标准库里其实都已经提供了对应工具，只是名字不显眼：

```python
import time

start = time.monotonic()      # 不要用 time.time()
do_something()
print(time.monotonic() - start)
```

```go
start := time.Now()
doSomething()
fmt.Println(time.Since(start)) // time.Now 带单调读数，Since 用的就是它
```

Go 这里有个坑：`time.Time` 里的单调读数只在进程内有效，一旦序列化再反序列化就丢了。所以对从 JSON 或数据库里读回来的时间调用 `Sub()`，比较的其实是墙上时间。想主动去掉单调读数，可以写 `t = t.Round(0)`。

Java 同理，`System.currentTimeMillis()` 是墙上时间，`System.nanoTime()` 才是单调的。

## NTP 改时间有两种方式：跳和拨

很多人以为 NTP 同步就是“把表对准”，实际上守护进程有两种手段。

**step（步进）**：直接把时间设成正确值，会产生一次跳变，可能向前也可能向后。系统刚启动、偏差很大时用它最省事。

**slew（微调）**：不改变时间值，而是让系统时钟走得稍微快一点或慢一点，慢慢追上正确时间。内核的 `adjtime()` 单次调整上限约为 500ppm，也就是 0.05%，一天最多纠正几十秒；chrony 通过调整 tick 可以获得更高的 slew 速率，默认上限是 `maxslewrate 83333` ppm，需要时才调。

`ntpd` 的默认策略是偏差超过 128 毫秒就 step。`chrony` 默认**不**主动 step，只做 slew，除非配置了 `makestep`：

```conf
# /etc/chrony.conf 或 /etc/chrony/chrony.conf
# 启动后的前 3 次同步允许直接步进，之后只做微调
makestep 1.0 3
```

这行配置的意思是：偏差超过 1 秒、且还处于启动阶段的前三次同步时，允许跳变；运行稳定后再大的偏差也只慢慢拨。这样既避免开机时带着巨大误差运行，也避免业务高峰突然被拨表。

想立刻看当前状态：

```bash
$ chronyc tracking
Reference ID    : A9FEA97B (ntp.example.com)
Stratum         : 3
System time     : 0.000123456 seconds fast of NTP time
Last offset     : +0.000234567 seconds
RMS offset      : 0.000345678 seconds
Frequency       : 12.345 ppm slow
Residual freq   : +0.001 ppm
Skew            : 0.123 ppm
Root delay      : 0.012345678 seconds
Root dispersion : 0.001234567 seconds
Update interval : 64.2 seconds
Leap status     : Normal
```

重点看三行：

- `System time`：当前系统时间比 NTP 快还是慢，正数表示“快了”。
- `Frequency`：本机晶振的固有偏差，单位 ppm。这个值大说明硬件漂移明显，虚拟机里尤其常见。
- `Leap status`：闰秒处理状态。

`chronyc sources -v` 用来看它到底在跟谁对时，`^*` 开头的那一行就是当前选中的源。如果所有源前面都是 `?` 或 `x`，说明同步根本没成功，这时候机器的时间基本靠晶振自己飘。

## 时间跳变会打坏什么

除了前面说的超时计算，还有几类典型问题。

**定时器和 sleep**。`sleep(60)` 这类相对等待在 Linux 上用的是单调时钟，不受影响；但如果代码是“算好一个绝对时间点，然后循环比较 `now < deadline`”，回拨就会让它多等，前拨就会让它立刻返回。

**日志顺序**。`journalctl` 的时间戳来自 `CLOCK_REALTIME`，时钟一跳，日志就可能在时间轴上错位。排查时可以用单调时间排序：

```bash
journalctl -u myservice -o short-monotonic --no-pager | tail -50
```

如果开启了持久化日志，`journalctl --since "02:00" --until "02:20"` 这种查询在跳变窗口内可能漏记录。

**分布式租约和心跳**。基于“过期时间 = 写入时间 + TTL”的实现，如果节点时钟往回跳，租约可能迟迟不过期；往前跳，则可能提前失效引发双主。这类系统通常要求用单调时钟或逻辑时钟（如 Raft term、Lamport 时钟），而不是各节点的墙上时间。

**定时任务**。cron 按本地墙上时间触发，时钟跳变或时区变更可能导致任务被跳过或重复执行。systemd timer 会好一些，它区分 `OnCalendar=`（墙上时间）和 `OnBootSec=` / `OnUnitActiveSec=`（单调时间），但 `OnCalendar` 同样受跳变影响。对“每隔多久跑一次”的任务，优先用单调类型的触发器。

**证书和令牌**。TLS 证书校验、JWT 的 `exp`、OAuth 的过期判断都依赖墙上时间。时钟偏差过大时，表现是“证书明明没过期却报 not yet valid”。

## 排查一台机器的时间准不准

先看整体状态：

```bash
$ timedatectl
               Local time: Sat 2026-10-31 09:12:03 CST
           Universal time: Sat 2026-10-31 01:12:03 UTC
                 RTC time: Sat 2026-10-31 01:12:03
                Time zone: Asia/Shanghai (CST, +0800)
System clock synchronized: yes
              NTP service: active
          RTC in local TZ: no
```

`System clock synchronized: yes` 说明至少有一次成功同步。如果装了 chrony，`timedatectl timesync-status` 可能不可用，那是 `systemd-timesyncd` 的接口，直接用 `chronyc` 即可。

再用 `chronyc tracking` 看误差量级。如果在同一台机器上连续观察，`System time` 一直在几十毫秒以上来回摆，说明上游源质量差或者网络抖动大；`Frequency` 异常大（比如几百 ppm）则要怀疑虚拟化环境或硬件问题。

需要等它稳定下来再继续操作时：

```bash
# 最多等 60 秒，直到偏差小于 0.1 秒
chronyc waitsync 60 0.1
```

容器里要注意：容器与宿主机共享同一个内核时钟视图，容器内通常没有 `CAP_SYS_TIME`，`date -s` 会直接失败；即使有权限，改的也是宿主机的时间。所以容器的时间问题一律去节点上解决，别在镜像里装 NTP 客户端。

## 几条可以直接落地的习惯

1. 测耗时、算超时、做重试退避，一律用单调时钟。代码评审时看到 `time.time()` 做减法就该警觉。
2. 生产机统一装 chrony，并在配置里明确 `makestep` 策略：只在启动阶段允许跳变。
3. 虚拟机开启 `kvm-clock` 或 `ptp` 时钟源，别让 guest 完全靠自己的晶振；宿主机的时间同步也要监控。
4. 分布式系统不要假设不同节点的墙上时间一致，租约、顺序、去重都应该基于逻辑时钟或单调时间。
5. 日志集中收集时保留单调时间字段或 `boot_id`，出事后才能把跳变窗口内的记录排回正确顺序。
6. 把 `chronyc tracking` 的 `System time` 和 `Leap status` 接入监控，比等到业务报错再查要便宜得多。

时间跳变本身不是故障，它只是内核在努力让时钟变准。真正的问题是代码默认了“时间只会均匀向前”。把“现在是几点”和“过了多久”分开对待，这类问题就少了一大半。

---

> 原文链接：[Linux 的时间为什么会被拨回去](https://daily.xplanc.org/linux/Linux-%E7%9A%84%E6%97%B6%E9%97%B4%E4%B8%BA%E4%BB%80%E4%B9%88%E4%BC%9A%E8%A2%AB%E6%8B%A8%E5%9B%9E%E5%8E%BB.md)
