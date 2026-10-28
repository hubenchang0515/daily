# Rust 智能指针实战：Rc、RefCell 与循环引用

Rust 的所有权规则在编译期解决大部分问题：一个值只有一个所有者，借用要么多个不可变，要么一个可变。但只要写稍微复杂一点的数据结构——树、图、双向链表、观察者列表——就会撞上同一个问题：**我需要多个地方共享同一份数据，而且还要修改它。**

标准库给出的答案是 `Rc<T>` 加 `RefCell<T>`。这个组合确实能用，但它把编译期的检查搬到了运行时，代价是 panic、引用计数开销，以及一种 Rust 里罕见的 bug：内存泄漏。这篇文章从一个真实场景出发，把这几个坑逐个拆开。

## 一、先搞清楚 Rc 解决的是什么

`Box<T>` 是独占所有权，赋值即移动。如果两个父节点要共享同一个子节点，`Box` 就无能为力了。`Rc<T>`（Reference Counting）通过引用计数实现多所有者：每次 `clone` 只是把计数加一，数据本身不动。

```rust
use std::rc::Rc;

#[derive(Debug)]
struct Node {
    name: &'static str,
    children: Vec<Rc<Node>>,
}

fn main() {
    let leaf = Rc::new(Node { name: "leaf", children: vec![] });

    let a = Node { name: "a", children: vec![Rc::clone(&leaf)] };
    let b = Node { name: "b", children: vec![Rc::clone(&leaf)] };

    println!("strong = {}", Rc::strong_count(&leaf)); // 3
    println!("{:?} {:?}", a, b);
}
```

几个容易忽略的点：

- `Rc::clone(&leaf)` 而不是 `leaf.clone()`。后者也能编译，但会让人误以为发生了深拷贝。社区惯例是显式写 `Rc::clone`。
- 计数是普通整数，不是原子的，所以 `Rc<T>` 不是 `Send`/`Sync`。跨线程要用 `Arc<T>`，代价是每次 clone 一次原子操作。
- `Rc` 只提供不可变访问。想改内容，要么 `Rc::get_mut`（要求计数为 1），要么 `Rc::make_mut`（写时复制），要么就上 `RefCell`。

还有一个小陷阱：**递归 drop 会爆栈**。如果用一个很长的 `Rc` 链表，最后一个引用释放时会递归调用析构，几万个节点就足以让栈溢出。解决办法是实现 `Drop` 手动迭代拆链，或者干脆改用 `Vec` + 索引。

## 二、RefCell：把借用检查推迟到运行时

`RefCell<T>` 内部维护一个借用标志：可以同时存在多个 `borrow()`，或者一个 `borrow_mut()`，二者不能共存。违反规则不会编译报错，而是直接 panic。

```rust
use std::cell::RefCell;

fn main() {
    let v = RefCell::new(vec![1, 2, 3]);

    let first = v.borrow()[0];
    v.borrow_mut().push(4);       // 这里没问题，first 是 Copy 出来的
    println!("{} {:?}", first, v.borrow());
}
```

上面这段是安全的。下面这段就会炸：

```rust
let v = RefCell::new(vec![1, 2, 3]);

for x in v.borrow().iter() {
    v.borrow_mut().push(*x);      // panic: already borrowed: BorrowMutError
}
```

原因是 `v.borrow()` 返回的 `Ref` 守卫活在整个 `for` 循环里，循环体里再申请可变借用就冲突了。修复方式有三种，按推荐程度排序：

```rust
// 1. 先收集，再修改（最清晰）
let snapshot: Vec<i32> = v.borrow().clone();
for x in snapshot {
    v.borrow_mut().push(x);
}

// 2. 用完立刻释放守卫
let len = v.borrow().len();
for i in 0..len {
    let x = v.borrow()[i];
    v.borrow_mut().push(x);
}

// 3. 只是简单计数，用 Cell 就够了
use std::cell::Cell;
let hits = Cell::new(0);
hits.set(hits.get() + 1);
```

如果不想 panic，可以用 `try_borrow()` / `try_borrow_mut()`，它们返回 `Result`。但在业务代码里，借用冲突通常意味着设计有问题，捕获错误往往只是把问题往后推。

另一个高频场景是**方法内部重复借用**：

```rust
struct Counter {
    hits: RefCell<u32>,
}

impl Counter {
    fn hit(&self) {
        *self.hits.borrow_mut() += 1;
    }

    fn hits(&self) -> u32 {
        *self.hits.borrow()
    }

    // 错误：borrow_mut 的守卫没释放就调用了 hits()
    fn hit_twice_bad(&self) {
        let mut n = self.hits.borrow_mut();
        *n += 1;
        println!("{}", self.hits()); // panic
    }

    // 正确：显式结束作用域
    fn hit_twice(&self) {
        {
            let mut n = self.hits.borrow_mut();
            *n += 1;
        }
        println!("{}", self.hits());
    }
}
```

排查这类 panic 时，`RUST_BACKTRACE=1` 很有用，但更重要的是看 panic 信息里的 `already borrowed` / `already mutably borrowed`，它直接告诉你是哪一侧的借用没释放。

