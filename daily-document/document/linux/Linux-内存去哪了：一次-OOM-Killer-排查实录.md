# Linux 内存去哪了：一次 OOM Killer 排查实录

一台 2 核 2G 的小型服务器上跑着 Nginx、Gunicorn 和 Redis。最近每隔两三天，就有一个 Python worker 突然消失，应用日志里没有任何异常，SSH 却还能正常登录。这不是程序自己退出，而是被内核的 OOM Killer 杀掉了。

本文按实际排查顺序，从确认内存状态到定位 cgroup 限制，整理一套可复用的命令。

## 一、先确认：是真的没内存，还是缓存背锅

登录后第一件事通常是看 `free`：

```bash
free -h
```

典型输出：

```text
               total        used        free      shared  buff/cache   available
Mem:           1.9Gi       1.6Gi        90Mi        12Mi       260Mi       180Mi
Swap:          2.0Gi       1.1Gi       900Mi
```

很多人看到 `free` 只剩 90Mi 就判断内存耗尽，其实关键数字是 `available`。Linux 会把暂时不用的页缓存放进 `buff/cache`，需要时可以直接回收；`available` 才是内核对“还能拿出多少内存给新进程”的估算。

如果 `available` 还有几百 MiB，但进程仍然被杀，就要怀疑另一种情况：**某个 cgroup 或进程受到了单独的内存限制**，而不是整机内存不足。

再看一眼更细的内核数据：

```bash
grep -E 'MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree' /proc/meminfo
```

## 二、找到 OOM 的直接证据

内核 OOM 会在 ring buffer 和 journal 里留下记录：

```bash
dmesg -T | grep -i -E 'out of memory|killed process|oom'
journalctl -k --since "2 hours ago" | grep -i -E 'out of memory|killed process|oom'
```

一段典型的日志：

```text
Out of memory: Killed process 18432 (python3) total-vm:2456788kB,
anon-rss:1420000kB, file-rss:8000kB, shmem-rss:0kB, UID:1000
```

这里最值得看的是 `anon-rss`：约 1.4GiB，说明进程的匿名内存（堆、栈、未落盘的分配）确实涨上去了，而不是文件缓存造成的假象。`total-vm` 是虚拟地址空间，通常远大于真实占用，不能直接当作物理内存使用量。

如果 `dmesg` 里没有记录，但容器或 systemd 服务反复重启，日志可能被 cgroup 级别拦截，需要继续看下一节。

## 三、定位占用最大的进程

先按 RSS 排序：

```bash
ps -eo pid,ppid,rss,%mem,comm --sort=-rss | head -n 15
```

RSS 会把多个进程共享的内存重复计算。要更接近真实分摊，可以安装并使用 `smem`：

```bash
sudo apt install smem
smem -tk -r -c "pid user command pss rss" | head -n 15
```

PSS 会把共享页按共享者数量分摊，适合判断“谁真正吃掉了内存”。

对可疑进程继续下钻：

```bash
PID=18432
grep -E '^(VmRSS|RssAnon|RssFile|RssShmem|VmSwap):' /proc/$PID/status
grep -E '^(Rss|Pss|Pss_Anon|Pss_File|Pss_Shmem):' /proc/$PID/smaps_rollup
```

| 指标 | 含义 | 排查价值 |
| --- | --- | --- |
| `VmRSS` | 进程当前驻留物理内存 | 快速看总占用 |
| `RssAnon` | 匿名页，主要是堆和栈 | 持续上涨通常意味着泄漏或数据堆积 |
| `RssFile` | 映射的文件页 | 可回收，通常不是 OOM 主因 |
| `RssShmem` | 共享内存 | 关注 tmpfs、共享缓存 |
| `Pss` | 按共享比例分摊后的内存 | 多进程场景更准确 |

如果 `RssAnon` 随时间单调上涨，基本可以认定是应用层问题，例如请求结果被无界缓存、连接未释放、任务队列堆积。

## 四、别忽略 cgroup 的独立限额

