> 原文链接：[文件变了，inotify 为什么没反应 - 码日新 · 每日文章](https://daily.xplanc.org/linux/文件变了，inotify-为什么没反应.md)

---

# 文件变了，inotify 为什么没反应

有个很典型的场景：程序启动时用 inotify 监控配置文件，收到事件就重新加载。开发机上测试正常，上线后偶尔失效，重启进程又好了。日志里没有任何报错，文件确实变了，事件就是没来。

inotify 的接口很简单，但它的语义和大多数人的直觉有几处偏差。下面这几个坑，基本覆盖了“监控失灵”的绝大多数情况。

## 先确认事件到底有没有发出来

别急着怀疑内核，先用 `inotifywait` 看一眼：

```bash
inotifywait -m -e close_write,create,moved_to,delete /etc/myapp
```

另开一个终端，依次做三种修改：

```bash
echo "x=1" >> /etc/myapp/app.conf          # 原地追加
sed -i 's/x=1/x=2/' /etc/myapp/app.conf    # 原子替换
mv /tmp/app.conf.new /etc/myapp/app.conf   # 改名覆盖
```

第一种会看到 `CLOSE_WRITE`；后两种看到的是 `CREATE`、`MOVED_TO`，而不是你期待的那个文件上的 `MODIFY`。如果只监控了 `app.conf` 这个文件，后两种操作之后，监控就彻底安静了。

## 坑一：watch 绑在 inode 上，不是路径上

`inotify_add_watch(fd, "/etc/myapp/app.conf", ...)` 实际监视的是这个路径当前指向的 inode。路径只是用来找到 inode 的，之后就不重要了。

而很多“保存文件”的操作并不是原地改写：

- `sed -i`：写临时文件，再 rename 覆盖原文件
- `mv new.conf app.conf`：直接换掉目录项
- 多数编辑器的“原子保存”：写临时文件，fsync，rename
- logrotate 的默认 create 模式：旧文件改名，新建同名文件
- Kubernetes ConfigMap 更新：替换 `..data` 符号链接

这些操作都会让原路径指向一个新的 inode。旧 inode 被删除后，你手里的 watch 收到 `IN_DELETE_SELF` / `IN_IGNORED`，然后失效。之后新文件发生什么，都与你无关。

验证一下：

```bash
stat -c '%i %n' /etc/myapp/app.conf
sed -i 's/x=2/x=3/' /etc/myapp/app.conf
stat -c '%i %n' /etc/myapp/app.conf
```

两次输出的 inode 号不同。

正确做法是监控目录，而不是文件：

```c
inotify_add_watch(fd, "/etc/myapp",
                  IN_CLOSE_WRITE | IN_CREATE | IN_MOVED_TO | IN_DELETE);
```

收到 `CLOSE_WRITE`（原地写）或 `MOVED_TO`（替换进来）后，再按路径去 stat/读取。目录本身不会被替换，watch 就能一直活着。如果目录被删了，收到 `IN_DELETE_SELF` 后要重建 watch；如果用符号链接指向配置目录，注意 `add_watch` 默认会跟随链接，替换链接目标同样会让 watch 失效。

## 坑二：事件队列满了，内核直接丢

每个 inotify 实例有一个内核事件队列。应用读得慢，或者短时间事件太多，队列就会满。满了之后内核不会阻塞写入方，而是丢掉后续事件，并给你一个 `IN_Q_OVERFLOW`。

查看上限：

```bash
cat /proc/sys/fs/inotify/max_queued_events
# 典型值 16384
```

队列满时，你只知道“有事件丢了”，不知道丢了哪些。这时候唯一正确的处理是全量重新扫描，把状态对齐，而不是继续等下一个事件。很多程序恰恰漏了这一步，于是永久性地漏掉了一个文件。

可以适当调大上限：

```bash
sudo sysctl -w fs.inotify.max_queued_events=65536
```

持久化写入 `/etc/sysctl.d/99-inotify.conf`：

```
fs.inotify.max_queued_events = 65536
```

但调大只是延缓问题。事件循环里不要做重活：把解析、网络请求、重启服务丢到队列或单独线程，读事件的速度要跟得上。对高频写的文件做 100～200ms 的防抖，也能显著削峰。

另外，`read` 的缓冲区要足够大。缓冲区装不下一个完整事件时，`read` 会返回 `EINVAL`。建议直接给 64KB。

## 坑三：递归和 watch 数量都要自己管

inotify 没有“递归监控”这个选项。`inotify_add_watch` 一次只加一个目录。

`inotifywait -r` 这类工具会在用户态遍历目录、逐个添加 watch，所以看起来是递归的；但如果你自己写，就必须在收到“新建目录”事件时补上 watch，否则新目录里的变化永远收不到。移动进来一棵已经包含文件的目录树时，还要把整棵树补一遍。

watch 数量也有上限，按用户（UID）计数：

```bash
cat /proc/sys/fs/inotify/max_user_watches
cat /proc/sys/fs/inotify/max_user_instances
```

超限时 `inotify_add_watch` 返回 `ENOSPC`，错误信息是“No space left on device”，很容易被误判成磁盘满了。监控 `node_modules`、大量小文件目录，或者容器里多个进程各建一套 watch，都很容易撞上。容器共享宿主内核，同一 UID 的额度会互相挤占，具体计数方式随内核版本和 user namespace 配置略有差异，以实际报错为准。

```bash
sudo sysctl -w fs.inotify.max_user_watches=524288
```

## 坑四：IN_MODIFY 不代表写完了

一次 `write` 可能触发多个 `IN_MODIFY`，而且事件到达时，文件内容可能只写了一半。收到 `IN_MODIFY` 就立刻读文件、解析配置，轻则解析失败，重则读到不完整的状态。

判断“这次写结束了”的信号是 `IN_CLOSE_WRITE`：写方关闭文件时触发。对于“临时文件 + rename”的保存方式，则是目录上的 `IN_MOVED_TO`。两种都处理，才能覆盖常见的写入方式。

如果写方长时间持有文件描述符、分多次写，`CLOSE_WRITE` 会来得很晚。这时可以结合防抖：收到第一批事件后等 100～200ms，再统一读一次。但不要把防抖时间设得太长，否则“改完配置马上验证”的体验会很差。

还有一点：事件只告诉你“变了”，不告诉你“变成什么”。别试图从事件里推断内容，老老实实重新读文件。

## 坑五：远程文件系统不会给你事件

inotify 是本地内核机制。NFS、SMB 上由其他机器写入的文件，不会在你的机器上产生 inotify 事件；Docker Desktop 在 macOS/Windows 上的 bind mount 经过一层文件共享，事件也经常不可靠。

这类场景没有银弹，只能轮询兜底：定期 stat 比较 mtime 和 size，或者用校验和。把轮询间隔设成 2～5 秒，对配置文件来说通常够用。不要因为 inotify 在开发机上好用，就假设它在所有挂载点上行为一致。

## 一个能跑的最小实现

下面这个程序监控单个目录，处理原地写、原子替换和队列溢出，可以直接编译运行：

```c
#define _GNU_SOURCE
#include <sys/inotify.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#define BUF_SIZE (64 * 1024)

int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "usage: %s DIR\n", argv[0]);
        return 2;
    }

    int fd = inotify_init1(IN_CLOEXEC);
    if (fd < 0) { perror("inotify_init1"); return 1; }

    int wd = inotify_add_watch(fd, argv[1],
        IN_CLOSE_WRITE | IN_CREATE | IN_MOVED_TO |
        IN_DELETE | IN_DELETE_SELF);
    if (wd < 0) { perror("inotify_add_watch"); return 1; }

    char buf[BUF_SIZE]
        __attribute__((aligned(__alignof__(struct inotify_event))));

    for (;;) {
        ssize_t n = read(fd, buf, sizeof buf);
        if (n < 0) {
            if (errno == EINTR) continue;
            perror("read");
            return 1;
        }

        for (char *p = buf; p < buf + n; ) {
            struct inotify_event *ev = (struct inotify_event *)p;

            if (ev->mask & IN_Q_OVERFLOW) {
                fprintf(stderr, "overflow: full rescan required\n");
            } else if (ev->mask & IN_IGNORED) {
                fprintf(stderr, "watch removed: re-add it\n");
            } else if (ev->mask & IN_CLOSE_WRITE) {
                printf("changed: %s/%s\n", argv[1], ev->name);
            } else if (ev->mask & IN_MOVED_TO) {
                printf("replaced: %s/%s\n", argv[1], ev->name);
            } else if (ev->mask & (IN_CREATE | IN_DELETE)) {
                printf("%s: %s/%s\n",
                       (ev->mask & IN_CREATE) ? "created" : "deleted",
                       argv[1], ev->name);
            }

            p += sizeof(struct inotify_event) + ev->len;
        }
    }
}
```

编译并运行：

```bash
cc -O2 -Wall -o watch watch.c
./watch /etc/myapp
```

生产环境还要补两块：把 `wd` 映射到目录路径，以及在 `IN_CREATE | IN_ISDIR` 时递归补 watch。`IN_Q_OVERFLOW` 分支要真的触发一次全量扫描，而不是只打日志。

## 排查清单

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| 保存一次后再也没事件 | 文件被 rename 替换，watch 失效 | 监控目录，处理 `CLOSE_WRITE` / `MOVED_TO` |
| 跑一段时间后开始漏 | 队列溢出 | 处理 `IN_Q_OVERFLOW`，全量重扫，调大上限 |
| 新建子目录里的变化收不到 | 没有递归补 watch | 收到新目录事件时 `add_watch` |
| `add_watch` 报 ENOSPC | watch 数量超限 | 调大 `max_user_watches` |
| 读到半截配置 | 在 `IN_MODIFY` 时就读 | 等 `CLOSE_WRITE`，加防抖 |
| 远程机器改了没反应 | NFS/SMB/共享挂载 | 轮询兜底 |
| 监控符号链接失效 | 链接目标被替换 | 监控链接所在目录，或加 `IN_DONT_FOLLOW` 后自行解析 |

inotify 本身没有问题，问题通常在于把它当成了“路径变化通知”。它通知的是 inode 上的事件，队列会丢，递归要自己加，远程文件系统还不管。把这四件事想清楚，配置热加载之类的功能就稳了。