## 三、循环引用：Rust 也会内存泄漏

这是 `Rc` 最隐蔽的问题。Rust 保证内存安全，但不保证不泄漏——泄漏是安全的，只是资源不回收。

典型结构是父子互相持有：父节点用 `Rc` 存子节点，子节点再用 `Rc` 指回父节点。这样父的计数永远至少为 1（被子持有），子的计数也永远至少为 1（被父持有），两个都 drop 不掉。

```rust
use std::cell::RefCell;
use std::rc::{Rc, Weak};

struct Node {
    name: &'static str,
    parent: RefCell<Weak<Node>>,
    children: RefCell<Vec<Rc<Node>>>,
}

impl Drop for Node {
    fn drop(&mut self) {
        println!("drop {}", self.name);
    }
}

fn main() {
    let parent = Rc::new(Node {
        name: "parent",
        parent: RefCell::new(Weak::new()),
        children: RefCell::new(vec![]),
    });

    let child = Rc::new(Node {
        name: "child",
        parent: RefCell::new(Rc::downgrade(&parent)),
        children: RefCell::new(vec![]),
    });

    parent.children.borrow_mut().push(Rc::clone(&child));

    println!("parent strong = {}", Rc::strong_count(&parent)); // 1
    println!("parent weak   = {}", Rc::weak_count(&parent));   // 1
    println!("child  strong = {}", Rc::strong_count(&child));  // 2

    if let Some(p) = child.parent.borrow().upgrade() {
        println!("child's parent = {}", p.name);
    }
}
```

关键在于 **`Weak<T>` 不增加强引用计数**。`Rc::downgrade` 得到弱引用，`upgrade()` 返回 `Option<Rc<T>>`：对象还活着就拿到 `Some`，已经被释放就是 `None`。上例中 `parent` 离开作用域后计数归零，`Drop` 正常执行，随后 `children` 里的 `child` 也被释放，两个 `drop` 都会打印出来。

如果把 `parent: RefCell<Weak<Node>>` 换成 `RefCell<Rc<Node>>`，程序不会崩，也不报错，但两个 `drop` 一个都不会打印——这就是泄漏。

实践中的判断标准很简单：**方向性关系用 `Rc`，反向回指用 `Weak`**。树结构里父持有子是 `Rc`，子回指父是 `Weak`；观察者模式里被观察者持有观察者是 `Rc`，观察者回指被观察者用 `Weak`，顺手还能避免悬垂回调。

## 四、选型速查

| 类型 | 共享所有权 | 可变性 | 线程安全 | 检查时机 |
| --- | --- | --- | --- | --- |
| `Box<T>` | 否 | 需要 `&mut` | 取决于 `T` | 编译期 |
| `Rc<T>` | 是 | 否 | 否 | 编译期 |
| `Arc<T>` | 是 | 否 | 是 | 编译期 |
| `Cell<T>` | 否 | 是（`Copy` 类型） | 否 | 无 |
| `RefCell<T>` | 否 | 是 | 否 | 运行时 |
| `Rc<RefCell<T>>` | 是 | 是 | 否 | 运行时 |
| `Arc<Mutex<T>>` | 是 | 是 | 是 | 运行时（锁） |

## 五、几条能省下调试时间的建议

1. **先问能不能不用共享**。很多 `Rc<RefCell<T>>` 的需求，其实用 `Vec<Node>` 加 `usize` 索引（arena 模式）更简单：没有计数、没有借用 panic、没有循环引用，序列化也方便。
2. **缩小借用作用域**。`RefCell` 的 panic 九成来自守卫活得比预期久，尤其是 `if let`、`match`、`for` 和链式调用里。
3. **不要长期持有 `Ref` / `RefMut`**。它们是守卫，不是引用；跨函数传递守卫几乎一定会出问题。
4. **注意 `Rc` 不是 `Send`**。想把 `Rc<RefCell<T>>` 丢进 `thread::spawn`，编译器会直接拒绝，这不是 bug 而是保护。
5. **怀疑泄漏时数计数**。在关键位置打印 `Rc::strong_count` 和 `Rc::weak_count`，比读代码快得多；也可以用 `Rc::try_unwrap` 验证是否还存在其他持有者。

`Rc` 和 `RefCell` 不是「高级用法」，而是所有权模型在共享场景下的必要补充。理解它们的代价——运行时检查、非原子计数、可能的循环引用——比记住 API 更重要。真正写起来，大多数时候更值得做的是回头看看数据结构能不能改成独占加索引，那才是 Rust 最舒服的姿势。

---

> 原文链接：[Rust 智能指针实战：Rc、RefCell 与循环引用](https://daily.xplanc.org/rust/Rust-%E6%99%BA%E8%83%BD%E6%8C%87%E9%92%88%E5%AE%9E%E6%88%98%EF%BC%9ARc%E3%80%81RefCell-%E4%B8%8E%E5%BE%AA%E7%8E%AF%E5%BC%95%E7%94%A8.md)
