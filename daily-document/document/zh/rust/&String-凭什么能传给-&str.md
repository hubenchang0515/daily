> 原文链接：[&String 凭什么能传给 &str - 码日新 · 每日文章](https://daily.xplanc.org/zh/rust/&String-凭什么能传给-&str.md)

---

# &String 凭什么能传给 &str

写过一段时间 Rust 的人，大概都遇到过这种“不公平”：函数签名要 `&str`，你传进去一个 `&String`，编译通过；反过来把 `&str` 传给要 `&String` 的函数，编译器立刻翻脸。这不是编译器在放水，也不是 Rust 偷偷做了隐式继承，而是一套边界清晰的类型规则——Deref 强制转换（deref coercion）。理解它，很多“明明类型不一样却编译过了”的疑惑都会消失，你也能少写不少多余的 `.as_str()`。

## 先看两个方向

```rust
fn print_name(name: &str) {
    println!("name = {name}");
}

fn print_owned_name(name: &String) {
    println!("name = {name}");
}

fn main() {
    let owned = String::from("rust");

    print_name(&owned); // 通过：&String -> &str

    // print_owned_name("rust"); // 编译失败
}
```

字符串字面量 `"rust"` 的类型是 `&'static str`。编译器不会为了匹配 `&String`，偷偷在堆上分配一个 `String`——那意味着隐藏的内存分配，违背了 Rust “没有付出就没有代价”的直觉。所以这条转换是单向的：`&String` 可以变成 `&str`，反过来不行。

## 幕后推手是 Deref

`String` 实现了 `std::ops::Deref`，它的关联类型 `Target` 是 `str`：

```rust
use std::ops::Deref;

// 标准库的大致形状（大幅简化；你不能在自己的 crate 里重复实现）
impl Deref for String {
    type Target = str;

    fn deref(&self) -> &str {
        self.as_str()
    }
}
```

当编译器在需要 `&str` 的位置看到 `&String`，并且发现 `String: Deref<Target = str>`，就会在编译期插入一次解引用，效果相当于你手写了：

```rust
print_name(owned.deref());
```

这一步没有分配、没有拷贝，只是把 `String` 内部那块 UTF-8 缓冲区的引用取出来，交给一个更“瘦”的接口。你交出去的是一个借用，原来的 `String` 仍然是数据的主人。

## 它不只发生在函数参数上

Deref 强制转换只会在“有明确期望类型”的地方触发，常见的几处是：

- 函数调用的参数；
- 带类型注解的 `let` 绑定；
- 函数返回值；
- 构造结构体/枚举时，字段有明确类型。

```rust
struct User {
    name: String,
}

impl User {
    // &self.name 是 &String，返回类型是 &str，这里发生 coercion
    fn name(&self) -> &str {
        &self.name
    }
}

fn main() {
    let owned = String::from("hi");

    let s: &str = &owned;          // 带注解的 let
    let u = User { name: owned };
    let _name: &str = u.name();    // 返回值
}
```

它还能连着转。因为引用类型本身也实现了 `Deref`，所以 `&&String` 也能一路变成 `&str`：

```rust
let owned = String::from("hi");
let double_ref = &&owned;
print_name(double_ref); // &&String -> &String -> &str
```

## 借走的还是原来那块内存

Deref 强制转换不会延长生命周期，它只是把借用换了一种类型来看。

```rust
fn main() {
    let owned = String::from("hello");
    let view: &str = &owned; // 指向 owned 的内部缓冲区

    println!("{view}");
    // owned 在这里才离开作用域，view 用得没问题
}
```

如果 `view` 想活过 `owned`，编译器一样会拒绝。理解这一点很重要：你并没有“得到一个 new &str”，只是拿到了同一块数据的另一种视角。

这套机制也不是字符串的专利。`Vec<T>` 实现 `Deref<Target = [T]>`，所以：

```rust
fn total(xs: &[i32]) -> i32 {
    xs.iter().sum()
}

let v = vec![1, 2, 3];
println!("{}", total(&v)); // &Vec<i32> -> &[i32]
```

`Box<T>`、`Rc<T>` 这些智能指针能当内部类型用，靠的也是同一条规则。

## 方法调用里的自动解引用是另一回事

```rust
let s = String::from("hello");
println!("{}", s.contains("ell")); // String 没有 contains，str 有
```

这里没有“期望类型”，编译器会沿着 `String -> str` 逐级解引用去找方法，最终调用 `str::contains`。这叫 autoderef，和参数位置的 coercion 是两个不同机制，但底层都依赖 `Deref`。

## 自己实现 Deref 的三个坑

**坑一：方法先从自身开始找。**

```rust
struct Wrapper(String);

impl Wrapper {
    // 同名方法会遮住 deref 目标上的方法
    fn contains(&self, _needle: &str) -> bool {
        false
    }
}

let w = Wrapper(String::from("hello"));
println!("{}", w.contains("ell")); // false，不是 str::contains 的结果
```

如果你希望自定义类型“像 `str` 一样用”，这种同名方法会悄悄改变语义，排查起来很费时间。

**坑二：别拿 Deref 模拟继承。** Rust 没有继承，Deref 表达的是“这是一个智能指针”。给 `struct MyVec(Vec<i32>)` 实现 `Deref<Target = Vec<i32>>`，可以让 `&MyVec` 传给要 `&Vec<i32>` 的函数，但它不会让你免费获得 `AsRef<[i32]>`、`Borrow<[i32]>` 等 trait。很多泛型 API 要的是这些 trait，而不是 Deref。

**坑三：可变引用需要 DerefMut。**

```rust
use std::ops::{Deref, DerefMut};

struct Smart<T>(T);

impl<T> Deref for Smart<T> {
    type Target = T;
    fn deref(&self) -> &T { &self.0 }
}

impl<T> DerefMut for Smart<T> {
    fn deref_mut(&mut self) -> &mut T { &mut self.0 }
}

fn clear(s: &mut String) { s.clear(); }

let mut s = Smart(String::from("x"));
clear(&mut s); // &mut Smart<String> -> &mut String，需要 DerefMut
```

只实现 `Deref` 的话，这行会编译失败。

## 什么时候该换成 AsRef<str>

如果你的函数本意就是“接受任何能当字符串看的东西”，`impl AsRef<str>` 通常比依赖 deref 更对味：

| 参数写法 | 能接收什么 | 代价 |
| --- | --- | --- |
| `&str` | `&str`、`&String`、能 deref 到 `str` 的引用 | 最简单，但不能接收 `String` 所有权 |
| `impl AsRef<str>` | `String`、`&str`、`&String`、`Cow<str>` 等 | 泛型单态化，可能增加代码体积 |

```rust
fn str_len(s: impl AsRef<str>) -> usize {
    s.as_ref().len()
}

str_len(String::from("abc")); // 直接传所有权
str_len("abc");              // &str 也行
```

换成 `fn str_len(s: &str)`，第一句就得改成 `str_len(&owned)`，还得操心临时值的生命周期。

几条可以带走的判断规则：`&T -> &U` 只发生在 `T: Deref<Target = U>` 时，且方向不可逆；它出现在函数参数、带注解的 `let`、返回值和构造字段这些“期望类型明确”的位置；方法调用会自动逐级解引用，那是 autoderef，不是 coercion；需要 `&mut U` 时要求 `DerefMut`；想接受一整类“可借用为字符串”的类型，用 `AsRef<str>` 比堆 deref 更合适。下次看到编译器“居然让我过了”，先想想是不是 Deref 在背后替你写了那一行 `.deref()`，再反过来试一次，边界通常就清楚了。

## 相关文章

- [Rust 错误处理实战：? 运算符到底替你做成了什么](https://daily.xplanc.org/zh/rust/Rust-错误处理实战：-运算符到底替你做成了什么.md)
- [Rust 的整数溢出：debug 会崩，release 为什么不会](https://daily.xplanc.org/zh/rust/Rust-的整数溢出：debug-会崩，release-为什么不会.md)
- [Rust 智能指针实战：Rc、RefCell 与循环引用](https://daily.xplanc.org/zh/rust/Rust-智能指针实战：Rc、RefCell-与循环引用.md)
- [Rust 的 Drop 顺序：谁先走，谁后走](https://daily.xplanc.org/zh/rust/Rust-的-Drop-顺序：谁先走，谁后走.md)

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
