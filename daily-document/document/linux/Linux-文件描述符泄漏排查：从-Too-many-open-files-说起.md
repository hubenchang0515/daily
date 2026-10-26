# Linux 文件描述符泄漏排查：从 Too many open files 说起

服务运行几天后，日志里开始出现：

```text
OSError: [Errno 24] Too many open files
```

很多人第一反应是“磁盘满了”或“文件太多”，但在 Linux 中，文件描述符（FD）不只代表普通文件。socket、pipe、epoll、eventfd、inotify、signalfd 都会占用 FD。因此这句话的真实含义往往是：进程打开的连接、管道或事件对象，已经达到上限。

## 先看清三层限制

排查前要先区分限制发生在哪一层，否则容易改错地方。

| 层级 | 查看方式 | 说明 |
| --- | --- | --- |
| 进程 soft/hard limit | `ulimit -Sn`、`ulimit -Hn` | 只对当前 shell 及其子进程有效 |
| 指定进程 | `cat /proc/$PID/limits` | 查看目标进程实际生效的限制 |
| systemd 服务 | `systemctl show -p LimitNOFILE myapp.service` | 服务不一定继承登录 shell 的 `ulimit` |
| 系统级 | `cat /proc/sys/fs/file-nr` | 分别是已分配、未使用、系统上限 |
| 内核硬上限 | `sysctl fs.nr_open` | 单个进程 hard limit 不能超过它 |

`ulimit -n` 经常具有迷惑性：它显示的是当前 shell 的 soft limit，不代表 systemd 启动的服务也使用这个值。真正要以 `/proc/$PID/limits` 为准。

```bash
PID=$(pgrep -n myapp)
cat /proc/$PID/limits | grep 'Max open files'
```

输出类似：

```text
Max open files            1024                 4096                 files
```

第一列是 soft limit，第二列是 hard limit。进程运行中只能把 soft limit 提高到 hard limit 以内；要突破 hard limit，通常需要 root 或 `CAP_SYS_RESOURCE`。

## 用 /proc 定位现场

先确认当前 FD 数量：

```bash
PID=$(pgrep -n myapp)
sudo ls /proc/$PID/fd | wc -l
```

这个数字比 `lsof -p $PID | wc -l` 更接近真实 FD 数，因为 `lsof` 还会列出内存映射、可执行文件等条目。

接着观察它是否持续增长：

```bash
PID=$(pgrep -n myapp)
while :; do
  printf '%s %s\n' "$(date +%T)" "$(ls /proc/$PID/fd 2>/dev/null | wc -l)"
  sleep 5
done
```

如果停止业务流量后，FD 数量仍然只升不降，基本可以判断为泄漏，而不是单纯配置太小。

再按 FD 指向的对象归类：

```bash
PID=$(pgrep -n myapp)
sudo ls -l /proc/$PID/fd 2>/dev/null \
  | awk 'NR > 1 {print $NF}' \
  | sort | uniq -c | sort -nr | head -20
```

常见输出包括：

```text
    812 socket:[1234567]
     64 /var/log/myapp/app.log
     18 anon_inode:[eventpoll]
      6 pipe:[7654321]
```

如果 `socket` 数量异常多，继续看连接状态：

```bash
PID=$(pgrep -n myapp)
sudo ss -tanp | grep "pid=$PID,"
sudo ss -tan state close-wait | head
```

大量 `CLOSE_WAIT` 通常意味着对端已经关闭连接，但本进程没有调用 `close()`。这不是内核的问题，而是应用没有正确释放 socket。

还要检查“已删除但仍被占用”的文件：

```bash
sudo lsof +L1 -p "$PID"
```

这类文件会继续占用磁盘空间，但和 FD 泄漏是两个问题，需要分别处理。

## 判断是泄漏还是上限太低

可以按下面的现象快速判断：

