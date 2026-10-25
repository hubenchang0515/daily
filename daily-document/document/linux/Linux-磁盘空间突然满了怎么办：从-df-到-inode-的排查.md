# Linux 磁盘空间突然满了怎么办：从 df 到 inode 的排查

凌晨收到监控告警：根分区使用率 96%。登录服务器后 `df -h` 显示 `/` 确实快满了，但用 `du` 扫描却找不到对应的大文件。这种“空间对不上”的情况在 Linux 上很常见，原因通常不止一种。下面按从易到难的顺序梳理一遍排查流程。

## 第一步：先分清是容量满还是 inode 满

```bash
df -h
df -i
```

`df -h` 看的是数据块容量，`df -i` 看的是 inode 使用率。两者的区别很关键：如果容量还有剩余，但 `IUse%` 已经到 100%，那么即使删掉大文件也不管用，因为新的文件根本创建不出来。

inode 耗尽通常由海量小文件造成，常见来源包括会话文件、邮件队列、缓存目录、`node_modules`，以及容器的镜像层。先确认是哪种“满”，再决定往哪个方向查。

## 第二步：用 du 定位大目录

确认是容量问题后，从根目录逐层往下钻：

```bash
sudo du -x -h --max-depth=1 / 2>/dev/null | sort -h
```

`-x` 表示不跨越文件系统，避免扫进 `/proc`、`/sys` 和其他挂载点；`sort -h` 按人类可读的单位排序。找到最大的目录后，把路径替换进去继续下钻：

```bash
sudo du -x -h --max-depth=1 /var 2>/dev/null | sort -h
```

注意 `du -sh *` 不会包含隐藏文件，需要时可以用 `du -sh .[!.]* *`。另外，普通用户运行时权限不足会导致统计偏小，排查时尽量用 `sudo`。

如果 `df` 和 `du` 的结果始终对不上，常见原因有三类：

- 已删除但仍被进程占用的文件；
- 文件系统为 root 保留了部分块，普通用户看到的可用空间偏小；
- 有文件被挂载点“盖住”，`du` 扫不到。

## 第三步：处理已删除但仍被占用的文件

这是最经典的坑。日志文件被 `rm` 掉后，目录项没了，但只要还有进程持有文件描述符，数据块就不会释放。`du` 看不见它，`df` 却照样算账。

```bash
sudo lsof +L1
sudo lsof -nP | grep '(deleted)'
```

`+L1` 表示列出链接数小于 1 的打开文件。确认是哪个进程、哪个 fd 之后，最稳妥的做法是重启或 reload 对应服务。如果不方便重启，可以截断该 fd：

```bash
sudo sh -c ': > /proc/1234/fd/5'
```

这里必须用 `sh -c` 包一层，否则重定向会由当前 shell 执行，权限不够。截断后空间立即释放，但要注意目标文件是否适合被清空。

## 第四步：日志与缓存

系统日志和包管理器缓存往往是占用大户：

```bash
journalctl --disk-usage
sudo journalctl --vacuum-size=500M
sudo journalctl --vacuum-time=14d
```

Debian/Ubuntu 可以 `sudo apt clean`，RHEL 系用 `sudo dnf clean all`，Arch 用 `sudo pacman -Sc`。

对于普通日志，不要直接 `rm`，而应清空或交给 logrotate：

```bash
sudo truncate -s 0 /var/log/app.log
```

直接删除正在写入的日志，很可能又制造出第三步里的“已删除仍占用”问题。

## 第五步：inode 用尽时找小文件

GNU coreutils 较新的版本支持按 inode 统计：

```bash
sudo du -x --inodes --max-depth=1 / 2>/dev/null | sort -n
```

找到 inode 集中的目录后继续下钻，再结合文件数量确认：

```bash
find /var/spool -xdev -type f 2>/dev/null | wc -l
```

清理时要确认这些文件确实可以删除，尤其是队列目录和数据库临时文件。

## 速查表

| 现象 | 常用命令 | 处理方式 |
| --- | --- | --- |
| 容量使用率高 | `df -h`、`du -x -h` | 定位大目录并清理 |
| inode 使用率 100% | `df -i`、`du --inodes` | 清理海量小文件 |
| df 与 du 不一致 | `lsof +L1` | 重启服务或截断 fd |
| 日志占用大 | `journalctl --disk-usage` | vacuum 或 logrotate |
| 容器占用大 | `docker system df` | `docker system prune` |

容器环境还要单独看一眼：

```bash
docker system df
docker system prune
```

`prune` 会删除已停止的容器、未使用的网络和悬空镜像，执行前确认没有需要保留的构建缓存。

排查磁盘问题的核心思路其实很简单：先判断是容量还是 inode，再用 `du` 定位，最后解释 `df` 与 `du` 的差异。多数“删了文件空间没回来”的情况，答案都藏在 `lsof +L1` 里。
