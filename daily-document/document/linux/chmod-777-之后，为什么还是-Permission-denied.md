> 原文链接：[chmod 777 之后，为什么还是 Permission denied - 码日新 · 每日文章](https://daily.xplanc.org/linux/chmod-777-之后，为什么还是-Permission-denied.md)

---

# chmod 777 之后，为什么还是 Permission denied

先还原一个很常见的现场。

服务换到新机器，日志目录写不进去。值班的同学熟练地敲下：

```bash
sudo chmod -R 777 /srv/app
```

再试一次，还是：

```text
touch: cannot touch '/srv/app/logs/app.log': Permission denied
```

于是权限被加到 7777，加上 `-R`，再加上 `sudo`，最后开始怀疑内核有 bug。

大多数时候，问题不在权限位，而在于我们默认“权限”只有 `rwx` 这一层。Linux 在真正打开一个文件之前，要穿过好几道门：路径上的目录、umask、ACL、挂载选项、LSM、文件属性，任何一道没过去，`chmod 777` 都只是把第一道门拆了。

下面按排查顺序，把这几道门逐个走一遍。

## 第一步：先分清 errno

报错信息里的英文，其实已经给了线索。`Permission denied` 和 `Operation not permitted` 不是一回事。

| errno | 典型含义 | 常见来源 |
| --- | --- | --- |
| `EACCES` (13) | 权限不足 | 权限位、ACL、`noexec`、SELinux |
| `EPERM` (1) | 操作本身不被允许 | `chattr +i`、非文件所有者执行 `chmod`、能力缺失 |
| `EROFS` (30) | 只读文件系统 | 只读挂载、容器只读根目录 |
| `EDQUOT` (122) | 配额超限 | 用户/项目磁盘配额 |
| `ETXTBSY` (26) | 可执行文件正被占用 | 一边运行一边覆盖二进制 |

看到 `Operation not permitted` 还去 `chmod`，方向就已经错了。

## 第二道门：路径上每一级目录都要有 x

这是最容易被忽略的一条。要访问 `/srv/app/logs/app.log`，内核会依次穿过 `/`、`/srv`、`/srv/app`、`/srv/app/logs`，**每一级目录都需要执行位 `x`**。目录的 `x` 不是“能运行”，而是“能进入、能按名字找到里面的东西”。

```bash
$ mkdir -p /srv/app/logs
$ chmod 777 /srv/app/logs
$ sudo -u nobody touch /srv/app/logs/a.log
touch: cannot touch '/srv/app/logs/a.log': Permission denied
```

`logs` 已经是 777，为什么还不行？用 `namei` 把整条路径的权限摊开看：

```bash
$ namei -l /srv/app/logs/a.log
f: /srv/app/logs/a.log
drwxr-xr-x root root /
drwxr-xr-x root root srv
drwx------ root root app
drwxrwxrwx root root logs
```

问题出在 `/srv/app` 是 `700`。`logs` 再开放，`nobody` 也进不到它父亲那一层。

顺便记住目录三个位的真实含义：

- `r`：能列出目录里的名字；
- `x`：能进入目录、能访问已知名字的条目；
- `w`：能在目录里创建、删除、重命名条目。

只有 `r` 没有 `x` 时，`ls` 能看到文件名，但 `ls -l` 会满屏 `?`，因为拿不到元数据。只有 `x` 没有 `r` 时，反而可以在知道完整路径的情况下直接访问文件。

还有一个变种：目录带 sticky bit（比如 `/tmp` 的 `1777`），即使大家都有 `w`，也只能删除自己的文件。这是“写得进去却删不掉”的常见原因。

## 第三道门：umask 决定了新文件的起点

`chmod 777` 只改已经存在的对象。之后新建的文件，权限由创建时的 `mode & ~umask` 决定。

```bash
$ umask
0022
$ touch demo.txt
$ stat -c '%a %n' demo.txt
644 demo.txt
```

普通文件默认起点是 `666`，目录是 `777`，再被 umask 削掉。所以 `umask 022` 下新建文件是 `644`，新建目录是 `755`。

如果某个进程的 umask 是 `077`，它写出来的文件就是 `600`，别的用户自然读不了。systemd 服务可以在 unit 里设置：

```ini
[Service]
UMask=0027
```

排查时可以看进程的当前 umask：

```bash
$ grep -i umask /proc/$(pgrep -f myapp | head -1)/status
Umask:  0022
```

## 第四道门：ACL 会把权限“打折”

`ls -l` 末尾出现 `+`，说明这个文件带 ACL：

```bash
$ ls -l report.txt
-rw-r--r--+ 1 alice dev 1024 Nov  2 10:00 report.txt
```

```bash
$ getfacl -p report.txt
# file: report.txt
# owner: alice
# group: dev
user::rw-
user:bob:rwx                  #effective:r--
group::r--
mask::r--
other::r--
```

`bob` 明明被授予了 `rwx`，有效权限却只有 `r--`。原因是 ACL 里的 `mask` 相当于“权限上限”，命名用户和所属组的权限都要和 mask 取交集。

更隐蔽的是：**文件一旦有 ACL，`chmod g+w` 改的其实是 mask，不是 group 位**。所以你会看到 `chmod` 执行成功，`getfacl` 里的具体条目却没变。

修复方式是把 mask 一起放开：

```bash
setfacl -m u:bob:rwx,m::rwx report.txt
```

目录还可以设置默认 ACL，让以后新建的文件自动继承：

```bash
setfacl -d -m u:deploy:rwx /srv/app/logs
```

## 第五道门：挂载选项可能禁止执行

权限位全是 `777`，`./tool` 仍然报 `Permission denied`，先看挂载参数：

```bash
$ findmnt -T /srv/app -o TARGET,SOURCE,FSTYPE,OPTIONS
TARGET    SOURCE    FSTYPE OPTIONS
/srv/app  /dev/sdb1 ext4   rw,nosuid,nodev,noexec,relatime
```

`noexec` 会让 `execve()` 直接返回 `EACCES`，和文件权限无关。`/tmp`、`/var/tmp`、某些数据盘默认这么挂，是常见的安全加固。

一个容易混淆的细节：`noexec` 只拦“把文件本身当作程序执行”。下面这条仍然可能成功：

```bash
$ bash /srv/app/script.sh
```

因为真正被 `execve` 的是 `/bin/bash`，脚本只是被当成参数读进去。反过来，`ro` 挂载会让所有写操作返回 `EROFS`，容器里只读根文件系统时尤其常见。

## 第六道门：SELinux 和 AppArmor

权限位、ACL、挂载选项都正常，还是被拒，就该怀疑 Linux Security Module 了。

SELinux 环境下先看上下文：

```bash
$ getenforce
Enforcing
$ ls -Z /srv/app/logs
unconfined_u:object_r:var_t:s0 /srv/app/logs
```

如果服务应该读写 `httpd_sys_content_t` 之类的类型，而目录被打成了 `var_t`，即使 `777` 也会被拒绝。查最近一次的拒绝记录：

```bash
$ sudo ausearch -m avc -ts recent
$ sudo dmesg | grep -i 'avc:  denied'
```

确认是标签问题后，用 `restorecon` 恢复默认上下文，而不是直接 `setenforce 0`：

```bash
sudo restorecon -Rv /srv/app
```

AppArmor 则看 `aa-status` 和 `dmesg`，被 profile 拦下时同样表现为 `EACCES`。

把安全模块一关了之，问题会暂时消失，但下次上线还会回来，而且是以更难查的形式。

## 第七道门：chattr 的文件属性

`chattr +i` 设置的不可变属性，连 root 都改不了：

```bash
$ sudo chattr +i /etc/resolv.conf
$ sudo sh -c 'echo "nameserver 1.1.1.1" > /etc/resolv.conf'
sh: /etc/resolv.conf: Operation not permitted
```

注意报错是 `Operation not permitted`，不是 `Permission denied`。查看属性：

```bash
$ lsattr /etc/resolv.conf
----i---------e------- /etc/resolv.conf
```

`i` 表示不可变，`a` 表示只能追加。去掉再改：

```bash
sudo chattr -i /etc/resolv.conf
```

这里还有一个 shell 层面的坑：

```bash
sudo echo "nameserver 1.1.1.1" > /etc/resolv.conf
```

即使文件可写也会失败，因为重定向是当前 shell 做的，`sudo` 只提升了 `echo` 的权限。正确写法是让特权进程自己打开文件：

```bash
echo "nameserver 1.1.1.1" | sudo tee /etc/resolv.conf
```

## 还有两类环境因素

**NFS 的 root squash。** 服务端开启 `root_squash` 后，客户端的 root 会被映射成 `nobody`，在共享目录里并不具备超级用户权限。表现就是“我是 root，为什么还写不进去”。

**容器里的 UID 映射。** 容器内的 `uid 1000` 和宿主机上的 `uid 1000` 未必是同一个用户，启用 user namespace 后更是如此。挂载卷的属主看起来对，实际对不上，`chmod 777` 在容器内也可能作用在另一层文件系统上。

## 一张排查清单

遇到权限问题，按这个顺序走，通常五分钟内能定位：

1. 看 errno：`EACCES`、`EPERM`、`EROFS` 指向完全不同的方向；
2. `namei -l /path/to/file`，确认路径上每一级目录都有 `x`；
3. `getfacl`，检查 ACL 和 mask；
4. `findmnt -T /path`，确认没有 `ro`、`noexec`；
5. `lsattr`，排除 `i`、`a` 属性；
6. `getenforce`、`aa-status`、`ausearch`，检查安全模块；
7. 最后才考虑 NFS 映射、容器 UID、磁盘配额这些环境因素。

`chmod 777` 的问题不在于它危险——虽然它确实危险——而在于它只覆盖了整条链路上的一小段。真正让人加班到凌晨的，往往是那个 `700` 的父目录，或者一行 `noexec`。

下次再看到 `Permission denied`，先别急着加权限。让 `namei` 把路径摊开，答案通常就在里面。