| 现象 | 更可能的原因 |
| --- | --- |
| FD 数稳定在限制附近，业务量也没有明显增长 | soft/hard limit 配得太低 |
| 每次请求后 FD 数上升，停止流量后不下降 | 应用泄漏 |
| FD 数呈锯齿状，GC 后明显回落 | 连接池或临时对象，需看峰值 |
| 大量 `CLOSE_WAIT` | 收到连接后未关闭 |
| 大量 `anon_inode:[eventpoll]` | 反复创建 event loop / selector 未释放 |
| 大量 `inotify` | 文件监听器泄漏 |

一个实用方法是：停掉流量，等待 30 秒，再数一次 FD。如果数量几乎不变，就不要继续怀疑“请求太慢”，而应去找未关闭的资源。

## 常见泄漏模式

Python 中忘记关闭文件是最基础的一种：

```python
# 不推荐
f = open("app.log")
data = f.read()
```

应使用上下文管理器：

```python
with open("app.log") as f:
    data = f.read()
```

HTTP 客户端也容易泄漏。每次请求都新建 `Session` 且不关闭，会积累连接和 socket：

```python
import requests

with requests.Session() as s:
    with s.get("https://example.com", timeout=5) as r:
        print(r.status_code)
```

启动子进程时，如果使用了 `PIPE`，要确保读取并回收：

```python
import subprocess

p = subprocess.Popen(
    ["ls", "-l"],
    stdout=subprocess.PIPE,
    text=True,
)
out, _ = p.communicate(timeout=10)
print(out)
```

Go 的典型问题是忘记关闭响应体：

```go
resp, err := http.Get(url)
if err != nil {
    return err
}
defer resp.Body.Close()
_, _ = io.Copy(io.Discard, resp.Body)
```

另外，`asyncio.new_event_loop()` 创建后不 `close()`、`select.epoll()` 未释放、inotify watcher 只增不减，也都会表现为 FD 持续上涨。

## 应急处理与根治

如果服务已经不可用，可以先临时提高限制，让进程恢复：

```bash
PID=$(pgrep -n myapp)
sudo prlimit --pid "$PID" --nofile=65535:65535
```

这只对当前进程有效，重启后失效，而且治标不治本。

对 systemd 服务，应通过 drop-in 修改：

```bash
sudo systemctl edit myapp.service
```

写入：

```ini
[Service]
LimitNOFILE=65535
```

然后重新加载并重启：

```bash
sudo systemctl daemon-reload
sudo systemctl restart myapp.service
```

验证是否生效：

```bash
systemctl show -p LimitNOFILE --value myapp.service
cat /proc/$(pgrep -n myapp)/limits | grep 'Max open files'
```

如果是登录会话或传统 init 脚本，可以在 `/etc/security/limits.conf` 或 `/etc/security/limits.d/` 中配置：

```text
myapp soft nofile 65535
myapp hard nofile 65535
```

但要注意：`limits.conf` 依赖 PAM，通常需要重新登录；systemd 服务不要指望它生效。

系统级上限可以这样查看和调整：

```bash
cat /proc/sys/fs/file-nr
sudo sysctl -w fs.file-max=2097152
```

若要持久化：

```bash
echo 'fs.file-max=2097152' | sudo tee /etc/sysctl.d/99-file-max.conf
```

不过，`fs.file-max` 是系统总上限，调大它不会修复应用泄漏，只适合在确认总量确实不够时使用。

## 最短排查路径

1. 从日志确认是 `EMFILE` 还是 `ENFILE`。
2. 用 `/proc/$PID/limits` 查看目标进程的真实限制。
3. 用 `ls /proc/$PID/fd | wc -l` 统计 FD，并观察趋势。
4. 按 FD 指向对象分类，重点看 socket、pipe、eventpoll、inotify。
5. 结合 `ss` 的 `CLOSE_WAIT` 状态和代码中的资源释放逻辑定位泄漏点。
6. 修复代码，把提高 limit 只当作缓冲，而不是解决方案。

FD 泄漏的危险之处在于它通常不会立刻让服务崩溃，而是先表现为偶发超时、连接失败，最后才集中报错。越早把 FD 数量纳入监控，越容易在故障前找到那条没有关闭的连接。
