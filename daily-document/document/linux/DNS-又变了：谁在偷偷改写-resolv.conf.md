> 原文链接：[DNS 又变了：谁在偷偷改写 resolv.conf - 码日新 · 每日文章](https://daily.xplanc.org/linux/DNS-又变了：谁在偷偷改写-resolv.conf.md)

---

# DNS 又变了：谁在偷偷改写 resolv.conf

改完 `/etc/resolv.conf`，`curl` 立刻正常；重启网络、换 Wi‑Fi，或者机器重启后，文件内容又变回去了。很多人第一反应是编辑器没保存，其实是另一个服务按自己的配置重新生成了这个文件。

`/etc/resolv.conf` 更像“当前 DNS 状态”的展示窗口，而不是推荐的配置入口。真正要改的，是那个生成它的服务。

## 先看它是不是一个链接

```bash
ls -l /etc/resolv.conf
readlink -f /etc/resolv.conf
cat /etc/resolv.conf
stat /etc/resolv.conf
```

常见输出类似：

```text
lrwxrwxrwx 1 root root 32 /etc/resolv.conf -> ../run/systemd/resolve/stub-resolv.conf
nameserver 127.0.0.53
options edns0 trust-ad
search example.internal
```

这说明你改的只是链接目标。`127.0.0.53` 并不是某个外部 DNS 服务器，而是本机的 `systemd-resolved` 在监听：

```bash
systemctl is-active systemd-resolved
ss -lunp | grep ':53'
resolvectl status
```

如果 `resolvectl status` 里能看到当前网卡的 `Current DNS Server`，那才是真正转发查询的上游地址。

## 谁在管理 resolv.conf

| 线索 | 常见管理者 | 确认方式 |
| --- | --- | --- |
| 链接到 `/run/systemd/resolve/stub-resolv.conf` | systemd-resolved | `resolvectl status` |
| 链接到 `/run/NetworkManager/resolv.conf` | NetworkManager | `nmcli con show --active` |
| 云服务器刚启动就被改写 | cloud-init、DHCP | `journalctl -u cloud-init`、`journalctl -u NetworkManager` |
| Ubuntu Server 重启后恢复 | Netplan + systemd-networkd | `netplan get`、`networkctl status` |
| 容器里怎么改都没用 | Docker / Kubernetes DNS | 查宿主机或集群 DNS 配置 |

最忌讳的是直接给文件加不可变属性：

```bash
sudo chattr +i /etc/resolv.conf
```

这会让 DHCP、NetworkManager、systemd-resolved 全部写不进去，问题从“DNS 不对”升级成“网络怎么配都不生效”。如果你已经这么做，先撤销：

```bash
lsattr /etc/resolv.conf
sudo chattr -i /etc/resolv.conf
```

## systemd-resolved：改上游，不要改 stub 文件

临时验证可以直接改运行时配置：

```bash
sudo resolvectl dns eth0 10.20.0.10 1.1.1.1
sudo resolvectl domain eth0 example.internal
resolvectl status
```

确认有效后再做持久化配置。建议放 drop-in，而不是直接改 `/etc/systemd/resolved.conf`：

```bash
sudo mkdir -p /etc/systemd/resolved.conf.d
sudo tee /etc/systemd/resolved.conf.d/00-dns.conf >/dev/null <<'EOF'
[Resolve]
DNS=10.20.0.10 1.1.1.1
Domains=example.internal
FallbackDNS=
EOF

sudo ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf
sudo systemctl restart systemd-resolved
resolvectl status
```

这里几个细节容易踩坑：

- `DNS=` 写的是上游 DNS，不是 `127.0.0.53`。
- `FallbackDNS=` 留空可以阻止系统自动追加公共 DNS；某些隐私或内网环境下很有必要。
- `Domains=example.internal` 同时影响搜索域和查询路由；只想按后缀转发、不想拼进短主机名，可以写 `Domains=~example.internal`。
- 直接编辑 `/run/systemd/resolve/stub-resolv.conf` 没有意义，重启服务后必被覆盖。

## NetworkManager：改连接，不要改文件

桌面发行版里，最常见的情况是 NetworkManager 根据当前连接重新生成 DNS 配置。

```bash
nmcli con show --active
CON=$(nmcli -g GENERAL.CONNECTION device show eth0)

sudo nmcli con mod "$CON" \
  ipv4.dns "10.20.0.10 1.1.1.1" \
  ipv4.dns-search "example.internal" \
  ipv4.ignore-auto-dns yes

sudo nmcli con up "$CON"
resolvectl status
```

`ipv4.ignore-auto-dns yes` 很关键。否则 DHCP 下发的 DNS 仍可能被追加进来，你以为只有两个上游，实际多了一个路由器地址。

如果系统使用 Netplan，应该改 YAML 配置，而不是改生成后的文件：

```yaml
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: true
      dhcp4-overrides:
        use-dns: false
      nameservers:
        addresses: [10.20.0.10, 1.1.1.1]
        search: [example.internal]
```

保存后先试运行，失败会自动回滚：

```bash
sudo netplan try
```

## 验证时要分清“文件”和“解析结果”

只 `cat /etc/resolv.conf` 不够，因为 stub 模式下一行 `nameserver 127.0.0.53` 说明不了上游是谁。

```bash
# 当前生效的上游和搜索域
resolvectl status | grep -E 'Current DNS|DNS Servers|DNS Domain'

# 走系统解析栈，受 nsswitch.conf 影响
getent ahosts www.example.com

# 直接问本机 stub
dig +short @127.0.0.53 www.example.com

# 按 /etc/resolv.conf 默认配置查询
dig +short www.example.com
```

如果 `dig @127.0.0.53` 正常、程序却解析失败，继续查 `/etc/nsswitch.conf` 的 `hosts:` 行，或者看浏览器、Java、容器运行时是否自带 DNS 缓存。反之，如果 stub 就返回错误，问题一定在 `resolvectl status` 显示的上游或搜索域上。

容器里尤其要注意：Docker 可能把 `127.0.0.11` 作为嵌入式 DNS 写进 `/etc/resolv.conf`，Kubernetes 则由 kubelet 生成。镜像里 `RUN echo nameserver ... > /etc/resolv.conf` 通常会在启动时被覆盖，应该改 Docker 的 `--dns`，或配置集群的 CoreDNS 与 `dnsConfig`。

排查这类问题只要记住一句话：**先找到写文件的那个服务，再去改它的配置**。`resolv.conf` 变了不是故障本身，它只是告诉你：上面的某一层网络配置发生了变更。

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
