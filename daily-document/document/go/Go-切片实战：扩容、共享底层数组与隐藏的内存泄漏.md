# Go 切片实战：扩容、共享底层数组与隐藏的内存泄漏

切片是 Go 里用得最多的数据结构，也是最容易被“用错但不报错”的一个。`append` 不报错、`s[1:3]` 不报错、函数传参也不报错，可程序的行为和内存占用却可能和你以为的完全不同。这篇把三个最容易踩的点拆开讲：切片到底是什么、扩容怎么发生、底层数组什么时候会被无意共享。

## 一、切片是一个 24 字节的描述符

切片不是“数组的引用”这么模糊的东西，它在运行时就是一个三字段结构：

```go
type slice struct {
	array unsafe.Pointer // 底层数组首元素地址
	len   int            // 当前长度
	cap   int            // 从 array 开始可用的元素个数
}
```

在 64 位平台上，一个切片头占 24 字节。这解释了两件事：

- 切片赋值、传参都是**拷贝这个头**，代价极小，不拷贝元素；
- 但拷贝的是指针，所以两个切片可以指向同一块内存。

验证一下：

```go
package main

import (
	"fmt"
	"unsafe"
)

func main() {
	s := []int{1, 2, 3}
	fmt.Println(unsafe.Sizeof(s)) // 24
}
```

因为传参只是复制头，所以在函数内部 `append` 导致扩容时，**调用方的 len 不会变**：

```go
func add(s []int) {
	s = append(s, 4)
	fmt.Println("inside:", len(s)) // 4
}

func main() {
	s := []int{1, 2, 3}
	add(s)
	fmt.Println("outside:", len(s)) // 3
}
```

如果希望调用方看到新元素，要么返回新切片，要么传入 `*[]int`。前者是 Go 的惯用做法。

## 二、扩容规则：别背数字，跑一遍

`append` 在 `len == cap` 时会分配新数组并复制。容量怎么涨？简化说法是“小于 256 翻倍，大于等于 256 每次涨约 1.25 倍”，但实际还要按内存分配器的 size class 向上取整，所以最终 cap 往往是个“不整齐”的数。

与其记结论，不如自己跑：

```go
package main

import "fmt"

func main() {
	var s []int
	prev := 0
	for i := 0; i < 2000; i++ {
		s = append(s, i)
		if cap(s) != prev {
			fmt.Printf("len=%4d cap=%4d\n", len(s), cap(s))
			prev = cap(s)
		}
	}
}
```

在 amd64 上的输出大致是：

```text
len=   1 cap=   1
len=   2 cap=   2
len=   3 cap=   4
...
len= 257 cap= 512
len= 513 cap= 848
len= 849 cap=1280
len=1281 cap=1792
```

注意 512 之后不再是翻倍，而是 848、1280、1792 这种带零头的值——这就是 size class 取整的结果。这些数字属于实现细节，Go 1.18 前后就调整过增长公式，**不要在代码里依赖精确容量**。

实践上的推论只有一条：如果能预估规模，就用 `make([]T, 0, n)` 一次性分配，避免多次复制：

```go
// 差：可能扩容好几次
var ids []int
for _, u := range users {
	ids = append(ids, u.ID)
}

// 好：一次分配到位
ids := make([]int, 0, len(users))
for _, u := range users {
	ids = append(ids, u.ID)
}
```

## 三、共享底层数组：最隐蔽的副作用

这是切片最容易出问题的地方。看这段：

```go
a := []int{1, 2, 3, 4, 5}
b := a[1:3]        // len=2 cap=4，指向 a[1]
b = append(b, 99)  // 没有扩容，直接写入 a[3]
fmt.Println(a)     // [1 2 3 99 5]
fmt.Println(b)     // [2 3 99]
```

`b` 的 cap 是 4（从 `a[1]` 到数组末尾），所以 `append` 不需要扩容，直接改写了 `a[3]`。这类 bug 在“解析一段数据后返回其中一部分”的场景里特别常见。

两种处理方式：

**1. 用三索引切片限制 cap**，让 `append` 必须扩容：

