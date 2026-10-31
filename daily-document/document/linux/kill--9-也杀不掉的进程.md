# kill -9 也杀不掉的进程

凌晨两点，监控报警：一台文件服务器上的备份任务卡住了。你 ssh 上去，`ps` 看到 `rsync` 的状态是 `D`，于是熟练地执行 `kill -9`。一分钟后再看，它还在。再 kill，还在。重启服务，父进程也变成了 `D`。最后连 `reboot` 都卡在 “Unmounting filesystems”。

这不是玄学，而是 Linux 进程状态里最容易被误解的一种：不可中断睡眠。理解它，能帮你判断什么时候该修 I/O，什么时候该放弃等待、直接重启机器。

## 先确认：D 不是“死机”

`ps` 的 `STAT` 列里，常见状态有这几种：

| 状态 | 含义 | 能否被信号打断 |
| --- | --- | --- |
| `R` | 正在运行或排队等 CPU | 能 |
| `S` | 可中断睡眠，等事件 | 能 |
| `D` | 不可中断睡眠，通常等 I/O 或内核锁 | 通常不能 |
| `Z` | 僵尸，已退出但未被父进程回收 | 无意义，已经死了 |
| `T` | 被暂停（如 `Ctrl+Z`） | 能，`SIGCONT` 可恢复 |

`D` 的全称是 `TASK_UNINTERRUPTIBLE`。它和 `S` 的关键区别不是“睡得更深”，而是睡眠期间不处理信号。进程并没有忽略 `SIGKILL`，信号只是被挂起了，等它从内核返回用户态之前才会生效。

另一个容易踩的坑是：**卡住的可能只是进程里的一个线程**。主线程状态是 `S`，某个工作线程却是 `D`，用普通的 `ps aux` 很容易看漏。要按线程查：

```bash
ps -eLo pid,tid,stat,wchan:32,comm | awk '$3 ~ /^D/'
```

如果没有输出，再确认一下是否只是短时间的 I/O 抖动：

```bash
ps -eo pid,ppid,stat,wchan:32,etime,comm | awk '$3 ~ /^D/'
```

## 为什么 SIGKILL 送不进去

信号投递需要目标进程回到一个可以处理信号的位置。进程在用户态运行时，内核会在返回用户态的路上检查 pending 信号；进程在可中断睡眠（`S`）中时，信号会把它唤醒。但 `D` 状态的线程不在运行队列里，也不会因为信号而被唤醒，所以 `SIGKILL` 只能躺在它的 pending 队列里。

你可以直接看到这一点：

```bash
pid=1234
grep -E '^(Name|State|SigPnd|ShdPnd)' /proc/$pid/status
```

如果 `SIGKILL` 已经挂起，`SigPnd` 里第 9 位（十六进制 `0x100`）会被置上。多线程程序还要看具体线程：

```bash
grep -H SigPnd /proc/$pid/task/*/status
```

需要说明的是，内核里并非所有等待都是不可中断的。有些路径使用 `TASK_KILLABLE`，致命信号仍然可以打断，所以偶尔 `kill -9` 也会“成功”。但传统块设备 I/O、部分文件系统和内核锁的等待是 `TASK_UNINTERRUPTIBLE`，这就是 kill 无效的主要来源。

## 它通常卡在什么地方

`D` 状态最常见的原因不是 CPU，而是“等一个可能永远不返回的东西”：

- **网络文件系统**：NFS、CIFS/SMB、sshfs 等。服务器掉线、网络分区、防火墙丢包，客户端可能一直重试。
- **块设备故障**：磁盘坏道、RAID 降级、云盘挂死、device mapper 卡住。`dmesg` 里通常有 I/O error 或 timeout。
- **内核锁或驱动问题**：等待 `rwsem`、`mutex`，或者驱动自身的 bug。此时 `wchan` 往往不是 I/O 相关函数。
- **内存回收**：直接 reclaim 需要写回脏页，底层存储不响应时也会卡在 `D`。
- **FUSE 文件系统**：用户态文件系统进程无响应，访问该挂载点的进程就会一起卡住。

`/proc/$pid/status` 里的 `State: D (disk sleep)` 只是一个笼统标签，等 NFS 也会显示 “disk sleep”，不要被字面意思误导。

## 排查：从 wchan 到内核栈

第一步，看它睡在哪个内核函数上：

```bash
pid=1234
cat /proc/$pid/wchan; echo
sudo cat /proc/$pid/stack
```

`wchan` 可能是 `rpc_wait_bit_killable`、`io_schedule`、`rwsem_down_read_slowpath` 之类的符号；如果是 `0`，通常表示进程正在运行。`/proc/$pid/stack` 需要 root，并且内核编译时开启了 `CONFIG_STACKTRACE`，容器里也可能读不到。线程卡住时，路径要换成：

```bash
sudo cat /proc/$pid/task/$tid/stack
```

第二步，看内核最近有没有报错：

```bash
dmesg -T | grep -iE 'blocked for more than|I/O error|nfs|timeout|hung_task' | tail -n 50
```

如果看到这样的日志，说明内核的 hung task 检测器已经盯上它了：

```text
INFO: task rsync:1234 blocked for more than 120 seconds.
```

第三步，确认存储是否真的没有响应：

