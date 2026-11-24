> 原文链接：[文件名只是一张标签：Linux 为什么不会“文件占用” - 码日新 · 每日文章](https://daily.xplanc.org/zh/linux/文件名只是一张标签：Linux-为什么不会“文件占用”.md)

---

# 文件名只是一张标签：Linux 为什么不会“文件占用”

在 Windows 上删一个正在被编辑器打开的文件，多半会弹出“文件正在使用”。同样的操作放到 Linux，`rm` 通常一声不吭就成功，哪怕有个进程正往里写日志。这不是发行版更激进，也不是权限给得太大，而是两套系统对“文件是什么”的理解根本不同：Linux 把名字和数据拆开，文件的生死由引用计数决定，而不是由目录里那个条目决定。理解这一点，日志轮转、配置热替换、升级正在运行的服务这些操作才不再是玄学。

## 名字归名字，数据归数据

在 Linux 的 VFS 里，一个文件至少有两层身份：

- **目录项（dentry）**：你在 `ls` 里看到的那个名字，本质是“名字 → inode 编号”的映射。
- **inode**：真正存放元数据和数据块位置的对象，和名字是一对多的关系。

硬链接就是这种分离最直白的证据：`ln a.txt b.txt` 之后，`a.txt` 和 `b.txt` 指向同一个 inode，删掉其中任何一个，另一个照常能读。`i_nlink` 这个字段记录的就是“还有多少个名字指向我”。

Windows 的传统做法更像是“文件名就是文件本身”，句柄会带着共享模式（允许不允许别人删、读、写）参与 arbitration，所以占用检查发生在打开阶段。Linux 的 `open()` 不检查这些，它只是给进程发一个指向 `struct file` 的文件描述符，而这个结构再指回 inode。名字被拿掉，不影响已经发出的描述符。

## 为什么删掉了还能写

关键在 `unlink()` 的语义：它只做一件事——把名字从目录里摘掉，然后把 inode 的链接数减一。它不管有没有人正拿着 fd 往里写。

真正释放磁盘块的时机是两个条件同时满足：

1. `i_nlink == 0`：没有任何名字指向它了；
2. 没有任何打开的 fd / mmap 还引用它。

所以“删掉”和“释放”在 Linux 里是两个时刻，中间可能隔着几小时甚至几个月。这也是“删了大文件空间没回来”这类问题的根源：名字没了，引用还在。

用一个 bash 小实验就能看完整过程：

```bash
$ exec 9>/tmp/lock-demo.log      # 当前 shell 用 9 号 fd 打开文件
$ echo first >&9
$ rm /tmp/lock-demo.log          # 目录里已经没有这个名字
$ echo second >&9                # 写入依旧成功
$ ls -l /proc/$$/fd/9
l-wx------ 1 me me 64 Nov 24 12:00 /proc/1234/fd/9 -> /tmp/lock-demo.log (deleted)
$ cat /proc/$$/fd/9              # 通过 magic link 还能把内容读回来
first
second
$ exec 9>&-                      # 关掉最后一个 fd，文件此刻才真正消失
```

注意 `(deleted)` 这个后缀：它只是内核在告诉你“这个名字已经不在目录树里了”，并不代表文件不可访问。`/proc/<pid>/fd/<n>` 是救援通道，误删日志后先把内容 `cat` 出来，再谈重启服务。

## 这套设计换来的几个便利

**配置原子替换。** 传统“打开文件 → 清空 → 重写”会让读者撞上半个文件。正确做法是先写临时文件，再改名覆盖：

```bash
$ cp app.yaml app.yaml.new
$ vi app.yaml.new
$ mv -f app.yaml.new app.yaml     # 同一文件系统内是原子操作
```

`rename()` 要么完成要么没完成，读者只会看到旧版或新版。已经在读旧 inode 的进程继续把旧文件读完，新开的进程拿到新版本，不需要加锁协调。

**日志轮转不用停服务。** logrotate 的 `copytruncate` 是妥协方案，而默认的 rename + create 才是这套语义的正面用法：旧 fd 继续写旧 inode，新 fd 写新文件。代价是旧文件占的空间要等进程关 fd 或收到信号才还回来。

**升级不用挑维护窗口。** 动态库被映射进进程后，直接覆盖会破坏映射，但换名替换完全没问题。旧进程跑完这辈子都用旧 `.so`，新启动的进程自动加载新版——这就是 Linux 上“更新完库不用重启整台机器”的底气。

**可执行文件有个例外值得知道。** 正在运行的二进制不能直接写：

```bash
$ cp ./app-new /usr/local/bin/app
cp: cannot create regular file '/usr/local/bin/app': Text file busy
$ mv ./app-new /usr/local/bin/app   # rename 可以
```

`ETXTBSY` 防止你改写正在被执行的映射；而 `rename` 只是换了个名字指向新 inode，所以被允许。

## 什么时候你仍会觉得“被占用”

说“Linux 不会文件占用”是简化说法，下面几种情况会打破直觉：

- **建议锁（advisory lock）**：`flock`、`fcntl(F_SETLK)` 依赖参与者自觉。第二个进程可以完全无视它，`rm` 更不会去看锁表。它解决的是“两个写者互相踩踏”，不是“能不能删”。
- **强制锁**：历史上存在过 mandatory locking，但早已被弃用，新内核里基本不再可用。别把 Windows 的心智模型往这儿套。
- **文件系统语义**：在 FAT/NTFS 挂载点、Samba 共享上，删除行为由对方或协议层决定，Linux VFS 说了不算。Windows 客户端通过 Samba 访问时照样能看到“文件正在使用”。
- **属性位**：`chattr +i` 会让任何修改返回 `Operation not permitted`。这是权限问题，不是占用问题。
- **挂载点忙**：`umount` 报 `target is busy`，通常是因为有进程的 cwd 在里面或还有打开的文件，跟文件锁是两码事。用 `fuser -vm /mnt/usb` 找出进程即可。

排查“名字删了空间没回”时，可以用这两条快速定位：

```bash
$ lsof +L1                                  # 链接数为 0 但仍被打开的文件
$ find /proc/[0-9]*/fd -lname '* (deleted)' 2>/dev/null
```

找到 pid 和 fd 之后，要么优雅地让进程重开日志，要么从 `/proc/<pid>/fd/<n>` 把内容抢救出来，再决定是否重启。

## 小结

Linux 里没有“文件正在使用，无法删除”这回事，是因为名字和数据从来就不是一回事：`unlink` 摘名字，引用计数管生命周期，最后一个 fd 关闭时才释放空间。所谓“占用”的表象，要么来自建议锁这种协作约定，要么来自非原生文件系统、挂载点引用或属性位。把这条边界划清楚，面对日志轮转和原子发布时，你就不用再靠重启去碰运气了。

## 相关文章

- [终端突然卡住，敲什么都不动：先按 Ctrl+Q](https://daily.xplanc.org/zh/linux/终端突然卡住，敲什么都不动：先按-Ctrl+Q.md)
- [chmod 777 之后，为什么还是 Permission denied](https://daily.xplanc.org/zh/linux/chmod-777-之后，为什么还是-Permission-denied.md)
- [文件变了，inotify 为什么没反应](https://daily.xplanc.org/zh/linux/文件变了，inotify-为什么没反应.md)

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
