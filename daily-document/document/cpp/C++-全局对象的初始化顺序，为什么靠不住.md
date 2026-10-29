# C++ 全局对象的初始化顺序，为什么靠不住

先说结论：在 C++ 里，两个不同编译单元中的全局对象，谁先构造、谁后构造，标准没有规定。你的代码只要依赖了这个顺序，就等于把正确性交给链接器的心情。

这类问题有个名字，叫 static initialization order fiasco。它讨厌的地方在于：代码能编译、能链接，在开发机上跑一百次都正常，换个链接顺序或者加一个源文件，上线当天才崩。

## 一个能稳定复现的例子

假设我们有一个全局配置对象。

```cpp
// config.h
#pragma once
#include <map>
#include <string>

class Config {
public:
    Config();
    ~Config();
    void set(const std::string& key, const std::string& value);
    std::string get(const std::string& key) const;

private:
    std::map<std::string, std::string>* data_;
};

extern Config g_config;
```

```cpp
// config.cpp
#include "config.h"

Config::Config() : data_(new std::map<std::string, std::string>) {}
Config::~Config() { delete data_; }

void Config::set(const std::string& k, const std::string& v) { (*data_)[k] = v; }

std::string Config::get(const std::string& k) const {
    auto it = data_->find(k);
    return it == data_->end() ? std::string() : it->second;
}

Config g_config;   // 动态初始化：要调用构造函数
```

再写一个在 `main` 之前就要用配置的对象：

```cpp
// main.cpp
#include "config.h"
#include <iostream>

struct Banner {
    Banner() { g_config.set("banner", "hello"); }
};

Banner g_banner;   // 同样在 main 之前构造

int main() {
    std::cout << g_config.get("banner") << "\n";
}
```

编译运行：

```bash
g++ -std=c++17 main.cpp config.cpp -o demo && ./demo
```

在常见的链接顺序下（`main.o` 排在前面），`g_banner` 会先构造，此时 `g_config` 的构造函数还没跑。你可能会想：那 `data_` 是野指针吧？不是，它是 `nullptr`。

原因是静态存储期对象在任何动态初始化之前都会被**零初始化**。`Config` 的成员 `data_` 先变成 0，然后才轮到构造函数赋值。所以 `g_banner` 里的 `set()` 实际执行的是 `(*nullptr)[k] = v`，直接段错误。

## 标准到底保证了什么

把规则拆开看，只有三条是明确的：

- 同一个编译单元内，全局对象按**定义出现的顺序**初始化。
- 不同编译单元之间，顺序**未指定**。实务中通常就是目标文件在链接命令行里的先后顺序。
- 静态存储期对象先零初始化，再常量初始化，最后才做动态初始化。

于是有两类“看起来没事”的错觉：

1. **POD 全局变量**（比如 `int g_count;`）零初始化后就是 0，被提前读到也不会崩，只是拿到错误的值。这类 bug 比崩溃更难查。
2. **容器成员**零初始化后，`std::vector` 的 `begin/end/capacity` 全是空指针，看起来就像一个空 vector。此时 `push_back` 说不定还能碰巧工作——因为空 vector 本来就该分配内存。等到某天换成 `std::string` 的 `c_str()`，才突然炸给你看。

顺带一提，标准库自己也踩过这个坑。`<iostream>` 里藏着一个 `std::ios_base::Init` 类型的静态对象，每个包含该头文件的编译单元都会有一个，用来保证标准流在被使用前完成初始化。这是标准库给出的“土办法”，很能说明问题有多普遍。

## 三种靠谱的写法

### 用函数内静态变量

最通用的一招，把全局对象藏进函数里：

```cpp
Config& config() {
    static Config instance;   // 第一次执行到这里才构造
    return instance;
}
```

C++11 起，函数内静态变量的初始化是线程安全的（编译器会插入一次性守卫），不用自己加锁。代价是每次调用多一次原子读取判断，对绝大多数场景可以忽略。

