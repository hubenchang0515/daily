# C++ 移动语义实战：std::move 之后，对象为什么还有值

先看一段很多人第一次写移动语义时都会遇到的代码：

```cpp
#include <iostream>
#include <string>
#include <utility>

int main() {
    std::string a = "hello, this is a fairly long string";
    std::string b = std::move(a);

    std::cout << "b = " << b << '\n';
    std::cout << "a = [" << a << "] size=" << a.size() << '\n';
}
```

在 libstdc++ 下，输出通常是：

```text
b = hello, this is a fairly long string
a = [] size=0
```

`a` 并没有“消失”，它仍然是一个合法的 `std::string`，只是内容被搬走了。这里的关键在于：`std::move` 本身不移动任何东西。它不是“移动函数”，而是一次类型转换。

## 一、std::move 只是一次强制转换

标准库里的 `std::move` 大致等价于：

```cpp
template <typename T>
constexpr std::remove_reference_t<T>&& move(T&& t) noexcept {
    return static_cast<std::remove_reference_t<T>&&>(t);
}
```

它把传入的表达式无条件转换成右值引用（更准确地说，是 xvalue）。真正搬运资源的是**移动构造函数**或**移动赋值运算符**：

```cpp
std::string b = std::move(a);
// 等价于：std::string b = static_cast<std::string&&>(a);
// 然后调用 std::string 的移动构造函数
```

如果目标类型没有移动构造，重载决议就会退回到拷贝构造。此时 `std::move` 不会报错，只是白写了一次转换。这也是“我明明写了 `std::move`，为什么还是在拷贝”的根源。

## 二、被移动后的对象：有效但未指定

C++ 标准对标准库类型被移动后的状态用词是 **valid but unspecified state**（有效但未指定）。它保证：

- 对象可以正常析构；
- 可以重新赋值；
- 可以调用不依赖具体值的成员函数，比如 `clear()`、`size()`（结果未指定）。

它**不保证**对象为空。不同实现、不同版本可能不同：

| 类型 | 被移动后 |
| --- | --- |
| `std::unique_ptr` | 保证为 `nullptr` |
| `std::vector` / `std::string` | 通常为空，但标准不保证 |
| `int` 等内置类型 | 值不变（“移动”就是拷贝） |
| 自己写的类型 | 取决于你的移动构造函数 |

所以下面这种写法是危险的：

```cpp
std::string s = "data";
std::string t = std::move(s);
if (s.empty()) {          // 不能依赖这个判断
    // ...
}
```

正确做法是：移动之后立刻重新赋值，或者干脆不再使用它。不要写“移动后检查是否为空”的逻辑。

## 三、四种“移动没生效”的常见原因

### 1. const 对象无法被移动

```cpp
const std::string s = "hello world, a long enough string";
std::string t = std::move(s);   // 调用的是拷贝构造
```

`std::move(s)` 得到的是 `const std::string&&`，而移动构造的参数是 `std::string&&`，无法绑定，只能匹配 `const std::string&` 的拷贝构造。这就是为什么移动语义通常要求对象是非 const 的。

### 2. 移动构造没有 noexcept，vector 会改用拷贝

`std::vector` 扩容时，为了保证强异常安全，使用的是 `std::move_if_noexcept`：

- 如果移动构造是 `noexcept`，搬移旧元素；
- 如果不是 `noexcept` 且类型可拷贝，则**拷贝**旧元素。

```cpp
#include <cstdio>
#include <utility>
#include <vector>

struct Tracer {
    Tracer() = default;
    Tracer(const Tracer&)            { std::puts("copy"); }
    Tracer(Tracer&&) /* 没有 noexcept */ { std::puts("move"); }
};

int main() {
    std::vector<Tracer> v;
    v.reserve(1);
    v.push_back(Tracer{});   // 第一次，不扩容
    v.push_back(Tracer{});   // 扩容，输出 copy
}
```

把移动构造改成 `Tracer(Tracer&&) noexcept { ... }`，输出才会变成 `move`。

也就是说，一个漏写的 `noexcept`，会让你的容器在扩容时悄悄退化成深拷贝。建议用 `static_assert` 把这条约束固定下来：

```cpp
static_assert(std::is_nothrow_move_constructible_v<Tracer>);
```

补充一点：如果类型删除了拷贝构造，即使移动构造不是 `noexcept`，也只能移动，因为没有别的选择。

### 3. 写了析构函数，移动操作悄悄消失

这是实际项目里最常见的一类 bug：

```cpp
#include <unistd.h>

class File {
public:
    explicit File(int fd) : fd_(fd) {}
    ~File() { if (fd_ >= 0) ::close(fd_); }

private:
    int fd_;
};

File a(open("/tmp/x", 0));
File b = std::move(a);   // 编译通过，但调用的是拷贝构造
```