```go
b := a[1:3:3] // len=2 cap=2
b = append(b, 99)
fmt.Println(a) // [1 2 3 4 5]，a 未被修改
```

**2. 显式克隆**（Go 1.21+）：

```go
import "slices"

b := slices.Clone(a[1:3])
```

在需要把子切片长期保存、或交给其他 goroutine 时，明确拷贝一次几乎总是值得的。

顺带一个高频问题：`range` 拿到的是元素副本，改它不影响原切片。

```go
for _, v := range items {
	v.Name = "x" // 改的是副本
}
for i := range items {
	items[i].Name = "x" // 正确
}
```

## 四、看不见的内存泄漏：留 10 个元素，占着 100 MB

切片只保留底层数组的指针，而 GC 判断对象是否存活看的是**整个底层数组**。于是“只返回一小段”就可能让一大块内存无法回收。

假设要读取一个大文件并取出前 10 个字段：

```go
func firstFields(data []byte, n int) [][]byte {
	var out [][]byte
	start := 0
	for i, b := range data {
		if b == ' ' || b == '\n' {
			if i > start {
				out = append(out, data[start:i]) // 仍然指向 data
				if len(out) == n {
					return out
				}
			}
			start = i + 1
		}
	}
	return out
}
```

`data` 可能有几十 MB，返回的每个 `[]byte` 都是它的子切片，只要有一个还活着，整个 `data` 就回收不掉。修复很简单：

```go
out = append(out, slices.Clone(data[start:i]))
```

字符串也有同样的问题：`s[i:j]` 会共享底层字节数组，需要独立副本时用 `strings.Clone`。

怎么发现这类问题？跑基准测试看分配，或者直接看堆：

```bash
go test -run=^$ -bench=. -benchmem
go tool pprof -http=:8080 mem.pprof
```

`-benchmem` 里的 `B/op` 突然远大于数据本身大小，通常就是这类“小对象拖大数组”。

还有一个变体：切片当缓冲区复用。`s = s[:0]` 确实不会释放内存，这对 `[]byte` 缓冲是好事；但如果元素是指针或含指针的结构体，数组里仍保留着旧引用，GC 无法回收它们：

```go
for i := range buf {
	buf[i] = nil // 清空引用，再 buf = buf[:0]
}
buf = buf[:0]
```

## 五、nil 切片与空切片

```go
var a []int          // nil，len=0，cap=0
b := []int{}         // 非 nil，len=0，cap=0
c := make([]int, 0)  // 非 nil，len=0，cap=0
```

三者在 `len`、`range`、`append` 上行为一致，差别在序列化和比较：

```go
json.Marshal(a) // null
json.Marshal(b) // []
```

对接前端或严格校验的 API 时，这个差异会直接导致报错。要么统一初始化为 `[]T{}`，要么在文档里约定 `null` 的含义。

## 小结

- 切片头 24 字节，赋值和传参复制的是头，不是元素；函数内 `append` 扩容不会改变调用方的 len。
- 容量增长依赖实现和 size class，能预估就用 `make([]T, 0, n)`，不要依赖具体 cap 数值。
- 子切片会共享底层数组，`append` 可能悄悄改掉原数据；用 `a[low:high:max]` 或 `slices.Clone` 切断关联。
- 长期持有小切片可能拖住整个大数组，这是 Go 里最常见的隐形内存泄漏之一。
- `nil` 切片和空切片在 JSON 输出上不同，接口边界要显式约定。

---

> 原文链接：[Go 切片实战：扩容、共享底层数组与隐藏的内存泄漏](https://daily.xplanc.org/go/Go-%E5%88%87%E7%89%87%E5%AE%9E%E6%88%98%EF%BC%9A%E6%89%A9%E5%AE%B9%E3%80%81%E5%85%B1%E4%BA%AB%E5%BA%95%E5%B1%82%E6%95%B0%E7%BB%84%E4%B8%8E%E9%9A%90%E8%97%8F%E7%9A%84%E5%86%85%E5%AD%98%E6%B3%84%E6%BC%8F.md)