要注意的是：它只解决**构造**顺序，不解决**析构**顺序。如果另一个全局对象的析构函数里去调用 `config()`，此时 `instance` 可能已经被销毁了——这就是 deinitialization order fiasco。

### 让它变成常量初始化

如果数据能在编译期算出来，就根本不存在顺序问题：

```cpp
constexpr std::array<int, 3> kPorts{80, 443, 8080};
constinit int kMaxConnections = 128;   // C++20
```

`constinit` 的语义很直接：**必须**常量初始化，否则编译失败。它不要求 `const`，所以可以配合运行期修改使用。反过来，`constinit std::string` 是编译不过的，因为 `std::string` 的构造不是常量初始化。

另外，C++17 的 `inline` 变量可以让头文件里定义的全局变量不违反 ODR，但它只解决“重复定义”，不解决“初始化顺序”，别把这两件事混在一起：

```cpp
inline Config g_config;   // 只有一个实例，但仍然是动态初始化
```

### 显式初始化

需要严格控制顺序的场合，比如插件系统，干脆别用全局对象，改成 `main` 里显式调用：

```cpp
int main() {
    init_config();
    init_plugins();
    run();
}
```

缺点是需要调用方守规矩，优点是把顺序写在了代码里，谁都能看见。对于会 `dlopen` 的插件，这一点尤其重要：插件的全局对象是在 `dlopen` 那一刻才初始化的，远晚于主程序的全局对象，顺序依赖在这里几乎必然出问题。

## 怎么发现这类问题

编译期能抓到一部分：

```bash
clang++ -std=c++17 -Wglobal-constructors -Wexit-time-destructors main.cpp config.cpp
```

`-Wglobal-constructors` 会对每个需要动态初始化的全局对象报警，`-Wexit-time-destructors` 则针对退出时的析构。GCC 没有等价选项，只能靠代码审查或者静态分析工具。

运行期最简单的手段是在构造函数里打印地址和名字：

```cpp
Config::Config() : data_(new std::map<std::string, std::string>) {
    std::fprintf(stderr, "[init] Config %p\n", static_cast<void*>(this));
}
```

再配合 `Banner` 的构造日志，顺序一目了然。至于析构阶段访问已销毁对象的问题，`-fsanitize=address` 有时能报出 heap-use-after-free，但不要指望它百发百中。

## 选型对照

| 方案 | 适用场景 | 主要代价 |
| --- | --- | --- |
| 函数内 static | 单例、日志、配置等全局服务 | 每次访问一次原子判断 |
| `constexpr` / `constinit` | 编译期可确定的常量表 | 类型必须支持常量初始化 |
| `main` 里显式 init | 插件系统、强顺序依赖 | 依赖调用方遵守约定 |
| `init_priority` 属性 | ELF 平台上的临时补救 | 不可移植，且极易再次被打破 |

最后一项是 GCC/Clang 的扩展，用法是 `__attribute__((init_priority(101)))`，能强行调整初始化次序。它属于“知道就好、尽量别用”的范畴：一旦有人加了个新文件，优先级之间的相对关系又得重新推一遍。

写 C++ 久了会发现，很多“玄学崩溃”背后都是一条没写进文档的隐含假设。全局对象的构造顺序就是其中最经典的一条——标准没说，编译器不报，只有链接器知道答案。

---

> 原文链接：[C++ 全局对象的初始化顺序，为什么靠不住](https://daily.xplanc.org/cpp/C%2B%2B-%E5%85%A8%E5%B1%80%E5%AF%B9%E8%B1%A1%E7%9A%84%E5%88%9D%E5%A7%8B%E5%8C%96%E9%A1%BA%E5%BA%8F%EF%BC%8C%E4%B8%BA%E4%BB%80%E4%B9%88%E9%9D%A0%E4%B8%8D%E4%BD%8F.md)
