> 原文链接：[手动能跑，cron 不跑：定时任务的五个隐形坑 - 码日新 · 每日文章](https://daily.xplanc.org/linux/%E6%89%8B%E5%8A%A8%E8%83%BD%E8%B7%91%EF%BC%8Ccron-%E4%B8%8D%E8%B7%91%EF%BC%9A%E5%AE%9A%E6%97%B6%E4%BB%BB%E5%8A%A1%E7%9A%84%E4%BA%94%E4%B8%AA%E9%9A%90%E5%BD%A2%E5%9D%91.md)

---

# 手动能跑，cron 不跑：定时任务的五个隐形坑

有个脚本，你在终端里敲 `./backup.sh`，一切正常。放进 crontab，第二天早上一看，备份目录是空的。

`crontab -l` 里那行命令没写错，路径也对，可它就是不动。这种问题之所以难查，是因为 cron 执行命令时的环境和你的交互式 shell 差得很远：PATH 更短、不读你的配置、工作目录不是你以为的那个、输出没人接。下面按排查顺序拆开讲。

## 第一步：先确认 cron 到底执行了没有

别急着改脚本。先分清是“没跑”还是“跑了但失败”。

```bash
systemctl status cron          # RHEL 系是 crond
journalctl -u cron --since "10 min ago"
grep CRON /var/log/syslog | tail -5   # RHEL 看 /var/log/cron
```

日志里出现 `(razer) CMD (/home/razer/bin/backup.sh)`，说明 cron 确实调用了，问题在脚本内部；连这行都没有，就要往前查：

- 任务是不是写在了别的用户下面？`crontab -l` 只列当前用户，`sudo crontab -l -u www-data` 才看得到别人的。
- 放在 `/etc/cron.d/` 里的文件，要求属主是 root、不能组可写，文件名只能包含字母、数字、下划线和连字符，带 `.sh` 后缀会被直接忽略。
- cron 服务本身是否在跑。容器里尤其常见——很多精简镜像根本不带 cron。

顺带纠正一个流传很广的说法：改完 `crontab -e` 不需要重启 cron，保存的那一刻它就会重新读取。

## 坑一：PATH 只有两个目录

Debian/Ubuntu 的 crontab(5) 明确写了，cron 给任务设置的 `PATH` 是 `/usr/bin:/bin`。也就是说：

- `~/.local/bin` 里的 `uv`、`poetry` 找不到；
- `/usr/local/bin` 里的自定义工具找不到；
- nvm、pyenv、conda 装的解释器全都找不到。

脚本里写了 `python3 xxx.py`，结果跑的是系统那个 3.8，而不是你 `pyenv global` 的 3.12；写了 `node`，直接 command not found。

两种改法，选一种：

```bash
# 方案 A：在 crontab 顶部声明，作用于该文件里所有任务
PATH=/home/razer/.local/bin:/usr/local/bin:/usr/bin:/bin
MAILTO=""

0 3 * * * /home/razer/bin/backup.sh
```

```bash
# 方案 B：脚本里全部用绝对路径，最不容易被环境影响
/usr/bin/python3 /srv/app/job.py
```

在交互式终端里用 `command -v node` 查到的路径，就是 cron 里该写的那一个。

## 坑二：你的 shell 配置根本没被读

cron 默认用 `SHELL=/bin/sh`（Debian 上指向 dash），而且是非交互、非登录地启动。这意味着：

- `~/.bashrc` 不读——它开头通常就有这段保护：

```bash
case $- in
  *i*) ;;
    *) return;;
esac
```

非交互式直接 `return`，后面 export 的变量一个都没生效。
- `~/.profile`、`~/.bash_profile` 也不读，那是登录 shell 才加载的。

所以 `nvm use 20`、`conda activate`、`export API_KEY=...` 这类写在 rc 文件里的东西，在 cron 里统统不存在。

如果确实需要复用一套环境变量，可以单独建一个只放 `export` 的文件，让 bash 在非交互启动时读取：

```bash
# crontab 顶部
SHELL=/bin/bash
BASH_ENV=/home/razer/.cronenv
```

`~/.cronenv` 里只写 `export FOO=bar`，不要 `echo` 任何东西——它的输出会被拼进命令执行结果里。注意 `BASH_ENV` 只对 bash 生效，换成 dash 就不管用了。

## 坑三：工作目录是 HOME，不是脚本目录

脚本里写了 `./config.yml`、`logs/app.log`、`../data/`，手动跑时因为你在项目目录，一切正常；cron 里工作目录是 `$HOME`，相对路径全部指向别处，于是“文件不存在”或者日志写到了家目录。

在脚本开头加一行，一劳永逸：

```bash
cd "$(dirname "$(readlink -f "$0")")" || exit 1
```

`readlink -f` 是为了处理脚本被软链到 `/usr/local/bin` 的情况，否则 `dirname` 拿到的是软链所在目录。

## 坑四：`%` 在 crontab 里不是百分号

这是最容易被忽略的一条。在 crontab 的命令字段里，未转义的 `%` 表示换行，而且第一个 `%` 之后的内容会变成命令的标准输入。于是这行：

```bash
0 3 * * * /usr/bin/tar czf /backup/$(date +%F).tar.gz /srv
```

实际执行的命令在 `date +` 处就被截断了，剩下的 `F)...` 被当成 stdin。结果要么报错，要么生成一个名字奇怪的包。

正确写法是转义：

```bash
0 3 * * * /usr/bin/tar czf /backup/backup-$(date +\%F).tar.gz /srv
```

更好的做法是别在 crontab 里写复杂命令，把逻辑塞进脚本，crontab 里只留一行 `0 3 * * * /home/razer/bin/backup.sh`。这样既能避开 `%`，也方便本地调试。

## 坑五：输出没人接，缓冲区还会骗你

cron 里没有终端。命令的输出会被交给本机 MTA 发邮件；如果没装邮件服务，就直接丢弃。所以脚本里一句 `echo "start"` 既不会出现在任何地方，也不会告诉你出了什么错。

两个动作：

```bash
# 1. 显式重定向，别依赖邮件
0 3 * * * /home/razer/bin/backup.sh >> /var/log/backup.log 2>&1

# 2. 不想收邮件就明确关掉
MAILTO=""
```

还有一层更隐蔽的问题：当 stdout 是文件而不是终端时，C 库的 stdio 从行缓冲切换成块缓冲（通常 4KB 或 8KB）。脚本跑了一半崩掉，缓冲区里那几行日志跟着一起没了，于是你看到的现象是“日志停在半句话上”。排查这类问题时：

```bash
stdbuf -oL -eL /home/razer/bin/backup.sh >> /var/log/backup.log 2>&1
```

Python 用 `python3 -u` 或设 `PYTHONUNBUFFERED=1`。另外记得在脚本里写 `set -euo pipefail`，否则中间某条命令失败，脚本照样以 0 退出，你连失败都发现不了。

## 一张对照表

| 现象 | 首先怀疑 | 验证方式 |
| --- | --- | --- |
| 完全没执行 | crontab 归属、`/etc/cron.d` 权限、服务未启动 | `grep CRON /var/log/syslog` |
| command not found | PATH 缺目录 | 临时任务跑 `/usr/bin/env`，把结果写到文件 |
| 解释器版本不对 | shell 配置未加载 | 脚本里打 `which python3`、`python3 -V` |
| 文件找不到 | 工作目录是 `$HOME` | 脚本里打 `pwd` |
| 参数被截断 | `%` 未转义 | 把命令包进脚本再跑 |
| 报错看不到 | 无 MTA、输出未重定向 | 加 `>> log 2>&1` |
| 日志缺最后几行 | 块缓冲 | 用 `stdbuf -oL` 或 `-u` |

最省事的定位办法，是在 crontab 里临时加一条探测任务，等一分钟：

```bash
* * * * * /usr/bin/env > /tmp/cron-env.txt 2>&1
```

然后 `cat /tmp/cron-env.txt`，和你在终端里 `env | sort` 的结果对比，差异一目了然。查完记得删掉。

## 比 cron 更省心的选择

如果任务开始变多，或者需要“错过就补跑”“失败要告警”，systemd timer 值得换过去。环境是显式声明的，日志自动进 journal，不需要再和缓冲、PATH、MTA 斗智斗勇。

```ini
# /etc/systemd/system/backup.service
[Unit]
Description=Nightly backup

[Service]
Type=oneshot
User=razer
WorkingDirectory=/srv/app
Environment=PATH=/home/razer/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/srv/app/scripts/backup.sh
```

```ini
# /etc/systemd/system/backup.timer
[Unit]
Description=Run backup every night

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
```

```bash
systemctl daemon-reload
systemctl enable --now backup.timer
systemctl list-timers --all
journalctl -u backup.service -n 50
```

`Persistent=true` 会在关机期间错过的任务下次开机后补跑，`RandomizedDelaySec` 则能避免一堆机器在同一秒涌向同一台服务器。

回到开头那个空备份目录：先看日志确认 cron 有没有调用，再看 PATH 和 shell 配置，最后把工作目录和输出固定下来。这四步走完，绝大多数“手动能跑、cron 不跑”的问题都会现出原形。
