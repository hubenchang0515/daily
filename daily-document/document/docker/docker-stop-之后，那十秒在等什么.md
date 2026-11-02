> 原文链接：[docker stop 之后，那十秒在等什么 - 码日新 · 每日文章](https://daily.xplanc.org/docker/docker-stop-%E4%B9%8B%E5%90%8E%EF%BC%8C%E9%82%A3%E5%8D%81%E7%A7%92%E5%9C%A8%E7%AD%89%E4%BB%80%E4%B9%88.md)

---

# docker stop 之后，那十秒在等什么

改完配置，执行 `docker stop api`，终端停在那里不动。十秒后命令返回，容器没了，日志里却连一句 “shutting down” 都没有。再一看退出码：

```bash
docker inspect -f '{{.State.ExitCode}}' api
# 137
```

137 是 128 + 9，意思是进程被 `SIGKILL` 强杀。问题是，`docker stop` 明明先发的是 `SIGTERM`，为什么对方像没听见？

## 十秒是默认值，不是卡住了

`docker stop` 的流程只有两步：

1. 向容器内的 1 号进程发送 `SIGTERM`；
2. 等待 10 秒，还没退出就发送 `SIGKILL`。

这 10 秒可以用 `-t` 改：

```bash
docker stop -t 30 api
```

Compose 里对应 `stop_grace_period`：

```yaml
services:
  api:
    stop_grace_period: 30s
```

所以“停十秒”本身不是故障，它说明应用没有在收到 `SIGTERM` 后退出。真正的疑问是：信号到底去哪了？

## 1 号进程有特权

在 Linux 里，PID 1 是特殊进程。内核不会对它执行信号的“默认动作”，否则一不小心就会把 init 杀掉。换句话说，如果一个进程没有为 `SIGTERM` 注册处理函数，而它恰好是 1 号进程，那么这个信号会被直接忽略。

注意，是“忽略默认动作”，不是“信号没送到”。只要进程自己写了 handler，`SIGTERM` 照样能收到。`SIGKILL` 和 `SIGSTOP` 除外，它们无法被捕获，也无法被忽略。

容器里的 1 号进程，就是 PID namespace 里的 init。于是同一份程序，在开发机上收到 `SIGTERM` 会正常退出，进了容器却纹丝不动。

可以做个最小复现：

```bash
docker run -d --name slow alpine sh -c 'sleep 300; echo done'
time docker stop slow
docker inspect -f '{{.State.ExitCode}}' slow
```

`time` 会显示大约 10 秒，退出码是 137。这里 `sh` 是 1 号进程，`sleep` 是它的子进程；`sh` 没有为 `SIGTERM` 写处理逻辑，默认动作又被内核跳过，于是只能等 `SIGKILL`。

## 最常见的元凶：shell form

很多人是在 Dockerfile 里无意中制造了这个局面：

```dockerfile
# 反例：shell form
CMD python app.py
```

这种写法会被展开成 `/bin/sh -c "python app.py"`。1 号进程是 `sh`，Python 只是它的子进程。`sh` 既不一定转发信号，自己又忽略 `SIGTERM`，结果就是十秒后全家一起被 kill。

改成 exec form：

```dockerfile
# 正解：exec form
CMD ["python", "app.py"]
```

此时 Python 直接成为 1 号进程，`SIGTERM` 能送到应用手里。用 `docker inspect` 可以确认：

```bash
docker inspect -f '{{.Config.Entrypoint}} {{.Config.Cmd}}' api
```

入口脚本也有同样的问题：

```sh
#!/bin/sh
set -e

python manage.py migrate
python app.py
```

脚本是 1 号进程，`python app.py` 是子进程。脚本退出前不会替你把信号传下去。最后一行必须用 `exec`：

```sh
#!/bin/sh
set -e

python manage.py migrate
exec python app.py
```

`exec` 不会创建新进程，而是用目标程序替换当前 shell，PID 保持不变。信号自然就送到了。

## 让 1 号进程有人管

如果入口确实需要 shell 做预处理，又不想自己处理信号转发，可以交给一个专门的 init：

```bash
docker run --init ...
```

Compose：

```yaml
services:
  api:
    init: true
```

或者在镜像里装 `tini`：

```dockerfile
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["python", "app.py"]
```

`tini` 作为 1 号进程，主要做三件事：转发信号、回收僵尸进程、把子进程的退出码带出来。此时原来的 shell 不再是 PID 1，默认信号动作恢复，`SIGTERM` 会正常终止它。

但 `--init` 不是万能药。它只保证信号能转发，不能替应用做业务上的收尾。如果应用收到 `SIGTERM` 后仍然埋头跑一个很长的任务，十秒一到，还是 137。

## 应用自己也得配合

以 Go 的 HTTP 服务为例，收到 `SIGTERM` 后应该先停止接收新请求，再等待在途请求结束：

```go
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	srv := &http.Server{Addr: ":8080"}

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGTERM, syscall.SIGINT)
	<-ch

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}
```

这里的 8 秒要小于 `docker stop` 的 10 秒，给进程留出退出的余量。Node.js 同理，监听 `process.on('SIGTERM', ...)`，关闭 server 后再 `process.exit(0)`。

还有一个容易忽略的点：不同程序对信号的理解不一样。Nginx 把 `SIGQUIT` 当作优雅退出，所以官方镜像里声明了：

```dockerfile
STOPSIGNAL SIGQUIT
```

如果你的应用也有类似约定，记得在 Dockerfile 里写清楚，否则 `docker stop` 发出去的 `SIGTERM` 可能并不是它期待的那个信号。

## 退出码速查

| 退出码 | 计算方式 | 常见原因 |
| --- | --- | --- |
| 0 | — | 正常退出 |
| 1 | — | 应用报错、配置错误 |
| 130 | 128 + 2 | 收到 `SIGINT`，比如 Ctrl-C |
| 137 | 128 + 9 | `docker stop` 超时、OOM Killer |
| 139 | 128 + 11 | 段错误 |
| 143 | 128 + 15 | 正常响应 `SIGTERM` |

看到 137 时，先别急着怀疑内存。用下面这条命令区分：

```bash
docker inspect -f '{{.State.OOMKilled}}' api
```

输出 `true` 才是被 OOM Killer 杀的；`false` 基本就是 `docker stop` 等满十秒后补的 `SIGKILL`。

## 一条排查路径

1. 用 `docker inspect` 看 `Entrypoint` 和 `Cmd`，确认是不是 shell form。
2. 用 `docker top <容器>` 看 1 号进程到底是谁。
3. 用 `docker stop -t 30` 再试一次，看是“永不退出”还是“只是慢”。
4. 在应用里打印收到的信号，确认 handler 是否真的执行。
5. 检查 `OOMKilled`，排除内存问题。
6. 检查 `STOPSIGNAL` 是否与应用约定一致。
7. 在 Kubernetes 里还要看 `terminationGracePeriodSeconds` 和 `preStop`，它们的超时逻辑和 `docker stop` 是一回事。

容器并没有改变信号机制，它只是把“谁是 1 号进程”这件事摆到了你面前。把 `SIGTERM` 当成一个需要认真实现的接口，那十秒的等待自然就消失了。
