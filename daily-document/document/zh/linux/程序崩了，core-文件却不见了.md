> 原文链接：[程序崩了，core 文件却不见了 - 码日新 · 每日文章](https://daily.xplanc.org/zh/linux/程序崩了，core-文件却不见了.md)

---

# 程序崩了，core 文件却不见了

段错误让进程瞬间消失，你盼着一份 core 文件还原崩溃现场，翻遍工作目录却一无所获。core dump 的生成由一串开关和路径规则共同控制：shell 的 ulimit 限制、内核的 core_pattern、systemd 的 coredump 接管、目标目录权限，乃至容器的隔离环境，任何一环没打通都会让它悄悄消失。本文从一次真实排查出发，把这些环节逐个拧开，帮你找到那份本该存在的崩溃现场。

## 第一道门：ulimit

最常被忽略的，反而是最基础的那道限制。在触发崩溃的同一个 shell 里先看一眼：

```bash
ulimit -c
```

如果输出是 `0`，内核根本不会写 core 文件，不管程序怎么崩都是白搭。临时打开它：

```bash
ulimit -c unlimited
```

或者给个上限，比如 512 MB：

```bash
ulimit -c 524288
```

注意单位：多数系统里 `-c` 的单位是 1024 字节（块），不是字节。要永久生效，得改 `/etc/security/limits.conf`：

```
* soft core unlimited
* hard core unlimited
```

改完需要重新登录 shell 才会生效。如果程序是由 systemd 服务拉起的，这个配置管不到它，得在服务单元里写：

```ini
[Service]
LimitCORE=infinity
```

然后 `systemctl daemon-reload` 并重启服务。这里有个坑：很多人改完 limits.conf 兴冲冲地跑一遍程序，还是没 core，原因是程序压根不是从那个 shell 启动的。先确认进程的启动方式，再决定改哪一处。

## core 到底写去了哪里

就算允许生成，core 也未必落在你以为的地方。内核按 `/proc/sys/kernel/core_pattern` 决定文件名和路径：

```bash
cat /proc/sys/kernel/core_pattern
```

最常见的值是简简单单的 `core`，意思是写到进程当前工作目录。但很多系统会返回带占位符的模板，比如：

```
/tmp/core.%e.%p.%t
```

常见占位符有这些：

| 占位符 | 含义 |
| --- | --- |
| `%e` | 可执行文件名 |
| `%p` | 进程 PID |
| `%t` | 崩溃时间戳 |
| `%h` | 主机名 |
| `%u` / `%g` | 触发者的 UID / GID |
| `%s` | 导致崩溃的信号编号 |
| `%c` | core 文件大小软限制 |

所以当你发现当前目录没有 `core`，先别急着怀疑人生，去 `/tmp` 或者模板指定的目录找找。改这个模板要写 `/proc` 下的文件：

```bash
echo '/var/cores/core.%e.%p.%t' | sudo tee /proc/sys/kernel/core_pattern
```

重启后会丢失，要持久化就在 `/etc/sysctl.d/` 下放一个配置文件：

```
kernel.core_pattern=/var/cores/core.%e.%p.%t
```

目录 `/var/cores` 必须提前建好且对崩溃进程可写，否则内核照样写不出来——而且这种失败是静默的，日志里不一定有提示。

## 被 systemd 收走的 core

如果你的 `core_pattern` 以管道符 `|` 开头，事情就完全不同了。很多现代发行版默认长这样：

```
|/usr/lib/systemd/systemd-coredump %P %u %g %s %t %c %e
```

这时 core 不会落地成文件，而是被送给 systemd-coredump 服务，压缩后存进 `/var/lib/systemd/coredump/`。用 `coredumpctl` 查看：

```bash
coredumpctl list
coredumpctl info 12345
```

直接进 gdb 调试：

```bash
coredumpctl gdb 12345
```

或者导出成传统 core 文件：

```bash
coredumpctl dump 12345 > core
```

这一环最常见的误会是：用户设好了 `ulimit -c unlimited`，盯着当前目录死等，却不知道 core 早被 systemd 收走了。`coredumpctl list` 一查，往往就在里面躺着。

## suid 程序的特殊待遇

还有一类坑只对 setuid 程序生效。出于安全考虑，内核默认不给设置了 setuid 位的程序写 core，防止 core 里的内存内容泄露敏感信息。控制开关是：

```bash
cat /proc/sys/fs/suid_dumpable
```

默认值 `0` 表示完全不写，`1` 是传统行为，`2` 是受限模式，core 文件以只有 root 可读的方式写入。调试需要时临时设为 `2`：

```bash
echo 2 | sudo tee /proc/sys/fs/suid_dumpable
```

调完记得改回去，长期开着等于给敏感信息开了个口子。

## 容器里的额外一层

容器环境下问题会叠得更多。Docker 默认会覆盖 core_pattern，而且默认 core 大小是受限的，启动时要显式放开：

```bash
docker run --ulimit core=-1 -v /host/cores:/cores ...
```

进入容器后还得确认 `/proc/sys/kernel/core_pattern` 指向的路径在容器里可见——宿主的路径映射进去可能完全是另一回事。Kubernetes 里则要在 Pod 的 securityContext 里配置，并保证卷被正确挂载。

## 拿到 core 之后

core 文件有了，还要能读得懂。用 gdb 打开：

```bash
gdb ./program /var/cores/core.program.1234.1700000000
```

进去后 `bt` 看调用栈，`frame` 切换栈帧，`info locals` 看局部变量：

```
(gdb) bt
(gdb) frame 3
(gdb) info locals
```

前提是程序编译时带了调试符号（`-g`），而且 gdb 加载的二进制和 core 生成时用的是同一个版本、同一套动态库。上线时把可执行文件随手一换，回头再调试旧 core，栈可能就是一团乱麻——所以发布时留一份带符号的二进制是值得的。

## 一份排查清单

下次再遇到“core 去哪了”，按这个顺序走一遍基本不会漏：

1. 在崩溃进程的上下文里查 `ulimit -c`，systemd 服务则看 `LimitCORE`。
2. 看 `/proc/sys/kernel/core_pattern`，弄清是写文件还是走管道。
3. 走管道就用 `coredumpctl list` 找。
4. 确认目标目录存在、可写、路径可拼接。
5. setuid 程序额外查 `fs.suid_dumpable`。
6. 容器里再查一遍 ulimit 和路径映射。

core dump 的链条不长，但每一环都安静得很。与其等崩溃发生时手忙脚乱，不如提前把这几处配好，真出事时就能少熬一个通宵。

## 相关文章

- [管道里的 count，出了循环就归零](https://daily.xplanc.org/zh/linux/管道里的-count，出了循环就归零.md)
- [tail -f 跟着跟着就跟丢了：日志轮转后发生了什么](https://daily.xplanc.org/zh/linux/tail--f-跟着跟着就跟丢了：日志轮转后发生了什么.md)
- [chmod 777 之后，为什么还是 Permission denied](https://daily.xplanc.org/zh/linux/chmod-777-之后，为什么还是-Permission-denied.md)

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
