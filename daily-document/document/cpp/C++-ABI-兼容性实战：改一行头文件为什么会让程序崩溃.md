# C++ ABI 兼容性实战：改一行头文件为什么会让程序崩溃

先看一个真实场景：你维护一个基础库 `libfoo.so`，某次在类里加了一个成员变量，重新编译发布。调用方的代码一行没改，也没有重新编译，启动后却在析构 `std::string` 时崩溃。日志、单元测试、内存检查工具都正常，问题只在“新旧二进制混跑”时出现。

这类问题通常不是逻辑 bug，而是 ABI 被破坏了。本文以 Linux + GCC/Clang 为例，梳理 C++ ABI 的边界、常见破坏点和可落地的防护手段。

## 源码兼容不等于 ABI 兼容

ABI（Application Binary Interface）是二进制层面的契约，包含：

- 类型的大小、对齐和成员偏移
- 函数的符号名（name mangling）
- 参数传递方式、返回值位置
- 虚函数表布局
- 异常、RTTI、内存分配器的约定

源码兼容只要求“重新编译能过”；ABI 兼容要求“旧二进制不重编也能正确链接和运行”。两者经常被混为一谈。

| 改动 | 源码兼容 | ABI 兼容 |
| --- | --- | --- |
| 新增普通成员函数 | 是 | 通常是 |
| 在类中新增数据成员 | 是 | 否 |
| 在虚函数表中间插入虚函数 | 是 | 否 |
| 修改 inline 函数实现 | 是 | 行为不一致 |
| 修改默认参数值 | 是 | 旧调用方仍用旧值 |

## 四个高频破坏点

### 1. 改类布局

```cpp
// v1
struct Config {
    int timeout;
};

// v2
struct Config {
    int timeout;
    bool verbose;
};
```

`sizeof(Config)` 和成员偏移都变了。如果库内部按新布局写入 `verbose`，而调用方仍按旧布局分配对象，就会越界写。更隐蔽的情况是对象由库创建、调用方只持有指针，但调用方在头文件里内联访问了成员，同样会读到错误偏移。

### 2. 在虚函数表中间插入函数

Itanium ABI 下，虚表通常按声明顺序存放函数指针。把新虚函数插到中间，后面所有槽位整体后移：

```cpp
struct Base {
    virtual void a();
    virtual void b();   // 旧二进制认为 b 在槽位 1
};

struct Base {
    virtual void a();
    virtual void inserted();
    virtual void b();   // 现在 b 在槽位 2
};
```

旧调用方执行 `b()` 时，实际可能调到 `inserted()`。这类错误往往不会立刻崩溃，而是表现为“偶发调错函数”，极难定位。追加到末尾相对安全，但涉及派生类和多继承时仍不建议随意改动虚表。

### 3. inline 函数与默认参数

inline 函数的函数体通常直接编进调用方。改了实现却不重编调用方，旧二进制继续执行旧逻辑，形成 ODR 违规。默认参数也一样，它在调用点求值：

```cpp
void connect(int timeout_ms = 3000);

// 库改成 5000，旧调用方仍然传 3000
```

这类问题不会导致链接失败，只会让“配置不生效”看起来像玄学。

### 4. 在接口里暴露 STL 类型

GCC 5 之后，`std::string` 存在新旧两套 ABI。新 ABI 的符号位于 `std::__cxx11` 命名空间：

```bash
nm -D -C libfoo.so | grep basic_string
```

可能看到：

```text
std::__cxx11::basic_string<...>
```

如果一边用 `-D_GLIBCXX_USE_CXX11_ABI=1`，另一边用 `0`，就会出现未定义符号或运行时内存布局不一致。跨编译器、跨标准库版本传递 `std::string`、`std::vector` 等类型，风险同理。

## 用工具确认二进制契约

先看导出符号是否稳定：

```bash
g++ -std=c++17 -fPIC -shared foo.cpp -o libfoo.so
nm -D -C libfoo.so | grep foo_
readelf -Ws libfoo.so | c++filt | grep foo_
```

`nm -D` 只看动态符号，`-C` 用于还原可读的 C++ 名称。对比两个版本时，建议直接做 ABI 差分：

```bash
abi-dumper libfoo.so -o libfoo-1.0.abi -public-headers include/
abi-dumper libfoo-new.so -o libfoo-2.0.abi -public-headers include/
abi-compliance-checker -l foo -old libfoo-1.0.abi -new libfoo-2.0.abi
```

工具会报告类型布局、虚表、符号增减等变化。把它接进 CI，比等线上崩溃后再排查便宜得多。

## 守住边界的三种做法

### 方案一：Pimpl 隐藏实现

```cpp
// widget.h
#pragma once
#include <memory>

class Widget {
public:
    Widget();
    ~Widget();
    Widget(Widget&&) noexcept;
    Widget& operator=(Widget&&) noexcept;

    void set_timeout(int ms);
    int timeout() const;

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};
```

```cpp
// widget.cpp
#include "widget.h"

struct Widget::Impl {
    int timeout = 1000;
};

Widget::Widget() : impl_(std::make_unique<Impl>()) {}
Widget::~Widget() = default;
Widget::Widget(Widget&&) noexcept = default;
Widget& Widget::operator=(Widget&&) noexcept = default;

void Widget::set_timeout(int ms) { impl_->timeout = ms; }
int Widget::timeout() const { return impl_->timeout; }
```

头文件只暴露指针大小，新增成员只影响 `.cpp`。注意析构函数必须在 `Impl` 完整可见的地方定义，否则 `unique_ptr` 删除不完整类型会报错。

### 方案二：稳定 C 接口

跨语言、跨编译器最稳的方式仍是 C ABI：

```cpp
// foo.h
#ifdef __cplusplus
extern "C" {
#endif

typedef struct foo_handle foo_handle;

foo_handle* foo_create(void);
void foo_destroy(foo_handle* h);
int foo_set_timeout(foo_handle* h, int ms);

#ifdef __cplusplus
}
#endif
```

C++ 的类、模板、异常都收在实现里，头文件只保留不透明指针和普通函数。代价是要手动管理生命周期，但换来的是长期稳定。

### 方案三：控制符号可见性

默认导出所有符号会让内部实现变成事实上的 ABI。建议编译时加：

```bash
g++ -std=c++17 -fPIC -fvisibility=hidden -shared foo.cpp -o libfoo.so
```

再用版本脚本只放行公开接口：

```text
FOO_1.0 {
    global:
        foo_create;
        foo_destroy;
        foo_set_timeout;
    local:
        *;
};
```

```bash
g++ -std=c++17 -fPIC -fvisibility=hidden -shared foo.cpp \
    -Wl,--version-script=foo.map -o libfoo.so

objdump -T libfoo.so | grep FOO_1.0
```

这样内部符号不会污染动态符号表，升级时也更容易判断哪些符号必须保留。

## 发布前检查清单

- 公开头文件里是否出现了 STL 容器、`std::string` 或模板实现细节？
- 类的 `sizeof`、成员偏移、虚表是否发生变化？
- 是否修改了 inline 函数或默认参数，却没有要求调用方重编？
- 新增符号是否进入版本脚本，旧符号是否被误删？
- CI 是否运行了 ABI 差分，而不是只跑单元测试？

ABI 问题的麻烦之处在于：它不违反源码语义，编译器也不会报错，只有旧二进制和新库相遇时才暴露。把“二进制契约”当成和 API 一样的公开接口来管理，才能真正避免“改一行头文件，炸一片线上服务”。
