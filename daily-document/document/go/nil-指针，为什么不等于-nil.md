> 原文链接：[nil 指针，为什么不等于 nil - 码日新 · 每日文章](https://daily.xplanc.org/go/nil-指针，为什么不等于-nil.md)

---

# nil 指针，为什么不等于 nil

先看一段能直接跑起来的代码：

```go
package main

import "fmt"

type MyError struct{ Code int }

func (e *MyError) Error() string {
	return fmt.Sprintf("code=%d", e.Code)
}

func mayFail(ok bool) error {
	var err *MyError
	if !ok {
		err = &MyError{Code: 500}
	}
	return err
}

func main() {
	err := mayFail(true)
	fmt.Printf("err = %v\n", err)
	fmt.Printf("err == nil: %v\n", err == nil)

	if err != nil {
		fmt.Println("这里被当成失败处理了")
	}
}
```

输出是：

```text
err = <nil>
err == nil: false
这里被当成失败处理了
```

明明打印出来是 `<nil>`，判断却不等于 `nil`。这不是编译器的问题，而是接口值本身的构造方式决定的。

## 接口值里装的是两样东西

Go 的接口值不是一个简单的指针，而是一对字。非空接口大致是这样：

```go
type iface struct {
	tab  *itab          // 动态类型 + 方法表
	data unsafe.Pointer // 实际数据
}
```

空接口 `any` 类似，只是第一项换成了类型信息 `*_type`。

关键在于：**接口值等于 `nil`，要求类型信息和数据同时为空。** 只要类型信息还在，这个接口就不是 `nil`，哪怕它装着一个值为 `nil` 的指针。

回到上面的例子。`mayFail` 的返回类型是 `error`，而 `err` 的声明类型是 `*MyError`。执行 `return err` 时，发生了一次隐式转换：

- 类型信息：`*MyError`
- 数据：`nil`

于是返回的接口值长这样：

```text
error((*MyError)(nil))
```

它当然不等于 `nil`。

几种常见写法对比：

| 写法 | 动态类型 | 数据 | `== nil` |
| --- | --- | --- | --- |
| `var err error` | 无 | nil | true |
| `err := error(nil)` | 无 | nil | true |
| `var p *MyError; var err error = p` | `*MyError` | nil | false |
| `return err`（`err` 是 `*MyError`） | `*MyError` | nil | false |

## `return err` 和 `return nil` 不是一回事

问题往往出在“先声明一个具体类型的变量，再返回”。

反例：

```go
func mayFail(ok bool) error {
	var err *MyError

	if !ok {
		err = &MyError{Code: 500}
	}

	return err // 成功时返回的是 (*MyError)(nil)
}
```

正确写法有两种。

第一种，成功路径直接返回 `nil`：

```go
func mayFail(ok bool) error {
	if !ok {
		return &MyError{Code: 500}
	}
	return nil
}
```

第二种，如果确实需要变量，就把它声明成接口类型：

```go
func mayFail(ok bool) error {
	var err error

	if !ok {
		err = &MyError{Code: 500}
	}

	return err
}
```

区别只有一行：`var err error` 还是 `var err *MyError`。前者在成功时是一个真正的空接口，后者会留下类型信息。

## 不止 `error`，任何接口都会中招

同样的陷阱出现在所有接口上。比如：

```go
type Reader struct{ name string }

func (r *Reader) String() string { return r.name }

func main() {
	var r *Reader
	var s fmt.Stringer = r

	fmt.Printf("%T %v\n", s, s) // *main.Reader <nil>
	fmt.Println(s == nil)       // false
	fmt.Println(s.String())     // panic: nil pointer dereference
}
```

`r` 是 `nil`，但赋给 `fmt.Stringer` 之后，接口里保存了 `*Reader` 这个类型。判断不为 `nil`，调用方法时又去读 `r.name`，于是 panic。

`io.Reader`、`io.Writer`、自定义接口，逻辑完全一样。

## 为什么日志里打印的是 `<nil>`

因为 `fmt` 格式化的是接口里的**数据**，不是接口本身。`*MyError` 的零值是空指针，所以 `%v` 输出 `<nil>`。

这就造成了最迷惑人的场景：

```text
日志：err = <nil>
代码：if err != nil { ... }  // 进去了
```

看到这种日志，不要怀疑人生，先打印动态类型：

```go
fmt.Printf("%T %v\n", err, err)
```

如果输出是：

```text
*main.MyError <nil>
```

说明接口非空，里面装着一个空指针。

如果输出是：

```text
<nil> <nil>
```

那才是真正的空接口。

## `errors.As` 也会被它骗

有类型的 `nil` 不仅能骗过 `!= nil`，还能骗过 `errors.As`：

```go
type NotFoundError struct{ Key string }

func (e *NotFoundError) Error() string {
	return "not found: " + e.Key
}

func lookup(key string) error {
	var err *NotFoundError
	if key == "" {
		err = &NotFoundError{Key: key}
	}
	return err
}

func main() {
	err := lookup("golang")

	var nf *NotFoundError
	if errors.As(err, &nf) {
		fmt.Println(nf.Key) // nf 仍是 nil，这里 panic
	}
}
```

`errors.As` 只检查动态类型是否匹配，匹配成功后把值赋给 `nf`。这个值本来就是 `nil`，所以 `nf` 依然是空指针。类型断言也是同样的道理：

```go
if e, ok := err.(*NotFoundError); ok {
	// ok 为 true，但 e 可能是 nil
}
```

所以拿到具体类型之后，仍然要单独判断一次 `e != nil`。

## 排查时可以借用反射

调试阶段可以用反射看清接口里到底装了什么：

```go
func isNilInterface(i any) bool {
	if i == nil {
		return true
	}

	v := reflect.ValueOf(i)
	switch v.Kind() {
	case reflect.Ptr, reflect.Map, reflect.Slice,
		reflect.Func, reflect.Chan, reflect.Interface:
		return v.IsNil()
	}
	return false
}
```

这个函数会把“装着 nil 指针的接口”也视为 `nil`。它适合排查问题，但不要拿它替代正常的错误处理，否则等于把类型系统的检查绕过去了。

`staticcheck` 的 SA4023 也能发现一部分“接口值永远非 nil”的比较，值得加进 CI。

## 三条写法上的规则

1. **返回接口时，成功路径直接写 `return nil`**，不要返回具体类型的零值。
2. **需要变量时，声明成接口类型**：`var err error`，而不是 `var err *MyError`。
3. **拿到具体类型后仍然要判空**：`errors.As` 和类型断言成功，不代表里面的指针不是 `nil`。

接口值由“类型”和“数据”两部分组成。`== nil` 检查的是这两部分是否都为空。空指针只是数据为空，类型还在，所以它不等于 `nil`。

下次再看到日志里写着 `<nil>`、代码却走进了错误分支，先加上 `%T`，答案通常就在那一行输出里。
