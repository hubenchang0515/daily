> 原文链接：[本周记录：把 SSH 登录收紧了一圈 - 码日新 · 每日文章](https://daily.xplanc.org/每周报告/本周记录：把-SSH-登录收紧了一圈.md)

---

# 本周记录：把 SSH 登录收紧了一圈

本周做了一次例行维护，把一台跑了很久的测试服务器翻出来检查。服务本身没出问题，但 SSH 配置还停留在“能连就行”的状态：密码登录开着、root 可以直接登录、认证尝试次数也没有限制。这类问题平时不显眼，一旦端口暴露在公网，就会变成持续的扫描噪音，甚至留下可利用的入口。

这次没有大改架构，只按排查顺序把 SSH 登录策略收紧了一圈。下面的命令以 Debian/Ubuntu 为例，RHEL 系列系统大多只是服务名和包管理器不同。

## 先留后路，再动配置

修改 SSH 最怕把自己锁在门外。动手前先做两件事：备份配置，并保留一个已经登录的终端窗口。

```bash
# 备份主配置
sudo cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak.$(date +%F)

# 查看当前生效配置（sshd -T 会合并 include 的配置片段）
sudo sshd -T | grep -E '^(port|permitrootlogin|passwordauthentication|kbdinteractiveauthentication|maxauthtries|logingracetime|x11forwarding|allowusers|allowgroups) '
```

`sshd -T` 输出的是最终生效值，比直接翻配置文件更可靠。后面每改一步，都可以用它确认结果。

## 确认密钥登录真的可用

如果准备关闭密码登录，必须先确认密钥登录能正常工作。验证时不要复用当前终端，新开一个窗口测试。

```bash
# 在本地生成 ed25519 密钥（如果还没有）
ssh-keygen -t ed25519 -C "laptop-2026" -f ~/.ssh/id_ed25519

# 把公钥复制到服务器
ssh-copy-id -i ~/.ssh/id_ed25519.pub deploy@203.0.113.10

# 新开终端，明确指定私钥测试登录
ssh -i ~/.ssh/id_ed25519 deploy@203.0.113.10
```

上面的 `203.0.113.10` 和 `deploy` 是示例地址和用户名，替换成你自己的服务器信息即可。新会话能稳定登录之前，不要关闭原来的会话。

## 用 drop-in 文件收紧配置

我更倾向把加固项放在 `/etc/ssh/sshd_config.d/` 里，而不是直接堆进主配置文件。这样升级 OpenSSH 时冲突更少，回滚也更清楚。

```bash
sudo tee /etc/ssh/sshd_config.d/10-hardening.conf >/dev/null <<'EOF'
# 禁用密码登录，只允许密钥
PasswordAuthentication no
KbdInteractiveAuthentication no

# 禁止 root 直接 SSH 登录
PermitRootLogin no

# 限制认证尝试和登录窗口
MaxAuthTries 3
LoginGraceTime 30

# 不需要图形转发就关掉
X11Forwarding no

# 只允许指定用户登录（按实际情况修改）
AllowUsers deploy
EOF
```

几个关键选项的含义如下：

| 配置项 | 建议值 | 说明 |
| --- | --- | --- |
| `PasswordAuthentication` | `no` | 关闭密码认证，减少暴力破解面 |
| `KbdInteractiveAuthentication` | `no` | 关闭键盘交互认证；旧版本可能仍使用 `ChallengeResponseAuthentication` |
| `PermitRootLogin` | `no` | 禁止 root 直接登录，日常操作用普通用户配合 `sudo` |
| `MaxAuthTries` | `3` | 单次连接最多尝试 3 次认证 |
| `LoginGraceTime` | `30` | 30 秒内未完成认证就断开连接 |
| `X11Forwarding` | `no` | 不需要 X11 转发时关闭，减少暴露面 |
| `AllowUsers` | 指定账号 | 只允许明确列出的用户登录，也可以改用 `AllowGroups` |

`AllowUsers` 和 `AllowGroups` 要特别小心：写错用户名或组名，可能把自己挡在外面。修改前先确认当前登录账号、sudo 权限和实际运维账号是否一致。

## 先验证，再重载

这是整个过程里最关键的一步。`sshd -t` 只检查配置语法和合法性，不会真正切换服务。

```bash
# 检查配置语法
sudo sshd -t

# 确认服务名（Debian/Ubuntu 常见是 ssh，RHEL 常见是 sshd）
systemctl list-unit-files | grep -E '^ssh(d)?\.service'

# 语法检查通过后再重载服务
sudo systemctl reload ssh
```

如果 `sshd -t` 报错，不要重载。先根据报错信息修正配置，再重新检查。重载完成后，保持原会话不动，另开终端确认新策略下可以正常登录：

```bash
# 新终端验证登录
ssh deploy@203.0.113.10

# 在服务器上确认关键配置已生效
sudo sshd -T | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin|maxauthtries|logingracetime) '
```

看到输出中的值和预期一致，才算这次修改真正完成。

## 加一道自动防护

配置收紧能减少攻击面，但公网 SSH 端口仍然会收到大量扫描。fail2ban 可以根据认证失败记录自动封禁来源 IP，适合作为补充手段。

```bash
sudo apt update
sudo apt install -y fail2ban

sudo tee /etc/fail2ban/jail.d/sshd.local >/dev/null <<'EOF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
EOF

sudo systemctl enable --now fail2ban

# 查看 sshd jail 状态
sudo fail2ban-client status sshd
```

`maxretry`、`findtime` 和 `bantime` 可以按实际暴露情况调整。如果有固定办公 IP 或堡垒机，可以在 fail2ban 配置里补充 `ignoreip`，避免误封。需要排查登录异常时，也可以看最近的认证日志：

```bash
# 查看最近的 SSH 日志
sudo journalctl -u ssh -u sshd --since "1 hour ago" --no-pager | tail -n 30
```

## 本周收尾清单

这次整理下来，我把 SSH 加固的动作固定成了一份短清单，下次换机器时可以直接照着走：

- [ ] 备份 `sshd_config`，保留一个已登录会话
- [ ] 新开终端确认密钥登录可用
- [ ] 用 `sshd_config.d/*.conf` 写入加固项
- [ ] 执行 `sshd -t` 检查语法
- [ ] `reload` 后再次验证登录和生效配置
- [ ] 安装 fail2ban，确认 jail 状态正常

安全配置最容易出问题的地方，不是“不知道该设什么”，而是“改完才发现自己进不去了”。把验证步骤固定下来，例行维护才不会变成一次紧急救援。

## 相关文章

- [本周实验：备份只有恢复过才算数](https://daily.xplanc.org/每周报告/本周实验：备份只有恢复过才算数.md)
- [本周迁移实录：把 pip 换成 uv](https://daily.xplanc.org/每周报告/本周迁移实录：把-pip-换成-uv.md)
- [本周清单：让终端活得久一点](https://daily.xplanc.org/每周报告/本周清单：让终端活得久一点.md)
- [本周折腾：监控装好了，告警却没响](https://daily.xplanc.org/每周报告/本周折腾：监控装好了，告警却没响.md)

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