```bash
iostat -x 1 5
nfsstat -m
mount | grep -E 'nfs|cifs|fuse'
```

`iostat` 里重点看 `%util`、`await`、`r_await`、`w_await`。如果 `%util` 接近 100%、`await` 持续很高，问题在块设备或后端存储；如果本地磁盘很闲，但进程卡在 NFS 相关函数上，就去查网络和 NFS 服务器。

还可以观察进程的 I/O 计数是否还在增长：

```bash
watch -n 1 'grep -E "read_bytes|write_bytes" /proc/1234/io'
```

数字完全不动，基本可以判定它卡在了一个不会推进的等待上。

如果上面信息还不够，可以让内核把所有阻塞任务的内核栈打到 `dmesg`：

```bash
cat /proc/sys/kernel/sysrq          # 确认不是 0
echo w | sudo tee /proc/sysrq-trigger
dmesg -T | tail -n 200
```

`w` 只输出处于不可中断睡眠的任务，比 `t`（输出所有任务）温和一些。但在生产环境仍要谨慎，输出可能很多。

## 处理：先恢复等待条件

对 `D` 状态进程，正确的思路不是“怎么杀死它”，而是“它在等什么，能不能让那个东西恢复”。

如果是 NFS 服务器宕机，优先在服务器侧恢复服务，或者从另一台机器确认网络是否可达：

```bash
ping -c 3 10.0.0.10
showmount -e 10.0.0.10
```

服务器恢复后，卡住的 RPC 可能自动完成，进程也就继续跑了。如果确认服务器短期回不来，可以在客户端尝试强制卸载：

```bash
sudo umount -f /mnt/data
# 仍然失败时，懒卸载
sudo umount -l /mnt/data
```

`umount -l` 只是把挂载点从命名空间里摘掉，已经卡住的进程仍然持有引用，不会立刻恢复。它适合阻止新进程继续踩进这个挂载点，不是“解药”。

对于必须保证数据完整性的场景，NFS 通常使用 `hard` 挂载，客户端会一直重试，代价就是进程可能长时间处于 `D`：

```bash
sudo mount -t nfs -o vers=4.2,hard,timeo=600,retrans=2 \
  10.0.0.10:/data /mnt/data
```

这里的 `timeo=600` 单位是 0.1 秒，即 60 秒；`retrans=2` 表示重试次数。改成 `soft` 可以让调用在超时后返回 `EIO`，但写操作可能只完成了一部分，应用必须能接受这种风险。为了消灭 `D` 状态而随手改 `soft`，往往是用数据一致性换表面上的“可恢复”。

另外，较新的内核已经移除了 NFS 的 `intr` 挂载选项，不要再指望它让 `kill` 生效。

如果是本地块设备或云盘挂死，先看 `dmesg` 和 `smartctl`：

```bash
sudo smartctl -a /dev/sda
lsblk -f
```

云环境可以在控制台尝试重置或重新挂载数据盘；物理机则要考虑隔离坏盘、切换 RAID、重启存储服务。内核锁或驱动 bug 通常只能升级内核、打补丁，或者重启。

最后才是重启。普通 `reboot` 可能同样卡在卸载文件系统；`reboot -f` 会跳过卸载，但未落盘的数据有丢失风险，只适合已经无法正常收场的故障机。

## 别把它和僵尸进程混为一谈

`Z` 状态的进程已经退出，只剩下一个 `task_struct` 等父进程 `wait()`。它不占 CPU，也不占内存页，`kill -9` 对它没有任何意义。排查方式是找父进程：

```bash
ps -eo pid,ppid,stat,comm | awk '$3 ~ /^Z/'
```

如果父进程长期不回收，修父进程；如果父进程是容器里的 PID 1，考虑给容器加一个会回收孤儿的 init 进程。`D` 是“还活着但卡住”，`Z` 是“已经死了但没被收尸”，处理方式完全不同。

## 预防：给不可中断的等待留条退路

- 关键业务路径尽量别直接依赖可能失联的网络挂载；必须用时，评估 `hard` 与 `soft` 的取舍，并给应用设计超时和降级。
- 用 `autofs` 或 systemd automount 按需挂载，避免机器启动时被一个不可达的 NFS 拖住。
- 监控 `D` 状态线程数量和 `dmesg` 里的 `blocked for more than` 告警。不要为了让日志干净把 `hung_task_timeout_secs` 设成 0，那只是关掉了报警。
- 应用层的超时、取消、线程池 `shutdownNow()` 对 `D` 状态都无效。一个卡住的工作线程会一直占着位置，最终拖垮整个线程池，所以外部依赖一定要有独立的隔离和熔断。
- 磁盘、RAID、云盘的健康状态要提前监控，别等 `D` 状态出现才去查坏道。

`kill -9` 是终止进程的最后一招，但它不是万能的。遇到杀不掉的进程，先看 `wchan`，再看内核栈和 `dmesg`，找到那个“不返回的等待”。多数时候，你要修的是它背后的 I/O，而不是它本身。

---

> 原文链接：[kill -9 也杀不掉的进程](https://daily.xplanc.org/linux/kill--9-%E4%B9%9F%E6%9D%80%E4%B8%8D%E6%8E%89%E7%9A%84%E8%BF%9B%E7%A8%8B.md)
