> 原文链接：[终端突然卡住，敲什么都不动：先按 Ctrl+Q - 码日新 · 每日文章](https://daily.xplanc.org/zh/linux/终端突然卡住，敲什么都不动：先按-Ctrl+Q.md)

---

# 终端突然卡住，敲什么都不动：先按 Ctrl+Q

一个正在刷日志的终端突然定住，键盘像是坏了，Ctrl+C 也没反应，你甚至怀疑 SSH 断线了。多数时候既不是程序死锁也不是网络故障，而是几十年前串口时代的流控字符被你误触了：按下 Ctrl+S 会让内核暂时停止向终端输出，再按一次 Ctrl+Q 就能恢复。

## 现场还原：一个键让屏幕静止

随便找个能持续输出的命令，边看边按下 Ctrl+S：

```bash
$ yes hello | head -n 100000
hello
hello
hello
```

屏幕停在某一行，光标不再动。你可以继续敲字符、按回车，甚至按 Ctrl+C，看上去都毫无反应。这时先别急着关窗口，按一下 Ctrl+Q：

```bash
$ yes hello | head -n 100000
hello
hello
（停住的位置）
...
$ 
```

输出可能瞬间涌出来，然后提示符出现。如果你之前按过 Ctrl+C，进程其实已经被杀了，只是输出通道还被堵着，你看不到而已。

## Ctrl+S 到底做了什么

早期终端通过串口线连到主机，双方速率不匹配是常事。主机发得太快，终端的缓冲区就会溢出，于是有了**软件流控**：用两个控制字符在数据流里“喊话”。

| 字符 | 按键 | 字节 | 含义 |
| --- | --- | --- | --- |
| XOFF | Ctrl+S | `0x13` | 别发了，我缓存满了 |
| XON | Ctrl+Q | `0x11` | 好了，继续发 |

这套机制被继承到了 Linux 的终端行规程（line discipline）里。当 `IXON` 标志打开时，内核看到你输入了停止字符，就把这个终端的输出暂时挂起；看到启动字符再放行。注意这是**输入方向的控制字符影响输出方向**，所以你敲的键根本没到程序那里，程序完全不知道发生了什么。

`stty -a` 可以直接看到这几个开关：

```bash
$ stty -a | grep -oE -- '-?ixon|-?ixoff|-?ixany'
ixon
```

输出里还能看到 `start = ^Q; stop = ^S`，这就是当前绑定的流控字符。

- `ixon`：收到停止字符就暂停输出，本次问题的主角。
- `ixoff`：输入队列快满时，由终端一侧主动发停止字符给对方，串口时代更常见。
- `ixany`：输入任意字符都能恢复输出，有些系统会默认打开，这时你随便敲个键就“自愈”了，反而更容易被忽略。

顺带一提，SSH 也一样：你按下的 Ctrl+S 经 ssh 转发到远端，起作用的是远端那个 pty 的行规程，所以 Ctrl+Q 同样能救回来。

## 一劳永逸：关掉软件流控

如果终端模拟器支持鼠标选中复制，流控字符在现代交互场景里几乎没用，关掉它最省事：

```bash
$ stty -ixon
```

这条命令只对当前终端生效，新开一个窗口就得重新设。写进 `~/.bashrc`，并用 `$-` 判断是否交互 shell，避免影响非交互脚本：

```bash
# ~/.bashrc
case $- in
    *i*) stty -ixon 2>/dev/null ;;
esac
```

如果你常用 GNU Screen，可以在 `~/.screenrc` 里加一行，让新建的会话默认不启用流控：

```text
# ~/.screenrc
defflow off
```

tmux / Screen 里开的 shell 用的是新的 pty，进去之后最好再确认一次 `stty -a`，别以为外层设了里面就跟着变。

## 关掉之后，Ctrl+S 去哪了

`IXON` 关闭后，`0x13` 不再被内核截获，会交给 readline。在 Bash 里它默认绑定的是**正向搜索历史**：

```bash
$ bind -P | grep forward-search
forward-search-history can be found on "\C-s".
```

于是按下 Ctrl+S 会进入搜索状态，屏幕看起来又像“卡住”了——不过这次按 Enter 或 Ctrl+G 就能退出，输入关键字还能往回找命令。如果你从没用过正向搜索，可以把它解绑：

```bash
# ~/.inputrc
"\C-s": do-nothing
```

反过来，如果你确实依赖流控，也可以只打开 `ixany`，让任意按键都能解冻：`stty ixon ixany`。

## 另外几种“假死”别搞混

- **Ctrl+Z**：发的是 `SIGTSTP`，进程被挂起而不是终端被堵。用 `jobs` 查看，`fg` 拉回前台，`bg` 丢到后台。
- **程序真死循环**：Ctrl+C 无效时可以试 `Ctrl+\`（`SIGQUIT`），或者另开终端 `kill -QUIT <pid>`。
- **SSH 链路断了**：本地按 `~.` 可以直接断开卡住的会话，`~?` 能列出全部转义命令。
- **全屏程序的鼠标选中**：Vim 的 `Ctrl+S` 可能被映射成保存或搜索，先看应用自己的键位，别急着改 `stty`。

下次再遇到终端“死机”，先按 Ctrl+Q，再用 `stty -a` 看一眼 `ixon`。比起重启窗口，这两秒钟的检查能省下不少重新连 SSH 的时间。

## 相关文章

- [Linux 内存去哪了：一次 OOM Killer 排查实录](https://daily.xplanc.org/zh/linux/Linux-内存去哪了：一次-OOM-Killer-排查实录.md)
- [Linux 的时间为什么会被拨回去](https://daily.xplanc.org/zh/linux/Linux-的时间为什么会被拨回去.md)
- [DNS 又变了：谁在偷偷改写 resolv.conf](https://daily.xplanc.org/zh/linux/DNS-又变了：谁在偷偷改写-resolv.conf.md)
- [负载 12，CPU 却在摸鱼：读懂 Linux 的 load average](https://daily.xplanc.org/zh/linux/负载-12，CPU-却在摸鱼：读懂-Linux-的-load-average.md)
- [手动能跑，cron 不跑：定时任务的五个隐形坑](https://daily.xplanc.org/zh/linux/手动能跑，cron-不跑：定时任务的五个隐形坑.md)

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
