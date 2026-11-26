> 原文链接：[errdefer：把清理代码钉在错误路径上 - 码日新 · 每日文章](https://daily.xplanc.org/zh/zig/errdefer：把清理代码钉在错误路径上.md)

---

# errdefer：把清理代码钉在错误路径上

Zig 没有析构函数，也没有 RAII。资源什么时候还回去，完全由你写的控制流决定。多数人第一次遇到 `defer` 就喜欢上它：“函数退出时执行”，多省事。但真正麻烦的是另一半：有些清理只该在失败时发生，成功时反而不能做。`defer` 做不到这一点，Zig 为此准备了 `errdefer`。它和 `defer` 只差三个字母，触发条件却完全不同；放错位置，就会留下泄漏或者过早删除的 bug。本文从一段“看起来没问题”的写入逻辑讲起，拆开 `errdefer` 的触发规则、错误值捕获、执行顺序，以及循环和 panic 场景下的几个坑。

## 一个不能“无条件清理”的场景

假设要把数据写入临时文件，成功时留着给下一阶段处理，失败时必须删掉，免得磁盘上留半截垃圾。用 `defer` 做不到——它不管成功失败都会执行：

```zig
const std = @import("std");

fn writeTemp(data: []const u8) !void {
    const tmp = try std.fs.cwd().createFile("data.tmp", .{});
    defer tmp.close();

    // 只有后续步骤失败时才删；成功返回绝不能执行
    errdefer {
        std.fs.cwd().deleteFile("data.tmp") catch {};
    }

    try tmp.writeAll(data);
    try tmp.sync();
    // 正常返回，文件保留在磁盘上
}
```

这里先注册 `errdefer`（删除），再注册 `defer`（关文件）。退出时按**后进先出**的顺序执行，所以是“先关文件、再删临时文件”——在 Windows 上这点尤其重要，删一个还开着句柄的文件通常会失败。若把 `errdefer` 换成 `defer`，成功路径也会把文件删掉，后续阶段就什么都读不到了。

## defer 与 errdefer 的分工

两者的差别可以压缩成一张表：

| 退出方式 | `defer` | `errdefer` |
| --- | --- | --- |
| `return value` | 执行 | 不执行 |
| `return error.X` | 执行 | 执行 |
| `try` 把错误传出去 | 执行 | 执行 |
| 正常走到作用域末尾 | 执行 | 不执行 |
| `panic` / `unreachable` | 不执行 | 不执行 |

注意最后一行：Zig 的 panic 不走栈展开，`defer` 和 `errdefer` 都不会执行。所以别指望它们做“必须发生”的收尾，比如刷盘、释放跨进程锁；这类操作要显式调用。

`errdefer` 还能把错误值接出来，方便记录上下文：

```zig
fn parse(data: []const u8) !void {
    errdefer |err| {
        std.debug.print("解析失败: {s}\n", .{@errorName(err)});
    }
    if (data.len == 0) return error.EmptyInput;
    // ...
}
```

`|err|` 捕获的是当前错误 union 的错误值，`@errorName` 把它转成字符串。如果函数返回类型不是 error union（比如 `fn f() void`），写 `errdefer` 会直接编译报错。

## 多步初始化：拿到资源就登记回滚

`errdefer` 最能发挥价值的地方是多资源构造。规则很简单：**每拿到一份资源，立刻写下它失败时怎么还**，然后再去申请下一份。

```zig
const std = @import("std");

const Engine = struct {
    allocator: std.mem.Allocator,
    name: []u8,
    table: []u32,
    file: std.fs.File,

    fn init(allocator: std.mem.Allocator, path: []const u8) !Engine {
        var self = Engine{
            .allocator = allocator,
            .name = undefined,
            .table = undefined,
            .file = undefined,
        };

        self.name = try allocator.dupe(u8, path);
        errdefer allocator.free(self.name);

        self.table = try allocator.alloc(u32, 1024);
        errdefer allocator.free(self.table);

        self.file = try std.fs.cwd().openFile(path, .{});
        errdefer self.file.close();

        for (self.table) |*slot| slot.* = 0;
        return self;
    }

    fn deinit(self: *Engine) void {
        self.file.close();
        self.allocator.free(self.table);
        self.allocator.free(self.name);
    }
};
```

`openFile` 失败时，前两步的 `errdefer` 会按逆序释放 `table` 和 `name`；全部成功时，`errdefer` 一个都不跑，资源由调用方通过 `deinit` 正常释放。用 `std.testing.allocator` 可以很直接地验证失败路径：

```zig
test "失败路径不泄漏" {
    const allocator = std.testing.allocator;
    try std.testing.expectError(
        error.FileNotFound,
        Engine.init(allocator, "no-such-config-12345.conf"),
    );
}

test "成功路径不触发回滚" {
    const allocator = std.testing.allocator;
    const path = "zig-errdefer-test.conf";
    {
        const f = try std.fs.cwd().createFile(path, .{});
        f.close();
    }
    defer std.fs.cwd().deleteFile(path) catch {};

    var engine = try Engine.init(allocator, path);
    defer engine.deinit();
    try std.testing.expectEqual(@as(usize, 1024), engine.table.len);
}
```

如果漏掉任何一条 `errdefer`，第一个测试就会报内存泄漏。这比人眼审查回滚代码可靠得多。

## 几个容易踩的坑

**登记太晚。** 回滚必须写在“资源到手后、下一步可能失败前”。下面这段在 `a` 拿到后没有登记，等 `b` 失败时，`a` 已经泄漏了：

```zig
fn build(allocator: std.mem.Allocator) !Resource {
    const a = try allocator.alloc(u8, 10);
    // 这里漏了 errdefer allocator.free(a)
    const b = try allocator.alloc(u8, 20); // b 失败，a 泄漏
    errdefer allocator.free(b);
    errdefer allocator.free(a); // 太晚了
    return .{ .a = a, .b = b };
}
```

**循环里的 defer 是每次迭代都执行。** 它绑定到最近的花括号块，`for` 的循环体就是那个块：

```zig
for (lines) |line| {
    const copy = try allocator.dupe(u8, line);
    defer allocator.free(copy); // 每次迭代结束就释放，不是循环结束
    try emit(copy);
}
```

想让 `copy` 活到循环之后，就把 `defer` 移到外层，或者把副本收集进列表统一释放。

**顺序会被搞反。** `defer` 和 `errdefer` 一起注册时，执行顺序是逆序的：

```zig
defer std.debug.print("A\n", .{});
errdefer std.debug.print("B\n", .{});
return error.Oops; // 先输出 B，再输出 A
```

**panic 不给你机会。** `unreachable`、越界、显式 `panic` 都不会展开栈，`defer` / `errdefer` 全部跳过。需要绝对保证的清理，别放进这两个语句里。

## 小结

- 资源到手立刻登记回滚：成功路径用 `defer`，只该在失败时发生的用 `errdefer`。
- `errdefer` 仅在函数以错误退出时执行；用 `errdefer |err|` 可以拿到错误值。
- 多个 `defer` / `errdefer` 按后进先出执行，注册顺序要随之设计。
- 循环体内的 `defer` 每轮迭代都会跑；panic 场景下两者都不跑。
- 给失败路径写一条 `std.testing.allocator` 测试，泄漏会自己报出来。

## 相关文章

- [Zig 没有隐藏的 malloc](https://daily.xplanc.org/zh/zig/Zig-没有隐藏的-malloc.md)

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