因为用户声明了析构函数，编译器**不会**再隐式生成移动构造函数和移动赋值运算符。此时 `File b = std::move(a)` 会调用隐式生成的拷贝构造，两个对象持有同一个 `fd_`，析构时发生 double close。

修复方式是显式补上移动操作，并删除拷贝：

```cpp
class File {
public:
    explicit File(int fd) : fd_(fd) {}
    ~File() { if (fd_ >= 0) ::close(fd_); }

    File(const File&) = delete;
    File& operator=(const File&) = delete;
    File(File&& other) noexcept : fd_(other.fd_) { other.fd_ = -1; }
    File& operator=(File&& other) noexcept {
        if (this != &other) {
            if (fd_ >= 0) ::close(fd_);
            fd_ = other.fd_;
            other.fd_ = -1;
        }
        return *this;
    }

private:
    int fd_;
};
```

如果不写移动操作、也不删除拷贝，编译器不会报错，只会静默地拷贝，这类问题很难在代码评审中发现。

### 4. 移动构造里忘了 std::move 成员

```cpp
class Buffer {
public:
    Buffer(Buffer&& other)
        : data_(other.data_),    // 错：other.data_ 是左值，这里在拷贝
          size_(other.size_) {}

private:
    std::string data_;
    std::size_t size_ = 0;
};
```

在移动构造体内，`other` 虽然是右值引用，但 `other.data_` 这个表达式本身是左值。要搬运成员，必须显式写 `std::move(other.data_)`。如果成员是 `std::unique_ptr` 这类不可拷贝类型，编译器还会直接报错，算是帮你挡了一次。

## 四、return std::move(x) 往往是反优化

很多人以为返回局部变量时加 `std::move` 更快，实际上恰恰相反：

```cpp
std::string make() {
    std::string s = "a fairly long string";
    return std::move(s);   // 阻断 NRVO，至少多一次移动
}
```

`return s;` 可以触发 NRVO（具名返回值优化），直接在调用方的存储位置上构造 `s`，一次构造都不多。C++20 起，返回局部变量或参数时还会自动做隐式移动。而 `return std::move(s)` 把返回值变成右值表达式，编译器不能再省略，只能先构造再移动。

例外是返回**成员变量**：成员不是局部变量，不享受隐式移动，通常仍需要显式 `std::move(member_)`。

## 五、移动赋值要处理旧资源和自赋值

移动赋值和移动构造不同，它需要先释放目标对象原本持有的资源：

```cpp
Buffer& operator=(Buffer&& other) noexcept {
    if (this != &other) {
        delete[] data_;          // 先释放自己的
        data_ = other.data_;
        size_ = other.size_;
        other.data_ = nullptr;   // 让源对象处于可析构状态
        other.size_ = 0;
    }
    return *this;
}
```

`a = std::move(a)` 这种自移动在标准库类型上是“有效但未指定”，对自己写的类型如果不加判断，可能先释放资源再把野指针赋回自己。另一种更省事的写法是 copy-and-swap，或者直接交换成员。

## 六、一份检查清单

| 检查项 | 说明 |
| --- | --- |
| 移动构造/赋值是否 `noexcept` | 否则 `vector` 扩容会改用拷贝 |
| 是否遵守五法则 | 写了析构、拷贝之一，就要考虑补齐移动 |
| 移动构造里成员是否 `std::move` | 否则成员仍是拷贝 |
| 是否写了 `return std::move(x)` | 返回局部变量时应删掉 |
| 被移动对象是否还被使用 | 只能赋新值或不再使用 |
| 能用 `= default` 就别手写 | 默认版本通常正确且是 `noexcept` |

## 小结

`std::move` 只是把左值转成右值引用，真正干活的是移动构造和移动赋值。理解了这一点，就能解释大部分“移动失效”的现象：`const` 挡掉了移动，缺少 `noexcept` 让容器退回拷贝，析构函数让移动操作不再生成，构造函数里漏写 `std::move` 让成员继续拷贝。

写移动语义时，优先遵循 rule of zero：让成员自己管理资源，编译器生成的移动操作往往就是对的。只有在必须手写资源管理时，才需要把移动构造、移动赋值、析构和 `noexcept` 一起考虑清楚。

---

> 原文链接：[C++ 移动语义实战：std::move 之后，对象为什么还有值](https://daily.xplanc.org/cpp/C%2B%2B-%E7%A7%BB%E5%8A%A8%E8%AF%AD%E4%B9%89%E5%AE%9E%E6%88%98%EF%BC%9Astd-move-%E4%B9%8B%E5%90%8E%EF%BC%8C%E5%AF%B9%E8%B1%A1%E4%B8%BA%E4%BB%80%E4%B9%88%E8%BF%98%E6%9C%89%E5%80%BC.md)
