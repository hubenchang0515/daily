> 原文链接：[Rust 的整数溢出：debug 会崩，release 为什么不会 - 码日新 · 每日文章](https://daily.xplanc.org/rust/Rust-的整数溢出：debug-会崩，release-为什么不会.md)

---

# Rust 的整数溢出：debug 会崩，release 为什么不会

下面这段程序，`cargo run` 会直接崩溃，`cargo run --release` 却会打印一个 `0`：

```rust
fn main() {
    let n: u8 = 255;
    let next = n + 1;
    println!("{next}");
}
```

debug 下的输出：

```text
thread 'main' panicked at src/main.rs:3:16:
attempt to add with overflow
```

release 下的输出：

```text
0
```

同一份源码、同一个编译器，只换了构建配置，行为就变了。整数溢出在 Rust 里不是“一种”行为，而是“两套”。

## 开关藏在 Cargo profile 里

Rust 的默认规则是：debug 构建检查溢出并 panic，release 构建按二进制补码回绕。控制它的是 `overflow-checks`：

```toml
[profile.dev]
overflow-checks = true

[profile.release]
overflow-checks = false
```

上面就是 Cargo 的默认值，等价于你什么都不写。需要时也可以反过来，让 release 也检查。

这里要强调一点：release 下的回绕是语言明确定义的行为，不是未定义行为。它和 C/C++ 里有符号整数溢出的性质不同，优化器不能因为“溢出不会发生”就把你的判断整个删掉。但回绕依然会让结果错得悄无声息。

编译期就能算出来的溢出更直接：

```rust
fn main() {
    let x: u8 = 255 + 1;
    println!("{x}");
}
```

```text
error: this arithmetic operation will overflow
```

常量折叠发生在编译期，这种写法与 profile 无关，直接编译失败。只有运行期才知道的溢出，才会出现 debug 和 release 的分歧。

## 把意图写出来

与其依赖构建配置，不如在代码里明确“溢出时应该怎么办”。标准库为每种整数都提供了四组方法：

| 方法 | 溢出时的行为 | 返回类型 |
| --- | --- | --- |
| `checked_add` | 返回 `None` | `Option<T>` |
| `wrapping_add` | 回绕 | `T` |
| `saturating_add` | 停在类型边界 | `T` |
| `overflowing_add` | 回绕，并报告是否发生 | `(T, bool)` |

```rust
fn main() {
    let n: u8 = 255;

    assert_eq!(n.checked_add(1), None);
    assert_eq!(n.wrapping_add(1), 0);
    assert_eq!(n.saturating_add(1), 255);
    assert_eq!(n.overflowing_add(1), (0, true));
}
```

减法和乘法同样有 `checked_sub`、`wrapping_mul` 等对应版本：

```rust
fn main() {
    let len = 0usize;

    assert_eq!(len.checked_sub(1), None);
    assert_eq!(len.saturating_sub(1), 0);
    assert_eq!(len.wrapping_sub(1), usize::MAX);
}
```

如果一整段计算都希望采用回绕语义，可以用 `Wrapping<T>`，这样每个运算符都会自动走回绕版本：

```rust
use std::num::Wrapping;

fn main() {
    let a = Wrapping(255u8);
    let b = Wrapping(1u8);
    assert_eq!(a + b, Wrapping(0));
}
```

## `as` 是另一套规则

很多人会把溢出检查和 `as` 转换混为一谈，但它们完全不同。`as` 做的是截断或符号转换，永远不 panic，也不受 `overflow-checks` 影响：

```rust
fn main() {
    let big: u16 = 300;
    let small = big as u8;
    assert_eq!(small, 44); // 300 % 256
}
```

`-1i32 as u32` 会得到 `4294967295`，同样不会报错。把外部输入转换成更小的类型时，应该用 `try_from`：

```rust
fn main() {
    let big: u16 = 300;
    let small = u8::try_from(big).expect("value out of range");
    println!("{small}");
}
```

这段代码会在运行时 panic，而不是悄悄截断成一个看似合理的小数字。

## 三个高频翻车场景

### 1. `len() - 1`

空集合上的减法是最常见的下溢来源：

```rust
fn main() {
    let v: Vec<i32> = Vec::new();

    if v.len() - 1 > 0 {
        println!("has elements");
    }
}
```

debug 下会在减法处 panic；release 下 `0usize - 1` 回绕成 `usize::MAX`，条件成立，于是打印 `has elements`。一个“有没有元素”的判断，硬是被写成了“几乎肯定有元素”。

更直接的写法是 `if !v.is_empty()`，取最后一个元素则用 `v.last()`。

### 2. 尺寸乘法

图片、缓冲区、矩阵这类代码经常出现连续乘法：

```rust
fn buffer_size(width: u32, height: u32) -> usize {
    (width * height * 4) as usize
}
```

宽高来自用户输入时，`width * height` 在 release 下可能回绕，算出一个很小的缓冲区长度。安全代码通常会在后续索引时 panic，但逻辑已经错了；如果后面接着 `unsafe` 或 FFI，就可能升级成内存安全问题。

改成显式检查：

```rust
fn buffer_size(width: u32, height: u32) -> Option<usize> {
    width
        .checked_mul(height)?
        .checked_mul(4)
        .map(|n| n as usize)
}
```

调用方拿到 `None` 时返回一个明确的错误，比在 release 下分配一块过小的内存要好得多。

### 3. 计数器和取负

“访问量加一”看起来人畜无害，但如果初值来自外部文件，恰好接近 `u32::MAX`，自增就会在 debug 下 panic、在 release 下归零。想表达“封顶”就用 `saturating_add`，想表达“必须检查”就用 `checked_add`。

取负也属于同一套检查：

```rust
fn main() {
    let x = i32::MIN;
    println!("{}", x.abs());
}
```

debug 下 panic，release 下仍然打印 `-2147483648`。`-x` 和 `i32::MIN / -1` 也有类似的边界，写数值代码时值得单独测一遍。

另外，跨平台代码要留意 `u64 as usize` 在 32 位目标上的截断。需要转换时用 `usize::try_from`，不要假设目标平台一定是 64 位。

## 让 release 也检查

如果项目对数值正确性比较敏感，可以直接在 release 上打开检查：

```toml
[profile.release]
overflow-checks = true
```

也可以临时通过编译参数开启：

```bash
RUSTFLAGS="-C overflow-checks=on" cargo build --release
```

代价是每次算术多一次检查，通常可以接受；真正热的循环可以局部改用 `wrapping_*`，把“这里允许回绕”写在代码里。

CI 里最好两种构建都跑：

```bash
cargo test
cargo test --release
```

debug 测试擅长抓溢出，release 测试擅长暴露优化后才出现的问题。只跑其中一种，总会漏掉另一类。

## 最后

整数溢出本身不复杂，麻烦的是它的行为跟着构建配置走。写代码时把意图写出来：可能失败用 `checked_*`，明确要回绕用 `wrapping_*`，需要封顶用 `saturating_*`。这样无论 debug 还是 release，程序的行为都由你决定，而不是由 Cargo 的默认 profile 决定。
