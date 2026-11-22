> 原文链接：[Go 的 defer：return 之后发生的事 - 码日新 · 每日文章](https://daily.xplanc.org/zh/go/Go-的-defer：return-之后发生的事.md)

---

# Go 的 defer：return 之后发生的事

`defer` 大概是 Go 里最容易“看起来懂了”的关键字：把语句往后一放，函数退出时执行，简单。可一旦碰上命名返回值、闭包和 `recover`，同一段代码就能跑出完全相反的结果。问题不在 `defer` 本身，而在我们对 `return` 的想象太简单——它并不是一个原子动作。搞清这三个步骤，绝大多数“返回值被吞了”“资源没释放”的怪现象都会变得顺理成章。

## 一个反直觉的例子

先看两段几乎一样的代码：

```go
func withNamed() (result int) {
    defer func() {
        result++
    }()
    return 1
}

func withoutNamed() int {
    var result int
    defer func() {
        result++
    }()
    return result
}
```

调用结果是：`withNamed()` 返回 **2**，`withoutNamed()` 返回 **0**。

两段代码都把 `result` 加了 1，为什么一个生效一个不生效？区别在于函数签名：前者用了命名返回值，后者没有。要解释这件事，得拆开 `return` 看。

## return 其实分三步

Go 规范里，`return` 语句的执行过程可以粗略理解为：

1. **求值并赋值**：计算 `return` 后面表达式的值，写进“返回值槽位”。命名返回值里，这个槽位就是那个有名字的变量；没命名时，是一个调用者看不到的临时变量。
2. **执行 defer**：按后进先出的顺序，把当前函数注册的所有 `defer` 跑一遍。
3. **真正返回**：把槽位里的值交给调用者，函数结束。

回到前面的例子。`withNamed` 里，`return 1` 把 `1` 写进名为 `result` 的变量；随后 `defer` 执行 `result++`，`result` 变成 `2`；最后返回的就是 `2`。而 `withoutNamed` 里，`return result` 先把局部变量 `result` 当时的值 `0` 复制进临时返回槽；之后 `defer` 改的是局部变量，临时槽里的 `0` 没人动，所以返回 `0`。

一句话总结：**`defer` 能改的是“返回值槽位”，而命名返回值让这个槽位有了名字，因此可以被 `defer` 直接操作。**

## 参数在注册时求值，闭包在调用时读值

另一个常见误区是 `defer` 后面函数的参数什么时候确定。规则是：`defer` 语句执行到的时候，参数就求值并保存下来了；但如果是闭包，闭包体内读的自由变量则是执行时才去看。

```go
func argsVsClosure() {
    i := 1
    defer fmt.Println("参数:", i) // 立即求值 → 1
    defer func() {
        fmt.Println("闭包:", i) // 执行时读 → 2
    }()
    i = 2
}
```

输出是：

```
闭包: 2
参数: 1
```

注意两个细节：一是两个 `defer` 按注册的反序执行，所以闭包那句先打印；二是参数版定格在 `1`，闭包版拿到了 `2`。循环里尤其容易踩这个坑——如果 `defer func(){ fmt.Println(i) }()` 写在 `for` 里，多个闭包可能引用同一个变量（循环变量的语义直到 Go 1.22 才改成每次迭代生成新变量）。稳妥的做法是把值当参数传进去：

```go
for _, v := range items {
    defer func(x string) {
        fmt.Println(x)
    }(v) // 立刻把 v 的当前值绑到 x 上
}
```

## 多个 defer 是一摞盘子

`defer` 遵循后进先出（LIFO），最后注册的先执行。这个顺序正好匹配“后打开的资源先关闭”的需求：

```go
func copyFile(src, dst string) error {
    in, err := os.Open(src)
    if err != nil {
        return err
    }
    defer in.Close()

    out, err := os.Create(dst)
    if err != nil {
        return err
    }
    defer out.Close()

    _, err = io.Copy(out, in)
    return err
}
```

`defer out.Close()` 后注册，因此先执行，然后才关 `in`。即使 `io.Copy` 中途返回错误，两个文件也都会被关闭。

但循环里要小心：

```go
func processAll(paths []string) {
    for _, p := range paths {
        f, err := os.Open(p)
        if err != nil {
            continue
        }
        defer f.Close() // 所有文件都堆到函数返回时才关
        // ...处理 f
    }
}
```

如果 `paths` 有几千个，`processAll` 返回前会一直持有几千个文件描述符，很容易撞上 `too many open files`。解法是把每次处理抽成独立函数，让 `defer` 在小函数结束时就生效：

```go
func processAll(paths []string) {
    for _, p := range paths {
        processOne(p)
    }
}

func processOne(p string) {
    f, err := os.Open(p)
    if err != nil {
        return
    }
    defer f.Close()
    // ...处理 f
}
```

## defer + recover：吞掉 panic 的正确姿势

`recover` 只有在 `defer` 的函数里直接调用才有效，而且配合命名返回值才能把 panic 转成 error：

```go
func safeDivide(a, b int) (result int, err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v", r)
            result = 0
        }
    }()
    result = a / b // b 为 0 时会 panic
    return result, nil
}
```

当 `b == 0` 触发 panic 时，正常的 `return` 根本走不到，但 `defer` 依然会执行：它捕获 panic、给命名返回值 `err` 和 `result` 赋值，函数带着 `(0, error)` 正常返回。如果是匿名返回值，你在 `defer` 里改的局部变量就传不出去，调用方只会看到 panic 继续往外冒。

还有两个容易忽略的点：

- `os.Exit` 会立刻终止程序，**不会**执行任何 `defer`，清理逻辑请用 `return` 让函数正常退出。
- `defer` 里如果自己再 panic，会覆盖原来的 panic；恢复逻辑里尽量别做可能出错的事。

## 一张表速查

| 场景 | 实际行为 | 关键点 |
| --- | --- | --- |
| `defer f(i)` | `f` 收到注册时的 `i` | 参数立即求值 |
| `defer func(){ f(i) }()` | `f` 收到执行时的 `i` | 闭包捕获变量 |
| 命名返回值 + `defer` 修改 | 修改生效 | 操作的是返回槽位本身 |
| 匿名返回值 + `defer` 改局部量 | 不生效 | 返回值已经复制 |
| 多个 `defer` | 后进先出 | 像栈一样入栈出栈 |
| `recover` 写在普通函数里 | 无效 | 必须在 `defer` 函数内直接调用 |

## 别为了省开销而手写清理

很多人早年被告诫“defer 很慢”，于是在热路径里硬写手动清理。Go 1.14 引入了开放编码 defer（open-coded defers），绝大多数场景的开销已经低到可以忽略——编译器能内联的 `defer` 几乎就是几条指令。除非你用 profile 证明它确实是瓶颈，否则放心用 `defer`：代码更短，也不会因为中途 `return` 漏掉清理。

## 相关文章

- [Go 的 map 被并发写时，为什么连 recover 都救不了](https://daily.xplanc.org/zh/go/Go-的-map-被并发写时，为什么连-recover-都救不了.md)
- [nil 指针，为什么不等于 nil](https://daily.xplanc.org/zh/go/nil-指针，为什么不等于-nil.md)
- [Go 切片实战：扩容、共享底层数组与隐藏的内存泄漏](https://daily.xplanc.org/zh/go/Go-切片实战：扩容、共享底层数组与隐藏的内存泄漏.md)
- [Go 的 goroutine 泄漏：没人接收的消息去哪了](https://daily.xplanc.org/zh/go/Go-的-goroutine-泄漏：没人接收的消息去哪了.md)

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
