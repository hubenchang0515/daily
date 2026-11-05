> 原文链接：[管道另一头断了：SIGPIPE 与退出码 141 - 码日新 · 每日文章](https://daily.xplanc.org/linux/管道另一头断了：SIGPIPE-与退出码-141.md)

---

# 管道另一头断了：SIGPIPE 与退出码 141

一个跑得好好的脚本，加了一行 `set -euo pipefail` 之后突然开始随机失败。翻日志发现，那条命令明明“成功”了，退出码却是 **141**。

```bash
#!/usr/bin/env bash
set -euo pipefail

yes | head -n 1
echo "这一行永远不会执行"
```

`yes` 会无限输出 `y`，`head -n 1` 读一行就退出。结果整条管道返回 141，脚本直接终止。141 不是一个随意挑的数字，它等于 `128 + 13`，而 13 号信号正是 `SIGPIPE`。

```bash
$ kill -l 13
PIPE
```

## 内核在这中间做了什么

管道是内核里的一块环形缓冲区，Linux 上默认容量 64 KiB。写端把数据塞进去，读端取走，双方互不知道对方是谁。

关键在于读端**全部关闭**之后的规则：

- 此时再往管道里 `write`，内核先给写进程发一个 `SIGPIPE`；
- `SIGPIPE` 的默认动作是**终止进程**，于是 shell 记录下 141；
- 如果进程忽略或捕获了这个信号，`write` 才会返回 `-1`，`errno` 为 `EPIPE`。

注意方向：只有“写”会触发。反过来，从一个写端全部关闭的管道里 `read`，得到的是 `0`，也就是正常的 EOF，这就是 `cat` 能读完退出的原因。

下面这段 C 程序把两种行为都演示了一遍：

```c
#include <stdio.h>
#include <unistd.h>
#include <signal.h>
#include <errno.h>
#include <string.h>

int main(void) {
    signal(SIGPIPE, SIG_IGN);          /* 注释掉这一行，进程会被信号杀掉 */
    for (;;) {
        if (write(STDOUT_FILENO, "y\n", 2) < 0) {
            fprintf(stderr, "write: %s\n", strerror(errno));
            return 1;
        }
    }
}
```

```bash
$ gcc demo.c -o demo && ./demo | head -n 1
write: Broken pipe
$ echo $?
1
```

把 `signal` 那行删掉重新编译，同样的命令下 `./demo` 会直接消失，`echo ${PIPESTATUS[0]}` 得到 141。

## 这个信号是刻意设计的

`yes | head`、`find / | head`、`cat 巨大的日志 | grep`，这些命令的上游本来可以永远跑下去。下游只要一小段就退出，如果没人通知上游，机器就一直空转。`SIGPIPE` 就是那句“别说了，我挂了”。

所以它是 Unix 管道模型的一部分，不是 bug。把它当异常处理，往往才是 bug。

顺便说一句缓冲：如果上游写的数据总量小于管道容量，下游先退出也未必触发 `SIGPIPE`，因为数据已经躺在内核缓冲区里了。`echo hi | head -n 1` 一切正常，`yes | head -n 1` 才会出事——差别就在这里。

## 三个真实的坑

### 一、`pipefail` 让脚本“莫名其妙”退出

`set -o pipefail` 会把管道中最右边非零的退出码作为整体返回值，141 因此浮出水面，再被 `set -e` 一刀切掉。

要区分“下游不要了”和“真的出错”：

```bash
set -uo pipefail

yes | head -n 1 >/dev/null
rc=${PIPESTATUS[0]}

if [ "$rc" -ne 0 ] && [ "$rc" -ne 141 ]; then
    echo "yes 真的失败了: $rc" >&2
    exit "$rc"
fi
```

`PIPESTATUS` 是 bash 专有变量，而且必须在**紧接着的下一条命令**里读取，中间插一句 `echo` 就被覆盖了。zsh 里对应的是 `pipestatus`，写法还不一样。

### 二、`trap '' PIPE` 会被子进程继承

```bash
$ bash -c 'trap "" PIPE; yes | head -n 1; echo "rc=${PIPESTATUS[*]}"'
yes: standard output: Broken pipe
rc=1 0
```

被忽略的信号处置会跨 `exec` 继承。`yes` 拿到的 `SIGPIPE` 是“忽略”，于是它没有死，而是拿到 `EPIPE`，自己打印错误后以 1 退出。也就是说，忽略信号并没有让问题消失，只是把“被杀死”换成了“必须自己处理错误”。

恢复默认行为要用 `trap - PIPE`。

### 三、不同语言运行时的默认姿势不一样

| 环境 | 默认行为 |
| --- | --- |
| C / C++ | 默认终止，退出码 141 |
| Python | 启动时把 `SIGPIPE` 设为忽略，抛 `BrokenPipeError` |
| Go | 写 fd 1/2 时按 `SIGPIPE` 退出；写其它 fd 返回 `EPIPE` |
| Java | 忽略信号，抛 `IOException: Broken pipe` |
| Shell 脚本 | 一般继承默认处置，随上游一起死 |

Python 里那句经典报错就是这么来的：

```bash
$ python3 -c 'print("x" * 200000)' | head -c 10
xxxxxxxxxx
Exception ignored in: <_io.TextIOWrapper name='<stdout>'>
BrokenPipeError: [Errno 32] Broken pipe
```

程序本身的逻辑没错，是解释器在退出、flush 缓冲区时才发现管道没了。想在 CLI 工具里干净处理，得在退出前 `os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())`，或者显式捕获 `BrokenPipeError`。

还有一个容易忽略的场景：**容器里的进程通常是 PID 1**。内核不会用默认动作去杀 PID 1，所以那里 `SIGPIPE` 实际上被忽略掉了，行为从“退出码 141”变成“`write` 返回 `EPIPE`”。同一条命令在宿主机和容器里表现不同，很多时候就是这个原因。

## 怎么确认自己撞上了 SIGPIPE

三条命令基本够用：

```bash
$ printf '%s\n' "${PIPESTATUS[@]}"     # 每个管道成员的退出码
$ kill -l 13                            # 确认信号编号
$ strace -f -e trace=write -o /tmp/t.log sh -c 'yes | head -n 1'
$ tail -5 /tmp/t.log
```

`strace` 的输出末尾会明确写着 `+++ killed by SIGPIPE +++`，比猜快得多。

想看某个进程是不是已经忽略了它，直接读 `/proc`：

```bash
$ grep -E 'SigIgn|SigCgt' /proc/$$/status
SigIgn: 0000000000001000
```

这是一张 64 位掩码，第 N 号信号对应第 N-1 位。`0x1000` 就是第 13 位，也就是 `SIGPIPE` 被忽略了。这个小技巧在排查“为什么这个进程不按预期死掉”时非常好用。

## 写代码时的两条原则

**做服务端，别让一个连接杀掉整个进程。** 多线程服务器往已断开的 socket 写数据，如果没处理 `SIGPIPE`，默认动作会终止整个进程——一个客户端断开，全体下线。惯常做法是启动时 `signal(SIGPIPE, SIG_IGN)`，然后老老实实检查 `write`/`send` 的返回值和 `EPIPE`；或者对单次发送使用 `send(fd, buf, len, MSG_NOSIGNAL)`，把影响限制在这次调用上。

**做库，别偷偷改全局信号处置。** 信号处置是进程级的，库在初始化时来一句 `signal(SIGPIPE, SIG_IGN)`，会顺手改变调用方的行为，而且很难查。要改就让使用方自己改，或者只用 `MSG_NOSIGNAL` 这种局部手段。

至于 shell 脚本，`pipefail` 依然值得开，只是看到 141 时应该想到：这不是故障，是下游先走了。把 141 当成一种合法的“提前结束”，脚本就安静了。
