# Go 切片实战：append 之后，原数组为什么变了

## 从一个“见鬼”的现象说起

上周排查一个数据错乱的 bug，最后定位到三行代码：

```go
base := []int{1, 2, 3, 4}
a := base[:2]
b := base[1:3]

a = append(a, 99)
fmt.Println(base, a, b)
```

输出是：

```text
[1 2 99 4] [1 2 99] [2 99]
```

我们没有对 `base` 做任何赋值，`b` 却莫名其妙变了。原因不复杂：**切片不是数组，它只是一个指向底层数组的“视图”**。理解这一点，能避开 Go 里最常见的一类隐蔽 bug。

## 切片到底是什么

运行时里，一个切片是三个字长的结构：

```go
type slice struct {
    array unsafe.Pointer // 底层数组首元素地址
    len   int            // 长度
    cap   int            // 容量：从 array 开始还能用多少
}
```

切片赋值、传参都是**浅拷贝这个结构体**，底层数组仍然是同一块。所以 `a := base[:2]` 之后，`a.array` 和 `base.array` 指向同一个地址。

`append` 的行为由容量决定：

- `len < cap`：直接写进底层数组的 `array[len]`，然后 `len++`；
- `len == cap`：申请一块更大的新数组，拷贝旧数据，返回指向新数组的切片。

上面那段代码里，`a` 的 `len=2`、`cap=4`，放得下，于是 `99` 被写进了 `base[2]`。而 `b` 正好覆盖 `base[1:3]`，自然就跟着变了。

## 坑一：在函数里复用入参的底层数组

这个模式很常见，看起来还很“高效”：

```go
func filterEven(nums []int) []int {
    out := nums[:0] // 复用入参的底层数组
    for _, n := range nums {
        if n%2 == 0 {
            out = append(out, n)
        }
    }
    return out
}

func main() {
    nums := []int{1, 2, 3, 4, 5, 6}
    evens := filterEven(nums)
    fmt.Println(nums, evens)
}
```

输出：

```text
[2 4 6 4 5 6] [2 4 6]
```

`nums` 被就地改写了。如果调用方后续还要用原切片，这就是灾难。这种写法在“原地过滤”场景下确实省内存，但必须写进文档，或者干脆别用：

```go
func filterEven(nums []int) []int {
    out := make([]int, 0, len(nums))
    for _, n := range nums {
        if n%2 == 0 {
            out = append(out, n)
        }
    }
    return out
}
```

多一次分配，换来的是调用方可以放心使用入参。**默认选安全的写法，只在性能确实成问题时才复用。**

## 坑二：以为 cap 是“翻倍”的

很多人记得“扩容翻倍”，但 Go 1.18 之后规则变了（源码 `runtime/slice.go` 的 `growslice`）：

```text
newLen > 2*oldCap  → newCap = newLen
oldCap < 256       → newCap = 2 * oldCap
否则                → 循环 newCap += (newCap + 3*256) / 4，直到 >= newLen
```

最后还会按内存 size class 向上取整，所以实际 `cap` 常常比公式算出来的更大。

跑一下最直观：

```go
s := make([]int, 0)
for i := 0; i < 10; i++ {
    s = append(s, i)
    fmt.Printf("len=%d cap=%d\n", len(s), cap(s))
}
```

```text
len=1 cap=1
len=2 cap=2
len=3 cap=4
len=4 cap=4
len=5 cap=8
len=6 cap=8
len=7 cap=8
len=8 cap=8
len=9 cap=16
len=10 cap=16
```

这说明两件事：小切片扩容很“浪费”（len=3 就占 4 格），以及**不要用 cap 推断任何东西**。需要确定容量时，自己用 `make` 指定：

```go
out := make([]int, 0, len(input)) // 一次分配，后续 append 不再扩容
```

批量拼接、日志聚合这类已知规模的场景，预分配往往能省掉几十次拷贝。

## 坑三：切片导致的内存泄漏

这是个真会吃满内存的问题：

```go
var header []byte

func parse(data []byte) {
    header = data[:8] // 只想留 8 个字节
}
```

`header` 只有 8 字节长度，但它指向的底层数组可能是 `data` 那 100MB 的整个文件。只要 `header` 活着，GC 就不会回收那块内存。go 的 GC 是按对象（底层数组）回收的，不是按切片长度。

修复只需一行：

```go
header = bytes.Clone(data[:8]) // 或 append([]byte(nil), data[:8]...)
```

同理，从大 `map` 或大切片里摘出少量元素长期持有，都应该做一次拷贝。

## 三条实用规则

**1. 要独立数据，就显式拷贝。** Go 1.21 起可以直接用标准库：

```go
import "slices"

copyOf := slices.Clone(base[:2])
```

**2. 要限制 append 的“越界写入”，用三索引切片。** 完整形式是 `s[low:high:max]`，`cap` 被限制为 `max-low`：

```go
base := []int{1, 2, 3, 4}
a := base[:2:2] // len=2, cap=2
a = append(a, 99)
fmt.Println(base, a) // [1 2 3 4] [1 2 99]
```

因为 `cap` 已满，`append` 只能新分配，`base` 安全了。封装返回子切片的函数时，这是个好习惯。

**3. 传参时想清楚语义。** 函数接收 `[]T` 时，能不能改写元素、能不能 `append` 进去，应该在注释里写明白。调用方无法从签名看出来。

## 小结

切片的设计其实很优雅：一个三字长的描述符，让“子数组”零成本。代价是它把别名关系藏了起来。判断一段代码安不安全，只需要问三个问题：

- 这个切片的 `len` 和 `cap` 各是多少？
- `append` 会不会落进已有的底层数组？
- 这块底层数组还有谁在引用，会不会被意外改写或长期占住？

把这三个问题养成习惯，大部分“数据莫名其妙变了”和“内存下不去”的问题，在写代码时就能避免。

---

> 原文链接：[Go 切片实战：append 之后，原数组为什么变了](https://daily.xplanc.org/go/Go-%E5%88%87%E7%89%87%E5%AE%9E%E6%88%98%EF%BC%9Aappend-%E4%B9%8B%E5%90%8E%EF%BC%8C%E5%8E%9F%E6%95%B0%E7%BB%84%E4%B8%BA%E4%BB%80%E4%B9%88%E5%8F%98%E4%BA%86.md)
