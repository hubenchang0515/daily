> 原文链接：[Rust 闭包的三张面孔：Fn、FnMut 与 FnOnce - 码日新 · 每日文章](https://daily.xplanc.org/rust/Rust-闭包的三张面孔：Fn、FnMut-与-FnOnce.md)

---

# Rust 闭包的三张面孔：Fn、FnMut 与 FnOnce

同一个闭包，有时可以连续调用两次，有时第二次就编译失败；有时加个 `move` 就能塞进线程，有时加了仍然报错。问题不在 `move` 本身，而在于闭包如何使用外部变量，这决定了它最终实现 `Fn`、`FnMut` 还是 `FnOnce`。

## 先看捕获，再谈 trait

闭包不会先声明“我是 Fn”，编译器先看它如何使用外部变量，再倒推它实现了哪些 trait。默认情况下，能借就借：

```rust
fn main() {
    let mut v = vec![1, 2, 3];
    let show = || println!("{v:?}");

    v.push(4);
    show();
}
```

这段代码编译失败：

```text
error[E0502]: cannot borrow `v` as mutable because it is also borrowed as immutable
```

`show` 持有 `v` 的不可变借用，而借用要持续到 `show` 最后一次被使用，也就是 `show()` 那一行。`v.push(4)` 在中间要求可变借用，冲突就发生了。非 Lexical Lifetime 会把借用缩短到最后一次使用，但不会短到“闭包定义完就结束”。

闭包捕获外部变量有三种方式：不可变借用、可变借用、按值获取。前两种由闭包体里的用法推断；当闭包需要拿走所有权时，也会按值捕获，`move` 的作用是强制所有用到的变量都按值捕获。

## 三个 trait，是三种调用权限

| Trait | 调用时需要的接收者 | 对捕获变量做了什么 | 结果 |
| --- | --- | --- | --- |
| `Fn` | `&self` | 只读 | 可以反复调用 |
| `FnMut` | `&mut self` | 可以修改，但不搬走 | 可以反复调用，调用者需要可变权限 |
| `FnOnce` | `self` | 可能把值搬走 | 只能调用一次，调用会消耗闭包 |

三者是包含关系：`Fn` 是 `FnMut` 的子 trait，`FnMut` 又是 `FnOnce` 的子 trait。所以一个只读闭包既能传给要求 `Fn` 的参数，也能传给要求 `FnMut` 或 `FnOnce` 的参数；反过来不行。

## `move` 改变的是捕获方式

很多人以为加了 `move`，闭包就变成 `FnOnce`。其实不是：

```rust
let s = String::from("hello");
let f = move || println!("{s}");

f();
f();                 // 可以调用多次
println!("{s}");     // error[E0382]: borrow of moved value: `s`
```

闭包按值拿走了 `s`，所以外部不能再使用它。但闭包体里只是借用 `s` 来打印，调用时不需要修改或消耗它，因此这个闭包仍然实现 `Fn`。

如果捕获的是 `Copy` 类型，`move` 甚至只是复制：

```rust
let n = 1;
let f = move || n + 1;

f();
f();
println!("{n}"); // 仍然可用
```

记住一句话：`move` 决定变量怎么进闭包，不决定闭包能被调用几次。

## 什么时候真的变成 `FnOnce`

当闭包体把捕获的值搬出去时，它就只能实现 `FnOnce`：

```rust
let s = String::from("hello");
let take = move || s;

let a = take();
let b = take(); // error[E0382]: use of moved value: `take`
```

第一次调用 `take()` 时，闭包本身被消耗，`s` 被移出；第二次调用时闭包已经没了。`drop(s)` 写在闭包里也是同样的效果，因为 `drop` 按值接收参数。

这也是 `Iterator::map` 常见的报错来源：

```rust
let s = String::from("x");
let out: Vec<String> = vec![1, 2]
    .into_iter()
    .map(move |_| s)
    .collect();
```

`map` 要求 `FnMut`，但这里的闭包第一次调用就把 `s` 移走了，只能实现 `FnOnce`，编译器会明确提示：

```text
expected a closure that implements the `FnMut` trait,
but this closure only implements `FnOnce`
```

修法不是去掉 `move`，而是让每次调用都产生一个新值，比如 `move |_| s.clone()`。

## `FnMut`：能改，但调用者要先有 `mut`

```rust
let mut count = 0;
let mut next = || {
    count += 1;
    count
};

assert_eq!(next(), 1);
assert_eq!(next(), 2);
```

闭包持有 `count` 的可变借用，所以 `next` 绑定本身必须是 `mut`，否则报 `cannot borrow next as mutable`。在 `next` 还被使用期间，也不能从外部读写 `count`，否则又是一次借用冲突。

泛型函数里同样要注意：

```rust
fn call_twice<F: FnMut() -> i32>(mut f: F) -> (i32, i32) {
    (f(), f())
}
```

参数 `f` 若不加 `mut`，函数体里无法调用 `FnMut` 闭包。

## 返回闭包、开线程：`move` 出现的真正原因

返回一个捕获局部变量的闭包时，借用无法活过函数体，必须把值搬进闭包：

```rust
fn make_adder(n: i32) -> impl Fn(i32) -> i32 {
    move |x| x + n
}
```

线程也是同理。`thread::spawn` 要求闭包满足 `FnOnce + Send + 'static`：

```rust
let s = String::from("hi");
let handle = std::thread::spawn(move || println!("{s}"));

handle.join().unwrap();
```

不加 `move`，闭包借用局部变量 `s`，无法满足 `'static`。但要小心：`move` 只搬走变量本身，不延长变量内部引用的生命周期。下面这样仍然不行：

```rust
let s = String::from("hi");
let r = &s;

std::thread::spawn(move || println!("{r}")); // 仍然报错
```

搬进闭包的是 `&s`，它依旧指向当前栈帧。想让线程借用局部变量，应使用作用域线程：

```rust
let s = String::from("hi");

std::thread::scope(|scope| {
    scope.spawn(|| println!("{s}"));
});
```

`scope` 会保证所有线程在离开作用域前结束，因此借用是安全的。

## 存进结构体：泛型还是 trait object

闭包的类型是编译器生成的匿名类型，写不出来，所以结构体字段通常有两种写法。

泛型写法没有额外分配，但每个闭包类型都会单态化出一份代码：

```rust
struct Handler<F: FnMut(i32) -> i32> {
    f: F,
}

impl<F: FnMut(i32) -> i32> Handler<F> {
    fn run(&mut self, x: i32) -> i32 {
        (self.f)(x)
    }
}
```

需要在一个容器里放不同闭包时，用 trait object：

```rust
struct Handler {
    f: Box<dyn FnMut(i32) -> i32>,
}
```

调用 `Box<dyn FnMut>` 时仍然需要可变借用，所以方法接收者要写成 `&mut self`。

## 一张排查清单

- 报 `expected FnMut, but this closure only implements FnOnce`：闭包把捕获值移走了，改成借用、克隆，或调整调用模型。
- 报 `closure may outlive the current function`：闭包借用了局部变量，加 `move`；如果捕获的是引用，考虑作用域线程或调整所有权。
- 报 `cannot borrow ... as mutable`：调用 `FnMut` 闭包需要 `mut` 绑定，或者闭包与外部访问发生了借用冲突。
- 报 `use of moved value`：调用了一个 `FnOnce` 闭包两次，闭包第一次调用后已经被消耗。
- 不确定闭包实现了什么：先看它是否修改捕获值，再看它是否把捕获值移出闭包体。只读是 `Fn`，修改是 `FnMut`，移出是 `FnOnce`。

闭包的 trait 并不神秘，它只是编译器对“你打算怎么使用捕获变量”给出的精确回答。