容器和 systemd 服务都可能设置独立内存上限。先确认 cgroup 版本和进程所属层级：

```bash
stat -fc %T /sys/fs/cgroup
cat /proc/$PID/cgroup
```

在 cgroup v2 下，查看某个服务的限制与当前用量：

```bash
UNIT=myapp.service
CGROUP=/sys/fs/cgroup/system.slice/$UNIT

cat $CGROUP/memory.max
cat $CGROUP/memory.current
cat $CGROUP/memory.events
```

`memory.max` 为 `max` 表示不限制；`memory.current` 的单位是字节。`memory.events` 中出现非零的 `oom_kill`，说明该 cgroup 内确实发生过 OOM：

```text
low 0
high 12
max 3
oom 3
oom_kill 3
```

也可以直接问 systemd：

```bash
systemctl show myapp.service -p MemoryMax -p MemoryHigh -p MemoryCurrent
```

这里有一个容易混淆的点：`MemoryHigh` 是软限制，超过后内核会施压、回收并节流；`MemoryMax` 是硬限制，超过后通常触发 cgroup OOM。只设 `MemoryHigh` 不会直接杀进程，但可能让服务变慢。

## 五、常见误判与处理方式

**1. 把页缓存当成泄漏。**  
`free` 里的 `buff/cache` 高并不等于内存被浪费。优先看 `available`，不要为了“释放内存”反复执行 `echo 3 > /proc/sys/vm/drop_caches`，那会丢掉有用的缓存。

**2. 只看整机，不看 cgroup。**  
整机还有空闲内存，但容器限额只有 512MiB，同样会 OOM。容器场景要同时看宿主机和容器两层。

**3. 盲目调整 overcommit。**  
检查承诺内存：

```bash
grep -E 'CommitLimit|Committed_AS|MemAvailable' /proc/meminfo
```

`Committed_AS` 接近 `CommitLimit` 时，即使还有空闲页，新的内存分配也可能失败。把 `vm.overcommit_memory` 改成 `1` 只是放宽承诺，并不能解决真实的内存泄漏，反而可能把问题推迟到更危险的时刻。

**4. 用重启代替定位。**  
重启能临时恢复服务，但会丢掉现场。至少保留 OOM 日志、`memory.events` 和进程的 `RssAnon` 趋势，再决定是修代码还是调限额。

## 六、一套可落地的预防配置

对 systemd 服务，可以用 drop-in 同时设置软硬限制和重启策略：

```bash
sudo systemctl edit myapp.service
```

写入：

```ini
[Service]
MemoryAccounting=yes
MemoryHigh=800M
MemoryMax=1G
OOMScoreAdjust=200
Restart=on-failure
RestartSec=2s
```

`OOMScoreAdjust` 取值从 `-1000` 到 `1000`，数值越大越容易被杀。把可牺牲的批处理任务调高，把关键服务调低，但不要用它来“保护”一个本身就在泄漏的进程。

监控上，除了内存绝对值，还建议采集 PSI（Pressure Stall Information）：

```bash
cat /proc/pressure/memory
```

当 `some avg10` 持续升高时，说明进程已经在为内存等待，这通常比 OOM 更早发出信号。对于桌面或小内存机器，也可以考虑 `systemd-oomd` 或 `earlyoom`，在系统完全卡死前主动处理高压力进程。

最后记住排查顺序：**先看 `available`，再找 OOM 日志，然后按 `RssAnon` 定位进程，最后检查 cgroup 限额**。大多数“内存突然没了”的问题，都能在这四步内收敛到具体原因。

---

> 原文链接：[Linux 内存去哪了：一次 OOM Killer 排查实录](https://daily.xplanc.org/linux/Linux-%E5%86%85%E5%AD%98%E5%8E%BB%E5%93%AA%E4%BA%86%EF%BC%9A%E4%B8%80%E6%AC%A1-OOM-Killer-%E6%8E%92%E6%9F%A5%E5%AE%9E%E5%BD%95.md)
