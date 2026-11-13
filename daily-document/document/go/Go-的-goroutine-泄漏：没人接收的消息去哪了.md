> 原文链接：[Go 的 goroutine 泄漏：没人接收的消息去哪了 - 码日新 · 每日文章](https://daily.xplanc.org/go/Go-的-goroutine-泄漏：没人接收的消息去哪了.md)

---

# Go 的 goroutine 泄漏：没人接收的消息去哪了

一个 Go 服务上线三天，内存从 200MB 涨到 1.2GB，QPS 却没变。`pprof` 的堆内存看起来正常，直到打开 goroutine 面板：同一个调用栈，挂了四万多个 goroutine，全都停在 `chan send` 上。

goroutine 泄漏之所以难查，是因为它不像内存泄漏那样有明显的“对象”，也没有 panic。程序照常跑，只是每隔一段时间就多一些永远不会醒来的函数。

## 便宜，但不免费

新建一个 goroutine 的初始栈只有 2KB 左右，调度器还能按需扩容。这让 `go` 关键字用起来毫无心理负担，也让泄漏变得毫无心理负担。

但一个阻塞中的 goroutine 并不是“什么都不占”：

- 它的栈还在，栈上引用的对象 GC 收不掉；
- 它可能握着锁、数据库连接、文件描述符；
- 它挂在 channel 的等待队列上，runtime 需要维护这些结构；
- 它可能还在等一个永远不会到来的信号。

最关键的是：**goroutine 没有外部句柄，你无法从外面杀掉它**。它只能自己返回。所以每一个 `go` 关键字，都必须能回答一个问题：这个函数在什么条件下会退出？

## 四种最常见的泄漏

### 1. 往没人接收的 channel 发送

```go
func firstResult(urls []string) string {
	ch := make(chan string) // 无缓冲
	for _, u := range urls {
		go func(u string) {
			ch <- fetch(u) // 调用方一走，这里永远阻塞
		}(u)
	}
	return <-ch // 只等第一个，其余全部卡死
}
```

`firstResult` 拿到第一个结果就返回了。剩下的 goroutine 还在往 `ch` 里发，而没有接收方，它们会一直挂在 channel 的发送队列上。QPS 一百，每次泄漏几十个，一天就是几百万。

修法有两条：给 channel 足够缓冲，让发送方不必等待；同时用 `context` 兜底。

```go
func firstResult(ctx context.Context, urls []string) (string, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	ch := make(chan string, len(urls)) // 缓冲够大，发送不会阻塞
	for _, u := range urls {
		go func(u string) {
			v, err := fetch(ctx, u)
			if err != nil {
				return
			}
			select {
			case ch <- v:
			case <-ctx.Done():
			}
		}(u)
	}

	select {
	case v := <-ch:
		return v, nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}
```

注意 `defer cancel()`：函数返回时取消子 context，让还在跑的 `fetch` 尽快收工。忘了这一行，泄漏的就不只是 goroutine，还有 context 内部的定时器。

### 2. 等一个永远不会关闭的 channel

```go
func consume(ch <-chan int) {
	for v := range ch { // ch 不关闭，循环永不结束
		handle(v)
	}
}
```

`range` 一个 channel，只有它被 `close` 才会退出。如果发送方在某个错误分支上直接 `return`，忘了 `close`，接收方就会等到天荒地老。

约定很简单：**谁发送，谁关闭；接收方永远不要关 channel**。如果发送方有多个分支，用 `defer close(ch)`。

另一个变体是 nil channel：

```go
var ch chan int
go func() {
	ch <- 1 // 永久阻塞
}()
```

nil channel 上的收发永远阻塞，且不会被调度器唤醒。反过来，`select` 里 nil channel 的分支会被直接禁用，所以 `<-ctx.Done()` 在 `context.Background()` 下返回 nil 也是安全的——那个 case 只是永远不触发。

### 3. context 传了，但没人听

```go
func start(ctx context.Context) {
	go func() {
		for {
			doSomething() // 从不检查 ctx
			time.Sleep(time.Second)
		}
	}()
}
```

参数里写着 `ctx`，函数体里一次都没看。调用方 `cancel()` 之后，这个 goroutine 仍然每秒醒一次，直到进程结束。context 只是传菜员，不会自动把刀架在 goroutine 脖子上。

```go
func start(ctx context.Context) {
	go func() {
		t := time.NewTicker(time.Second)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				doSomething()
			case <-ctx.Done():
				return
			}
		}
	}()
}
```

顺带一提，`doSomething()` 本身如果会阻塞在 IO 上，也得把 ctx 传下去，比如 `http.NewRequestWithContext`，否则取消信号依然进不去。

### 4. 有界并发变成了无界堆积

```go
func (s *Server) handle(w http.ResponseWriter, r *http.Request) {
	go s.report(r) // 上报端一慢，goroutine 无限堆积
	// ...
}
```

每个请求起一个 goroutine，看起来只是“异步化”。但下游如果抖一下，消费速度跟不上生产速度，goroutine 就会像队列一样无限增长——而这个队列没有长度上限，也没有拒绝策略。

正确做法是把并发度固定下来，队列满了就丢：

```go
type Reporter struct {
	ch chan event
}

func NewReporter(n int) *Reporter {
	r := &Reporter{ch: make(chan event, 1024)}
	for i := 0; i < n; i++ {
		go func() {
			for e := range r.ch {
				send(e)
			}
		}()
	}
	return r
}

func (r *Reporter) Report(e event) {
	select {
	case r.ch <- e:
	default: // 队列满就丢，宁可少一条，也不要多一万个 goroutine
	}
}
```

监控上报、日志投递、审计事件都适合这个模型：**有界队列 + 固定 worker + 明确的丢弃策略**。

## 把泄漏抓出来

最省事的办法是挂上 `net/http/pprof`：

```go
import _ "net/http/pprof"

go func() {
	log.Println(http.ListenAndServe("localhost:6060", nil))
}()
```

goroutine profile 和 CPU、heap 不同，它是全量快照，不做采样：

```bash
# 按调用栈聚合，适合看“同一个栈有 3000 个”
curl -s 'http://localhost:6060/debug/pprof/goroutine?debug=1' | head -40

# 展开每个 goroutine 的完整栈
curl -s 'http://localhost:6060/debug/pprof/goroutine?debug=2' | less

# 图形化查看
go tool pprof -http=:8080 'http://localhost:6060/debug/pprof/goroutine'
```

判断方法很直接：连续抓两次，如果某个栈的数量只增不减，基本就是泄漏。重点关注栈顶停在 `chan send`、`chan receive`、`select`、`IO wait` 的那几类。

测试里可以用 `runtime.NumGoroutine()` 做粗检，或者直接上 `goleak`：

```go
func TestMain(m *testing.M) {
	goleak.VerifyTestMain(m)
}
```

它会在测试结束时检查是否有非预期的残留 goroutine，把泄漏挡在合并之前。

## 一份检查清单

| 现象 | 常见原因 | 处理 |
| --- | --- | --- |
| 栈顶是 `chan send` | 无缓冲或队列已满，接收方提前退出 | 加缓冲、`select` 加 `ctx.Done()` |
| 栈顶是 `chan receive` | 发送方没 `close` | 明确所有权，发送方 `defer close` |
| 栈顶是 `select` | 没有任何退出分支 | 补上 ctx 或超时 |
| 栈顶是 `IO wait` | `resp.Body` 没关、连接没释放 | `defer resp.Body.Close()`，读完 `io.Copy(io.Discard, ...)` |
| 数量随 QPS 线性增长 | 每请求起 goroutine，无界 | worker pool + 有界队列 + 丢弃策略 |
| 数量随超时时间增长 | 派生了 ctx 却没 `cancel` | `defer cancel()` |

goroutine 的生命周期必须有人负责。写 `go` 之前先想清楚三件事：它在等谁、谁会叫醒它、叫不醒时谁来收场。想不清这三件事，那行 `go` 大概率就是下一个泄漏点。
