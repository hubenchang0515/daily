# Go 的 map 被并发写时，为什么连 recover 都救不了

## 先看一段必崩的代码

```go
package main

import "sync"

func main() {
	m := map[int]int{}
	var wg sync.WaitGroup

	for id := 0; id < 2; id++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for i := 0; i < 1_000_000; i++ {
				m[i] = id
			}
		}(id)
	}
	wg.Wait()
}
```

```bash
go run main.go
# fatal error: concurrent map writes
# ...
# exit status 2
```

很多人第一反应是加个 `recover`：

```go
defer func() {
	if r := recover(); r != nil {
		log.Println("recovered:", r)
	}
}()
```

结果进程照样退出，日志里也不会出现 `recovered`。这不是 `recover` 写错了，而是这个错误根本不在 `panic` 体系里。

## fatal error 不是 panic

Go 运行时在写 map 时会先给 `hmap.flags` 置上 `hashWriting` 标志位。如果另一个 goroutine 此时也在写，或者正在读，运行时就调用 `runtime.throw` 直接终止进程：

- `concurrent map writes`：两个写操作撞上
- `concurrent map read and map write`：读和写撞上，遍历也算读

`throw` 走的是 `fatalthrow`，不展开栈，不执行 `defer`，直接以状态码 2 退出。也就是说，`recover` 没有机会介入。

更需要注意的是，这种检测是**尽力而为**的：它只在两次操作恰好落在标志位的窗口内才会触发。程序跑一万次没崩，不代表没有数据竞争，只代表这次没撞上。反过来，一旦线上真的崩了，堆栈里只会打印所有 goroutine 的状态，很难还原当时的业务上下文。

从 Go 1.24 起，map 的内部实现换成了 Swiss table，检测代码的位置变了，但“并发写直接 fatal”这条规则没有变。

## “我是值传递，应该没关系吧”

没关系是错觉。map 变量本身只是一个指向 `hmap` 的指针，函数传参复制的是这个指针：

```go
func fill(m map[string]int) {
	m["a"] = 1 // 改的是调用方的 map
}
```

同理，把 map 放进结构体再复制结构体，两个副本仍然共享同一份底层数据。加锁必须加在**所有**访问路径上，而不是加在“我以为独立”的那份副本上。

## 四种改法，按场景选

| 场景 | 方案 | 注意点 |
| --- | --- | --- |
| 读写都很频繁，逻辑复杂 | 单 goroutine 独占，其他 goroutine 用 channel 提交操作 | 吞吐受单点限制，但最容易保证正确 |
| 读多写少，临界区短 | `sync.RWMutex` | 写锁会阻塞后续读锁，别在锁里做 IO |
| key 基本只写一次、之后反复读 | `sync.Map` | 不适合“先 Load 再 Store”的读改写 |
| 写多、key 分散 | 分片锁 | 按 hash 把 key 分到 N 个 map，各自加锁 |

最常见的写法是给 map 包一层：

```go
type Counter struct {
	mu sync.Mutex
	m  map[string]int
}

func NewCounter() *Counter {
	return &Counter{m: make(map[string]int)}
}

func (c *Counter) Inc(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.m[key]++
}

func (c *Counter) Get(key string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.m[key]
}
```

两个细节：

1. `Counter` 必须用指针接收者，`sync.Mutex` 一旦使用就不能复制。
2. 不要提供 `func (c *Counter) Map() map[string]int` 这种返回内部 map 的方法，否则锁就白加了。

如果读远多于写，可以把 `Get` 换成 `RLock/RUnlock`。但 `RWMutex` 并不比 `Mutex` 快，它多了一层原子操作，临界区只有几行代码时，收益往往抵不过开销。先用 `Mutex`，压测确认读锁竞争是瓶颈再换。

`sync.Map` 也不是万能替代品：

```go
var m sync.Map

m.Store("a", 1)
v, ok := m.Load("a")

// 错误：Load 和 Store 之间不是原子的
if _, ok := m.Load("a"); !ok {
	m.Store("a", 1)
}

// 正确：用 LoadOrStore
actual, loaded := m.LoadOrStore("a", 1)
```

官方文档明确说它适合两类场景：key 只写一次、读很多次；或者多个 goroutine 读写互不相交的 key 集合。其余情况，普通的 map 加锁通常更清楚，也更快。

## 锁保护的是 map，不是 map 里的东西

这是比“忘了加锁”更隐蔽的一类 bug：

```go
type Cache struct {
	mu sync.Mutex
	m  map[string][]int
}

func (c *Cache) Append(k string, v int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.m[k] = append(c.m[k], v) // 读改写都在锁内，安全
}

func (c *Cache) Get(k string) []int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.m[k] // 危险：把底层数组交出去了
}
```

调用方拿到切片后继续 `append` 或改元素，就绕过了锁。要么返回副本：

```go
func (c *Cache) Get(k string) []int {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]int, len(c.m[k]))
	copy(out, c.m[k])
	return out
}
```

要么在文档里写清楚“返回值只读，且生命周期不超过下一次写”。存指针、存结构体也是同理：map 里放的是 `*Item`，锁只保证指针读写安全，`item.Count++` 依然要另外同步。

## 把它揪出来的办法

```bash
go test -race ./...
go test -race -count=50 ./...
GORACE="halt_on_error=1" go test -race ./...
```

`-race` 基于 happens-before 分析，能报出“没有同步的并发访问”，比等 fatal error 可靠得多。但它只能发现**实际发生过**的冲突，所以测试里必须真的并发：用 `sync.WaitGroup` 卡住所有 goroutine 再同时开跑，或者直接用 `t.Parallel()`。

线上不方便开 race 时，至少做两件事：

- 在预发环境用 `go build -race` 跑一轮压测；
- 把所有全局 map 列出来，逐个确认写入方是不是只有一个。

常见的隐藏来源包括：HTTP handler 里改全局缓存、定时任务和请求处理同时更新同一张表、用 map 做去重集合却在多个 goroutine 里 `m[k] = struct{}{}`、以及 `for k := range m` 遍历时别处仍在写。

## 检查清单

- 全局 map 是否有明确的“所有者”？没有就加锁或收归单 goroutine。
- 每个 `m[k] = v`、`delete(m, k)`、`range m` 是否都在同一把锁里？
- 有没有把 map 或其内部切片、指针泄露到锁外？
- `sync.Map` 的读改写是否用了 `LoadOrStore`、`CompareAndSwap` 这类原子操作？
- CI 是否跑了 `go test -race`？

map 的并发问题不会给你“偶尔算错”的温柔提示，它直接让进程消失。与其在崩溃后对着 `fatal error` 猜，不如在写第一行 `m[k] = v` 时就想清楚：这把锁，谁负责拿。

---

> 原文链接：[Go 的 map 被并发写时，为什么连 recover 都救不了](https://daily.xplanc.org/go/Go-%E7%9A%84-map-%E8%A2%AB%E5%B9%B6%E5%8F%91%E5%86%99%E6%97%B6%EF%BC%8C%E4%B8%BA%E4%BB%80%E4%B9%88%E8%BF%9E-recover-%E9%83%BD%E6%95%91%E4%B8%8D%E4%BA%86.md)
