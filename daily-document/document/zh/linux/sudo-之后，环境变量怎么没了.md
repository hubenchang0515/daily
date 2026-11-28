> 原文链接：[sudo 之后，环境变量怎么没了 - 码日新 · 每日文章](https://daily.xplanc.org/zh/linux/sudo-之后，环境变量怎么没了.md)

---

# sudo 之后，环境变量怎么没了

同一条命令，在自己的 shell 里跑得好好的，加上 sudo 就报"找不到配置文件"。这类问题十有八九不是权限没给够，而是 sudo 在提权时把环境换掉了一层：自定义变量被清空、PATH 被替换成系统路径、HOME 指向了 root。搞清楚这一步到底发生了什么，比反复加 chmod 有用得多。

## 复现：变量明明 export 了

```bash
export APP_CONF=/etc/myapp/prod.conf
./start.sh          # 正常
sudo ./start.sh     # 读不到 $APP_CONF
```

脚本里写的是 `conf=${APP_CONF:-/etc/myapp/default.conf}`。普通用户下拿到的是 `prod.conf`，sudo 下却悄悄回退到了默认值——不报错、不崩溃，只是配置不对，排查起来尤其难受。

代理变量也一样：

```bash
export HTTPS_PROXY=http://127.0.0.1:7890
sudo git clone https://github.com/xxx/yyy.git   # 一直连不上
```

Git 本身没问题，是 `HTTPS_PROXY` 没跟过去。先用 diff 看一眼差距：

```bash
env | sort > /tmp/as-me
sudo env | sort > /tmp/as-root
diff -u /tmp/as-me /tmp/as-root | head -60
```

输出通常是一大片删除行，不只是少了一两个变量。

## env_reset：默认就被清洗了

sudo 的默认策略启用了 `env_reset`。开启后，只有一小撮变量（TERM、PATH 等白名单项）会被带进目标环境，其余全部丢弃。这是安全设计而非缺陷：如果允许把 `LD_PRELOAD`、`PYTHONPATH`、`BASH_ENV`、`IFS` 原样带进 root 进程，任何能调用 sudo 的人都能让 root 加载自己的动态库。

```bash
sudo -V | grep -i -E 'env_reset|secure_path|preserve'
```

你会看到类似这样的输出：

```
Environment variables to preserve:
    TERM, PATH, ...
Value to override user's $PATH with: /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
```

`secure_path` 解释了第二个常见困惑：装在 `~/.local/bin`、conda 或 nvm 里的工具，sudo 下突然"命令不存在"，`sudo which python` 查到的也是另一条路径。PATH 不是被你改丢了，是被 sudo 覆盖了。

HOME 同样会变成目标用户的家目录。这里还有个容易绕晕的细节：

```bash
sudo echo ~          # /home/you —— 波浪号是当前 shell 展开的
sudo bash -c 'echo ~'  # /root —— 这次由 sudo 启动的 shell 展开
```

单引号让展开发生在目标 shell 里，结果就不同了。

## 把变量带过去的几种办法

| 做法 | 适用场景 | 注意点 |
| --- | --- | --- |
| `sudo VAR=value cmd` | 临时传一两个值 | sudo 直接写入目标环境，最省事 |
| `sudo env VAR=value cmd` | 要传多个值 | 由 `env` 设置，不依赖 sudo 策略 |
| `sudo -E cmd` | 想保留整套环境 | 可能被策略拒绝，需 `SETENV` 或 `env_keep` |
| `env_keep += "VAR"` | 团队里长期需要 | 用 `visudo` 编辑 `/etc/sudoers.d/` 下的文件 |
| 配置文件 + 绝对路径 | 服务脚本、定时任务 | 最稳，不依赖调用者的环境 |

前两种可以这样写：

```bash
sudo APP_CONF=/etc/myapp/prod.conf ./start.sh
sudo env APP_CONF=/etc/myapp/prod.conf LOG_LEVEL=debug ./start.sh
```

需要长期保留某个变量时，别直接改 `/etc/sudoers`，用单独文件更容易维护：

```bash
sudo visudo -f /etc/sudoers.d/myapp
# 写入一行：
Defaults env_keep += "APP_CONF"
```

保存后先用 `sudo visudo -c` 检查语法，确认没问题再退出终端——这条习惯能救你一次锁死 sudo 的机会。

`sudo -E` 看着最诱人，但它要求策略允许；遇到 `sudo: sorry, you are not allowed to preserve the environment` 就是策略拦下来了。即便能用，把整个开发环境（包括调试用的 `PYTHONPATH`）灌进 root 进程也不是好主意。

## 重定向发生在 sudo 之前

还有一个经典坑，看起来像权限问题，其实是执行顺序问题：

```bash
sudo echo "nameserver 1.1.1.1" > /etc/resolv.conf
# bash: /etc/resolv.conf: Permission denied
```

重定向由**当前 shell** 在启动 sudo 之前就打开了文件，此时还是普通用户身份。正确写法是让提权后的进程负责写：

```bash
echo "nameserver 1.1.1.1" | sudo tee -a /etc/resolv.conf
sudo sh -c 'echo "nameserver 1.1.1.1" >> /etc/resolv.conf'
```

`tee -a` 追加，`tee` 不带参数则是覆盖。注意单引号：双引号会让 `$VAR` 在当前 shell 就展开，又回到原点。

## 排查清单

下次再遇到"sudo 下就不对"，按这个顺序过一遍：

1. `sudo env | sort` 和目标命令里的 `env` 对比，确认变量到底在不在；
2. `sudo -V | grep -i path` 看 `secure_path` 有没有挡住你的工具，用绝对路径绕开；
3. 用 `sudo -u <用户> env` 验证特定用户的环境，别假设 root 和你一致；
4. 涉及写文件时，检查是不是重定向先于 sudo 执行；
5. 脚本依赖环境时，把默认值、配置文件路径写进脚本本身，而不是靠调用者 export。

说到底，sudo 不是"用 root 的身份证继续跑你原来的 shell"，而是"在一个干净环境里启动一条新命令"。接受这个模型之后，那些忽隐忽现的变量就都有了解释。

## 相关文章

- [负载 12，CPU 却在摸鱼：读懂 Linux 的 load average](https://daily.xplanc.org/zh/linux/负载-12，CPU-却在摸鱼：读懂-Linux-的-load-average.md)
- [kill -9 也杀不掉的进程](https://daily.xplanc.org/zh/linux/kill--9-也杀不掉的进程.md)
- [程序崩了，core 文件却不见了](https://daily.xplanc.org/zh/linux/程序崩了，core-文件却不见了.md)

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
