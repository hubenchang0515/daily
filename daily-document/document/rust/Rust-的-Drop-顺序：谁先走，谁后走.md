# Rust 的 Drop 顺序：谁先走，谁后走

先看一段不会打印出 `done` 的代码：

```rust
use std::sync::Mutex;

fn main() {
    let counter = Mutex::new(0);

    match *counter.lock().unwrap() {
        0 => *counter.lock().unwrap() = 1, // 卡在这里
        _ => {}
    }

    println!("done");
}
```

单线程、没有竞争、没有 `unsafe`，程序却永久挂起。原因不是 `Mutex` 有问题，而是 `*counter.lock().unwrap()` 里的 `MutexGuard` 是**临时值**，它的析构点在 `match` 表达式结束处，而不是读完数字的那一刻。于是第一把锁还握着，第二把锁就来了。

`Drop` 是 Rust 里最沉默的机制：写对了没人注意，写错了就是死锁、泄漏、或者“为什么文件还没关”。这篇文章把它的顺序规则拆开讲清楚。

## 作用域：变量逆序，越晚声明越早走

同一作用域里的局部变量，按声明的**逆序**析构：

```rust
struct Noisy(&'static str);

impl Drop for Noisy {
    fn drop(&mut self) {
        println!("drop {}", self.0);
    }
}

fn main() {
    let _a = Noisy("a");
    let _b = Noisy("b");
    println!("-- 作用域结束 --");
}
```

输出：

```
-- 作用域结束 --
drop b
drop a
```

这条规则解释了为什么“守卫对象”模式好用：把锁、文件句柄、事务包成一个值，声明在函数开头，它就会在所有后续代码之后才释放，天然覆盖了提前 `return` 和 `?` 的路径。

## 结构体：字段反而按声明顺序

局部变量逆序，但**结构体的字段是正序**析构的：

```rust
struct Pair {
    first: Noisy,
    second: Noisy,
}

fn main() {
    let _pair = Pair { first: Noisy("first"), second: Noisy("second") };
    let _tail = Noisy("tail");
    println!("-- 作用域结束 --");
}
```

```
-- 作用域结束 --
drop first
drop second
drop tail
```

规则是“先整体、后局部”：`_pair` 先被整体析构，内部字段按声明顺序走；然后才轮到 `_tail`。同样的正序规则适用于元组字段、数组元素和 `Vec` 的元素（从第一个到最后一个）。

一个容易被忽略的推论：如果你的类型实现了 `Drop`，就不能再把字段移动出去（编译错误 E0509），因为编译器必须保证析构时结构体是完整的。需要拆字段时，用 `ManuallyDrop` 或 `Option::take`。

## 临时值：活到语句末尾

临时值的生命周期是“所在语句结束”，不是“用完就扔”：

```rust
fn main() {
    let s = String::from("hello").as_str(); // E0716
    println!("{s}");
}
```

编译器会告诉你 temporary value dropped while borrowed。因为 `String` 在语句结束就被释放了，`&str` 立刻悬空。

只有特定语法位置会**延长**临时值的生命周期，最典型的是 `let` 后面直接跟一个引用：

```rust
let s: &str = &String::from("hello"); // OK，临时值被延长到 s 的作用域
```

记住这个区别：`&临时值` 放在 `let` 初始化位置可以延长，经过一次方法调用（`.as_str()`）就不行了。

Rust 2024 edition 还调整了块尾表达式的临时值顺序：块尾的临时值会先于该块的局部变量析构，而 2021 里是反过来的。跨 edition 迁移时，这类差异值得单独跑一遍测试。

## 一个 `let _` 的误会

很多人以为 `let _ = x;` 能立刻释放 `x`，其实不会：

```rust
let v = vec![1, 2, 3];
let _ = v;          // 不移动、不析构，v 仍活到作用域结束
drop(v);            // 这才是显式析构
```

`_` 是一个不绑定任何东西的模式，既不移动也不析构。但换成表达式就不同了：

```rust
let _ = String::from("tmp"); // 临时值在语句结束即析构
```

想真正提前释放，用 `drop(value)`。它只是个普通函数，接收所有权，函数返回时值被析构——所以对 `Copy` 类型调用 `drop` 是无意义的，编译器还会警告。

## 提前返回和 panic 也是正常退出

`return`、`?`、`break` 都会按作用域逐层退出，每一层照常逆序析构。这就是为什么下面这段代码是安全的：

```rust
fn write(path: &str) -> std::io::Result<()> {
    let file = std::fs::File::create(path)?; // file 出错时已被正确关闭
    let mut guard = Some(file);
    do_work(&mut guard)?;                    // 提前返回，guard 依然会被析构
    Ok(())
}
```

真正不执行析构的情况只有这几种：`std::process::exit`、`abort`、`mem::forget`、`Box::leak`，以及 `Rc` 的循环引用。所以“靠 `Drop` 保证数据落盘”是危险的假设，关键路径上还是显式 `flush` / `sync_all` 更稳。

还有一个坑：如果 `drop` 里 panic，而此时线程正在因另一个 panic 展开，进程会直接 abort——双重 panic 不允许。`Drop` 实现里尽量避免 `unwrap`。

## async 里，Drop 可能来得更晚

`async` 块里的局部变量，析构时机是**这个 future 被析构**的时候，而不是 `.await` 返回的时候。这带来两个实际后果：

```rust
async fn bad(m: &std::sync::Mutex<i32>) {
    let g = m.lock().unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    println!("{}", *g);
}
```

这段代码编译不过：`MutexGuard` 不是 `Send`，跨 `.await` 持有会让 future 不满足 `Send`。就算换成单线程运行时能跑，锁也会被持有整个等待期间。异步场景请用 `tokio::sync::Mutex`，并且尽量把 `await` 放在锁外面。

更极端的情况是 future 被 `select!` 丢弃：那一刻局部变量才析构，如果它持有锁或连接，资源释放的时机和你以为的完全不同。

## 一张速查表

| 场景 | 析构顺序 |
| --- | --- |
| 同作用域局部变量 | 逆序（后声明先走） |
| 结构体 / 枚举变体字段 | 声明顺序 |
| 元组、数组、`Vec` 元素 | 从前到后 |
| 闭包捕获的变量 | 未指定 |
| 函数参数 | 函数体局部变量之后 |
| 语句内的临时值 | 语句结束 |

## 回到开头那把锁

理解了临时值的边界，修法就很直接——把读值和加锁拆成两条语句：

```rust
let value = *counter.lock().unwrap(); // guard 在分号处释放
if value == 0 {
    *counter.lock().unwrap() = 1;
}
```

或者显式缩短作用域：

```rust
let should_set = {
    let g = counter.lock().unwrap();
    *g == 0
}; // g 在这里析构
if should_set {
    *counter.lock().unwrap() = 1;
}
```

写 Rust 时值得养成一个习惯：看到 `Mutex`、`RefCell::borrow_mut`、文件句柄，先问一句“这个值的析构点在哪一行”。答案通常不是“用完那一行”，而是“语句结束”或“作用域结束”。想清楚这一点，很多诡异的死锁和借用冲突就变成了可以解释的现象。

---

> 原文链接：[Rust 的 Drop 顺序：谁先走，谁后走](https://daily.xplanc.org/rust/Rust-%E7%9A%84-Drop-%E9%A1%BA%E5%BA%8F%EF%BC%9A%E8%B0%81%E5%85%88%E8%B5%B0%EF%BC%8C%E8%B0%81%E5%90%8E%E8%B5%B0.md)
