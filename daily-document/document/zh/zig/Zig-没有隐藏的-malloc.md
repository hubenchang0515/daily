> 原文链接：[Zig 没有隐藏的 malloc - 码日新 · 每日文章](https://daily.xplanc.org/zig/Zig-没有隐藏的-malloc.md)

---

# Zig 没有隐藏的 malloc

在 C 里，想要一块内存，写 `malloc` 就行；在 Zig 里，你很快会发现几乎每个需要分配的函数都多了一个 `allocator` 参数。它不是仪式感，而是把“这块内存从哪来、活多久、由谁释放”从注释里搬进了类型签名。Zig 标准库没有全局堆，也不替调用方决定分配策略，代价是你要多写几个参数，收益是内存行为在调用点就能看清楚。

## 从一个函数签名说起

```zig
const std = @import("std");

pub fn parse(allocator: std.mem.Allocator, input: []const u8) !Ast {
    const buf = try allocator.alloc(u8, input.len);
    errdefer allocator.free(buf);
    // ...
}
```

`std.mem.Allocator` 不是某个具体分配器，而是一个胖指针：一个 `*anyopaque` 加上一张函数表，表里是 `alloc`、`resize`、`free` 等操作。任何实现了这套接口的类型都能传进来，调用方不需要知道背后是系统页、栈上缓冲区还是测试用的记账器。

这和 C++ 的 `std::pmr::memory_resource` 很像，区别在于 Zig 把它放在了标准库最常用的位置。于是同一个 `parse` 可以：

- 在单元测试里接 `std.testing.allocator`，漏掉 `free` 直接报错；
- 在服务端接 `DebugAllocator`，顺手抓 use-after-free；
- 在请求处理里接 `ArenaAllocator`，整段一起释放；
- 在嵌入式环境里接 `FixedBufferAllocator`，一个字节都不向系统要。

## 为什么不做全局分配器

全局分配器写起来省事，但它把三个问题藏了起来：内存从哪来、是否线程安全、失败时怎么办。库代码一旦自己调用 `malloc`，使用方就失去了替换权；而在嵌入式、实时系统或需要严格计费的场景里，替换权往往比省事更重要。

Zig 的选择是：标准库不隐式分配，分配器由应用在最外层创建，再沿着调用链传下去。这不是为了“纯函数”好看，而是让分配策略成为应用决策，而不是库的副作用。

## 常用分配器速查

| 分配器 | 典型用途 | 代价与限制 |
| --- | --- | --- |
| `std.heap.page_allocator` | 启动阶段的大块内存、一次性工具 | 每次分配基本都走系统调用，别放热路径 |
| `std.heap.DebugAllocator` | Debug、测试、排查泄漏 | 有簿记开销；0.14 前叫 `GeneralPurposeAllocator` |
| `std.heap.ArenaAllocator` | 请求级、批处理 | 只能整体释放，不能逐个回收 |
| `std.heap.FixedBufferAllocator` | 嵌入式、栈上缓冲区 | 容量固定，释放不会把空间还回去 |
| `std.testing.allocator` | 单元测试 | 测试结束自动检查泄漏 |
| `std.heap.c_allocator` | 链接 libc、和 C 库交互 | 需要 libc，行为受 C 分配器影响 |

ReleaseFast 下的多线程程序，还可以考虑 0.14 引入的 `std.heap.smp_allocator`。

一个最小的 Debug 配置长这样：

```zig
const std = @import("std");

pub fn main() !void {
    var gpa = std.heap.DebugAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const copy = try allocator.dupe(u8, "zig");
    defer allocator.free(copy);

    std.debug.print("{s}\n", .{copy});
}
```

`deinit()` 的返回值是泄漏检查结果。用 `_ =` 忽略它不会让泄漏消失，Debug 模式下它仍会把泄漏的位置打印出来。

## arena：把一批分配当成一个

请求处理是最适合 arena 的场景：解析请求时可能分配十几块小内存，但它们的寿命完全相同，请求结束就该一起消失。

```zig
const std = @import("std");

const Request = struct {
    path: []const u8,
    query: []const u8,
};

fn parse(a: std.mem.Allocator, raw: []const u8) !Request {
    const q = std.mem.indexOfScalar(u8, raw, '?');
    const path_end = q orelse raw.len;
    const query = if (q) |i| raw[i + 1 ..] else "";
    return .{
        .path = try a.dupe(u8, raw[0..path_end]),
        .query = try a.dupe(u8, query),
    };
}

fn handle(backing: std.mem.Allocator, raw: []const u8) !void {
    var arena = std.heap.ArenaAllocator.init(backing);
    defer arena.deinit();
    const a = arena.allocator();

    const req = try parse(a, raw);
    std.debug.print("{s}?{s}\n", .{ req.path, req.query });
}

pub fn main() !void {
    var buf: [1024]u8 = undefined;
    var fba = std.heap.FixedBufferAllocator.init(&buf);
    try handle(fba.allocator(), "/index.html?q=zig");
}
```

注意两点。第一，arena 里已分配的块不会因为后续分配而移动，但 `arena.deinit()` 之后全部失效，所以不要把里面的切片存进生命周期更长的结构体。第二，对 arena 的分配器单独调用 `free` 基本没有回收效果，它的设计就是“只整体释放”。

## 所有权规则没有变，只是变显式

谁分配，谁释放；释放时必须使用同一个分配器实例。`dupe`、`concat` 这类函数返回的内存归调用方所有，这一点和 C 的 `strdup` 一样，只是 Zig 不会替你猜。

错误路径上，`errdefer` 是最常用的工具：

```zig
fn readHead(allocator: std.mem.Allocator, path: []const u8) ![]u8 {
    const file = try std.fs.cwd().openFile(path, .{});
    defer file.close();

    const buf = try allocator.alloc(u8, 4096);
    errdefer allocator.free(buf);

    const n = try file.readAll(buf);
    return try allocator.realloc(buf, n);
}
```

如果 `readAll` 或 `realloc` 失败，`errdefer` 会释放 `buf`；正常返回时它不执行。`defer` 和 `errdefer` 都按后进先出的顺序执行，写多个资源清理时顺序要心里有数。

动态数组也能体现这套规则。Zig 0.15 起 `ArrayList` 默认不自带分配器：

```zig
var out: std.ArrayList(u8) = .empty;
defer out.deinit(allocator);
try out.appendSlice(allocator, "hello");
try out.append(allocator, '!');
std.debug.print("{s}\n", .{out.items});
```

0.14 及更早的版本则是 `std.ArrayList(u8).init(allocator)`，`append` 也不接收分配器参数。升级时这类签名变化很集中，编译错误会直接指出来。

## 几个容易踩的坑

1. **用错分配器释放**。从 arena 拿到的内存不能交给 `page_allocator` 去 `free`，反之亦然。分配器实例和分配来源必须配对。
2. **把 arena 的切片返回给外部**。函数返回后 arena 可能已经 `deinit`，调用方拿到的是悬空切片。
3. **在热路径使用 `page_allocator`**。小块频繁分配会让系统调用成为瓶颈，应该换成 arena、固定缓冲区或专用的通用分配器。
4. **忘记 `deinit` 通用分配器**。测试里优先用 `std.testing.allocator`，它会在测试结束时替你检查泄漏。

Zig 不是没有堆，而是拒绝替你决定堆在哪里。把 `allocator` 一路传下去，看起来只是多了几个参数，实际上是在每个调用点标明了内存的来源和寿命。写久了会发现，这种“麻烦”比调试一次隐藏的 `malloc` 崩溃要便宜得多。

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
