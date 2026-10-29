# C++ string_view 实战：不拷贝，也不保证活着

`std::string_view` 是 C++17 里最受欢迎的新特性之一：它只是一个“指向字符序列的指针 + 长度”，拷贝它不分配内存，传参不产生 `std::string` 临时对象。但很多人把它当成“轻量版 std::string”来用，于是写出了一批看似正常、实则读取已释放内存的代码。

这篇文章不讲 API 列表，只讲四个真实项目里高频出现的坑，以及一条能落地的使用规则。

## 一、先看一个“能编译、能跑、结果随机”的例子

```cpp
#include <iostream>
#include <string>
#include <string_view>

std::string build_name() {
    return "a-name-long-enough-to-bypass-sso";
}

int main() {
    std::string_view name = build_name();
    std::cout << name << '\n';   // 未定义行为
}
```

用 `g++ -std=c++17 -fsanitize=address -g demo.cpp -o demo` 编译运行：

```
ERROR: AddressSanitizer: heap-use-after-free
```

原因很简单：`build_name()` 返回一个临时的 `std::string`，它通过隐式转换变成 `std::string_view`。临时对象在**整条声明语句结束时**就被销毁了，而 `name` 里的指针仍然指向那块已经归还的内存。

注意这里有个容易误判的点：`std::string_view name = build_name();` 看起来像“把返回值存下来了”，实际上只存下了地址和长度，数据的生命周期完全没有被延长。

正确的写法只有两种：要么让 `view` 指向一个确定活得够久的东西，要么干脆持有 `std::string`。

```cpp
std::string name = build_name();          // 自己拥有数据
std::string_view view = name;             // view 在 name 存活期内有效
```

## 二、`string_view` 到底存了什么

在 64 位 Linux 上，`sizeof(std::string_view)` 通常是 16 字节，等于一个指针加一个 `size_t`：

| 成员 | 含义 |
| --- | --- |
| `data()` | 指向字符序列起始位置，不保证以 `'\0'` 结尾 |
| `size()` | 字符数量，可以包含 `'\0'` |
| `substr()` | 返回新的 view，仍然指向原缓冲区 |
| `remove_prefix/suffix` | 只调整指针和长度，不修改数据 |

它**不拥有**任何字符，也没有容量、没有分配器、没有写操作。所以“view 有效”这件事，完全取决于背后的缓冲区是否还活着、是否被修改过。

## 三、四个高频坑

### 坑 1：把 view 存进成员变量

```cpp
struct Url {
    std::string_view host;
};

Url parse(const std::string& raw) {
    auto pos = raw.find("://");
    return Url{ std::string_view(raw).substr(pos + 3) };
}

int main() {
    Url u = parse(std::string("https://example.com/a"));
    std::cout << u.host << '\n';   // 悬垂
}
```

`parse` 的参数是 `const std::string&`，本身没问题；问题出在调用处传了一个临时 `std::string`。临时对象在分号处销毁，`u.host` 立刻变成野指针。

这种结构在“解析配置、解析 HTTP 请求”里非常常见。要么让 `Url` 持有 `std::string`，要么在文档里明确写清楚：`Url` 的有效期不得超过传入的原始字符串。

### 坑 2：以为 `substr` 会拷贝

```cpp
std::string_view line = "GET /index.html HTTP/1.1";
std::string_view path = line.substr(4, 11);
std::cout << path << '\n';   // /index.html
```

`substr` 返回的是视图，不是新字符串。如果 `line` 来自一个局部 `std::string`，那么 `path` 的生命周期和 `line` 完全绑定。需要独立持有内容时，必须显式构造：

```cpp
std::string owned(path);          // 真正拷贝一份
```

顺带一提：`std::string_view` 做参数类型时非常划算，因为它避免了为只读场景分配内存；但把它当返回值返回，通常意味着“我在返回一个我管不了生死的指针”。

### 坑 3：把 `data()` 当 C 字符串用

```cpp
char buf[4] = {'a', 'b', 'c', 'd'};
std::string_view sv(buf, 4);
std::printf("%s\n", sv.data());   // 越界读：buf 里没有 '\0'
```

