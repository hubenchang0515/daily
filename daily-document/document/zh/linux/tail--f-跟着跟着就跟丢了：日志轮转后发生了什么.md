> 原文链接：[tail -f 跟着跟着就跟丢了：日志轮转后发生了什么 - 码日新 · 每日文章](https://daily.xplanc.org/zh/linux/tail--f-跟着跟着就跟丢了：日志轮转后发生了什么.md)

---

# tail -f 跟着跟着就跟丢了：日志轮转后发生了什么

`tail -f` 盯着日志文件时，应用明明还在写，屏幕却突然安静下来；另开一个终端 `tail -f` 同一个路径，内容又源源不断。问题多半不在 tail，而在日志轮转：旧文件被改名，新文件同名的建出来，而 tail 始终盯着旧文件的 inode。多数情况下把 `-f` 换成 `-F` 就能解决，但理解背后发生了什么，能帮你避开更多坑。

## 现象：文件还在长，屏幕不动了

先看一个典型的 logrotate 配置：

```conf
/var/log/myapp/*.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
    create 0640 myapp myapp
}
```

`create` 这一行是关键。轮转时发生的事情不是“清空文件”，而是：

1. 把 `app.log` 改名为 `app.log.1`；
2. 新建一个空的 `app.log`，权限按 `create` 指定的来；
3. 压缩、删除旧备份等后续动作。

应用进程并不会因为文件名变了就自动改写入目标。它持有的仍是那个已经改名的文件描述符，继续往 `app.log.1` 里写。与此同时，`tail -f app.log` 也持有旧的描述符，它其实还在忠实地输出——只是输出的是一个没人再写的新名字。等你再去 `tail -f app.log`，打开的是刚创建的空文件，两边看到的自然不是同一份内容。

用 `lsof` 可以确认这一点：

```bash
lsof -p "$(pgrep -f myapp)" | grep log
# myapp  1234 app  3w REG 253,1 1048576 123456 /var/log/myapp/app.log.1
```

## -f 与 -F 到底差在哪

很多人以为 `-F` 只是 `-f` 的“加强版”，实际上它们跟踪的依据不同：

| 写法 | 展开后 | 跟踪依据 | 文件被改名后 | 文件被原地截断后 |
| --- | --- | --- | --- | --- |
| `tail -f app.log` | `--follow=descriptor` | 文件描述符（inode） | 继续读旧文件，看不到新内容 | 检测到变小后回到开头继续读 |
| `tail -F app.log` | `--follow=name --retry` | 文件名 | 自动重新打开新文件 | 继续读 |
| `tail --follow=descriptor` | 同 `-f` | 描述符 | 同上 | 同上 |
| `tail --follow=name --retry` | 同 `-F` | 文件名 | 同上 | 同上 |

`--retry` 的作用也别忽略：轮转的瞬间旧文件已经改名、新文件还没建好，按名字跟踪会打不开文件。`-F` 会一直重试，等新文件出现再跟上；单独写 `--follow=name` 而没有 `--retry`，遇到文件暂时不存在就可能直接退出。

## 自己复现一遍

不需要真装 logrotate，两条命令就能把现象造出来。终端 A：

```bash
mkdir -p /tmp/taildemo && cd /tmp/taildemo
rm -f app.log app.log.1
( for i in $(seq 1 1000); do
    printf '%s line %d\n' "$(date +%T)" "$i"
    sleep 1
  done ) > app.log &
echo $! > writer.pid

tail -f app.log
```

终端 B 里模拟轮转，然后重启写入进程，让它改用新文件：

```bash
cd /tmp/taildemo
mv app.log app.log.1
: > app.log
kill "$(cat writer.pid)"
( for i in $(seq 1 1000); do
    printf '%s new %d\n' "$(date +%T)" "$i"
    sleep 1
  done ) > app.log &
echo $! > writer.pid
```

终端 A 会停在那儿不动，而新开一个 `tail -f app.log` 却能正常输出。此时在终端 A 按 `Ctrl+C`，改用 `tail -F app.log`，它会在几秒内重新跟上。

## 让应用也跟着换文件

`tail -F` 治的是观察端，写入端如果一直抱着旧描述符，磁盘上就会出现“新文件空着、旧文件里全是日志还被压缩了”的怪现象。正规做法是在 `postrotate` 里通知应用重新打开日志：

```conf
/var/log/myapp/*.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
    create 0640 myapp myapp
    sharedscripts
    postrotate
        if [ -f /run/myapp.pid ]; then
            kill -HUP "$(cat /run/myapp.pid)"
        fi
    endscript
}
```

前提是程序真的处理了 `SIGHUP`，nginx、rsyslog 这类守护进程都支持。自己写的程序收不到信号，就在 `postrotate` 里优雅重启；实在改不动的老程序，可以退一步用 `copytruncate`：

```conf
copytruncate
```

它先复制一份旧日志，再原地截断原文件，描述符始终有效，`tail -f` 也就不会走丢。代价是复制大文件时耗时、复制与截断之间存在极短的丢失窗口，而且这个窗口里可能有半条日志。日志量不大、又不能改程序时，这个折中可以接受。

还有一种更稳的写法：让应用固定写 `current` 这个符号链接，轮转时只切换链接指向，观察端统一用 `tail -F current`。名字不变，`-F` 每次重开都能拿到最新目标。

## 几个容易一起踩的坑

`tail -f app.log | grep ERROR` 没输出，不一定是 tail 停了。grep 在管道里默认块缓冲，加 `--line-buffered` 才逐行吐：

```bash
tail -F app.log | grep --line-buffered ERROR
```

用 `less +F` 看日志同理，`less` 默认也是按描述符跟随，启动时加上 `--follow-name` 才能应对轮转。进入 follow 模式后按 `Ctrl+C` 退出，按 `F` 可以重新从末尾跟随。

多文件跟踪时，GNU tail 会打印 `==> file <==` 这样的头。轮转后头上的名字还是旧的，别被它误导，看一下 `ls -li` 里的 inode 就清楚了。

如果是 systemd 服务，优先用 `journalctl -u myapp -f`；容器里用 `docker logs -f`。它们把轮转和跟随都封装在自己的机制里，通常不用操心 inode 这件事。

记住三点就够了：logrotate 默认做的是“改名加新建”；应用和 `tail -f` 都靠描述符认文件，不认名字；想按名字追就用 `-F`，想让写入端也换文件，就在 `postrotate` 里发 `SIGHUP` 或重启服务。

## 相关文章

- [Argument list too long：参数撞上的那堵墙](https://daily.xplanc.org/zh/linux/Argument-list-too-long：参数撞上的那堵墙.md)
- [DNS 又变了：谁在偷偷改写 resolv.conf](https://daily.xplanc.org/zh/linux/DNS-又变了：谁在偷偷改写-resolv.conf.md)
- [改了 /etc/hosts，为什么还是连到旧地址](https://daily.xplanc.org/zh/linux/hosts，为什么还是连到旧地址.md)
- [管道里的 count，出了循环就归零](https://daily.xplanc.org/zh/linux/管道里的-count，出了循环就归零.md)
- [Linux 内存去哪了：一次 OOM Killer 排查实录](https://daily.xplanc.org/zh/linux/Linux-内存去哪了：一次-OOM-Killer-排查实录.md)

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
