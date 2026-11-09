> 原文链接：[改了 /etc/hosts，为什么还是连到旧地址 - 码日新 · 每日文章](https://daily.xplanc.org/linux/hosts，为什么还是连到旧地址.md)

---

# 改了 /etc/hosts，为什么还是连到旧地址

线上把 `api.internal` 从 `10.0.0.8` 迁到 `10.0.0.9`。你在 `/etc/hosts` 里改完，`ping` 已经通了，`curl` 也拿到了新地址，但 Java 服务重启后仍然连着旧 IP。于是开始怀疑 DNS、怀疑网络，最后发现 `hosts` 只是整条解析链上的一环。

这类问题有个固定的排查顺序：**先确认谁在解析，再确认有没有缓存，最后确认进程看到的是不是你改的那个文件。**

## 一、`dig` 和 `nslookup` 根本不看 `/etc/hosts`

这是第一个坑。`dig api.internal` 直接向 DNS 服务器发查询，完全不读本机 `hosts` 文件。用它验证 hosts 修改，只会得到 NXDOMAIN 或旧的 DNS 记录。

验证 hosts 应该用 `getent`，它走的是 glibc 的 NSS 解析链：

```bash
getent hosts api.internal
getent ahosts api.internal
```

`getent ahosts` 会把所有地址和顺序列出来：

```text
10.0.0.9        STREAM api.internal
10.0.0.9        DGRAM
10.0.0.9        RAW
```

如果这里已经是新地址，说明 hosts 文件和 NSS 配置没问题，问题在应用缓存或应用自己的解析器；如果这里还是旧地址，继续往下看。

## 二、解析顺序由 `nsswitch.conf` 决定

glibc 先读 `/etc/nsswitch.conf`，再决定去哪找主机名：

```bash
grep '^hosts' /etc/nsswitch.conf
```

常见配置是：

```text
hosts: files mdns4_minimal [NOTFOUND=return] dns
```

`files` 就代表 `/etc/hosts`。如果有人把它改成 `hosts: dns files`，或者删掉了 `files`，你改 hosts 当然没用。还有 `resolve`、`myhostname`、`mymachines` 等模块，顺序不同，结果也不同。

改完后可以用 `getent hosts` 验证，但要注意：**`getent` 只能代表 glibc 的解析结果**。Go 的纯 Go 解析器、Java、musl libc 都可能有自己的实现和缓存。

## 三、缓存：文件改了，内存里还是旧答案

这是“curl 通了、服务没通”的最常见原因。

| 缓存层 | 检查/清理方式 |
| --- | --- |
| nscd | `systemctl status nscd`；`nscd -i hosts` |
| systemd-resolved | `resolvectl query api.internal`；`resolvectl flush-caches` |
| dnsmasq | `systemctl restart dnsmasq` |
| Java | 默认缓存约 30 秒；`-Dsun.net.inetaddr.ttl=0` 可关闭 |
| 浏览器 | `chrome://net-internals/#dns` 清理 |

Java 服务尤其容易中招：进程启动时解析一次，之后一直用缓存。`/etc/hosts` 改了、`curl` 通了，但 JVM 里的 `InetAddress` 还是旧值。要么重启进程，要么把 TTL 调小：

```bash
java -Dsun.net.inetaddr.ttl=30 -jar app.jar
```

如果 TTL 被设成 `-1`，那就是永久缓存，只能重启。

## 四、你改的文件，进程未必看得到

容器、mount namespace、systemd 的沙箱选项，都会让进程看到另一份 `/etc/hosts`。

先找到进程，再对比它眼里的文件：

```bash
pid=$(pgrep -f 'java.*my-service' | head -1)

sudo md5sum /etc/hosts /proc/$pid/root/etc/hosts
sudo nsenter -t $pid -m -- cat /etc/hosts
```

如果两个 md5 不一样，说明进程在另一个 mount namespace 里。Docker 的 `/etc/hosts` 由运行时管理，直接进容器改，重启后会被覆盖；正确做法是启动时加参数：

```bash
docker run --add-host api.internal:10.0.0.9 ...
```

Kubernetes 则在 Pod spec 里写 `hostAliases`。另外，`docker inspect -f '{{.HostsPath}}' <container>` 可以直接看到容器实际挂载的 hosts 文件路径。

## 五、文件本身的几个细节

先看格式。`/etc/hosts` 是“IP 在前，主机名在后”：

```text
10.0.0.9    api.internal
```

常见问题：

- 主机名拼错，或者写成了 `api.internal.`（末尾的点在 DNS 里表示绝对域名，在 hosts 里不会自动去掉）。
- 同一个主机名有多条记录。不同 API 返回的顺序可能不一样，`getent ahosts` 看全貌，别只看第一条。
- 同时有 IPv4 和 IPv6 记录，应用按 RFC 6724 选路，可能先走 IPv6。用 `curl -4` / `curl -6` 分别验证。
- 文件里有 Windows 留下的 CRLF。用 `cat -A /etc/hosts` 看一眼，行尾出现 `^M$` 就值得怀疑。

还有两个容易忽略的变量：**代理**和**应用配置**。如果 `http_proxy` 指向代理，`curl` 根本不解析目标域名，而是把域名交给代理；Java 也可能通过 `-Dhttp.proxyHost` 走代理。先 `env | grep -i proxy` 排除掉。

## 六、一条可复现的排查路径

1. `getent ahosts api.internal`：确认 NSS 层结果。
2. `grep '^hosts' /etc/nsswitch.conf`：确认 `files` 在前面。
3. `resolvectl query api.internal`，必要时 `resolvectl flush-caches`。
4. `sudo nsenter -t $pid -m -- cat /etc/hosts`：确认进程看到的文件。
5. 用 `strace` 看它到底连了哪个 IP：

```bash
sudo strace -f -e trace=openat,connect -s 200 \
  curl -sS http://api.internal:8080/health
```

输出里会同时出现：

```text
openat(AT_FDCWD, "/etc/hosts", O_RDONLY|O_CLOEXEC) = 3
connect(5, {sa_family=AF_INET, sin_port=htons(8080),
        sin_addr=inet_addr("10.0.0.8")}, 16) = 0
```

文件读的是新的，连的却是旧 IP，基本就是缓存；如果连 `openat("/etc/hosts")` 都没有，说明这个程序用的是别的解析器或代理。

6. `ss -tnp state established '( dport = :8080 )'`：看真实连接落在哪台机器。

## 小结

`/etc/hosts` 不是“改完就生效”的开关，它只是解析链的起点之一。排查时按这个顺序走：**`getent` 看 NSS → `nsswitch.conf` 看顺序 → `resolvectl`/`nscd` 看缓存 → `/proc/PID/root` 看 namespace → `strace` 看真实连接**。大多数“改了没生效”，最后都落在缓存和 namespace 这两层。