`string_view` 的长度是显式记录的，所以它完全可以表示“没有结尾符”的片段。所有要求 `const char*` 的接口（`printf`、`fopen`、POSIX 系统调用、部分第三方库）都不能直接吃 `sv.data()`。

需要时先转换，并且保证转换出来的对象活到调用结束：

```cpp
std::string tmp(sv);
std::printf("%s\n", tmp.c_str());          // 安全

const char* p = std::string(sv).c_str();   // 危险：临时对象已销毁
```

这里有个细节值得记住：`std::printf("%s\n", std::string(sv).c_str());` 这一行其实是安全的，因为临时 `std::string` 会活到整条完整表达式结束，也就是 `printf` 返回之后。危险的是把 `c_str()` 的结果单独存进一个指针。

另外，默认构造的 `string_view` 的 `data()` 可能是 `nullptr`，直接交给 `%s` 同样是未定义行为。

### 坑 4：忘了源字符串会被修改

```cpp
std::string s = "hello";
std::string_view sv = s;

s += " world, this string is now long enough to reallocate";
std::cout << sv << '\n';   // 悬垂
```

任何可能导致 `std::string` 重新分配或移动的操作（`append`、`insert`、`reserve` 之后的扩容、赋值、`shrink_to_fit`）都会让已有的 view 失效。短字符串还有 SSO 的问题：对象一移动，缓冲区跟着搬走，原来的地址同样失效。

规则很朴素：**view 的有效期不能跨越源缓冲区的任何修改。**

## 四、那什么时候该用

`string_view` 最适合三类场景，共同点是“数据的所有者明确存在，且活得比 view 久”。

**1. 只读参数**

```cpp
void log_message(std::string_view msg);
```

调用方传 `std::string`、字符串字面量、`char*` 都不会产生拷贝。函数内部只要不把 `msg` 存起来，就是安全的。

**2. 解析已有缓冲区**

```cpp
std::vector<std::string_view> split(std::string_view s, char sep) {
    std::vector<std::string_view> out;
    std::size_t start = 0;
    while (true) {
        auto pos = s.find(sep, start);
        if (pos == std::string_view::npos) {
            out.push_back(s.substr(start));
            break;
        }
        out.push_back(s.substr(start, pos - start));
        start = pos + 1;
    }
    return out;
}
```

这个函数不分配任何字符串内存，但返回的每个元素都指向 `s`。调用方必须保证 `s` 在结果使用期间一直有效，这一点最好写进注释。

**3. 哈希表查找，避免构造临时 key**

```cpp
std::map<std::string, int, std::less<>> dict{{"apple", 1}};
auto it = dict.find(std::string_view("apple"));   // 不构造 std::string
```

`std::less<>` 是透明比较器，配合 `std::string` 到 `std::string_view` 的隐式转换，可以直接用 view 查表。对于日志、路由、配置项这类“查多写少”的场景，收益很直接。

## 五、一份可以直接贴进代码规范的清单

| 场景 | 建议 |
| --- | --- |
| 函数只读参数 | 用 `std::string_view` |
| 函数返回值 | 默认用 `std::string`，除非指向 static 数据 |
| 类成员 | 默认用 `std::string`，用 view 必须注释生命周期 |
| 传给 C API | 显式转 `std::string`，并让对象活到调用结束 |
| 跨线程/异步保存 | 不要存 view，存 `std::string` |
| 需要修改内容 | 用 `std::string` |

最后给一个自查方法：看到 `std::string_view` 时，问自己一句“它指向的那块内存，是谁负责释放的？”如果答不上来，这里大概率有一个悬垂引用。开启 ASan 跑一遍单测，能提前抓住大部分问题；剩下的，就得靠上面这条规则了。

---

> 原文链接：[C++ string_view 实战：不拷贝，也不保证活着](https://daily.xplanc.org/cpp/C%2B%2B-string_view-%E5%AE%9E%E6%88%98%EF%BC%9A%E4%B8%8D%E6%8B%B7%E8%B4%9D%EF%BC%8C%E4%B9%9F%E4%B8%8D%E4%BF%9D%E8%AF%81%E6%B4%BB%E7%9D%80.md)
