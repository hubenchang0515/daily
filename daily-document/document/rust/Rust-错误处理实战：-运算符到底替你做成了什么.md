# Rust 错误处理实战：? 运算符到底替你做成了什么

写 Rust 时，很多人第一次卡住的地方不是所有权，而是 `?`。代码看起来只是把错误往上抛，编译器却报出 `the trait bound ... From<...> is not implemented`；改成 `fn main() -> Result<(), Box<dyn Error>>` 后能编译了，运行时又只打印一行看不懂的 `Debug`。要解决这些问题，需要先弄清 `?` 到底做了什么。

## 一、`?` 展开后只做两件事

下面这行代码：

```rust
let port = read_port()?;
```

大致等价于：

```rust
let port = match read_port() {
    Ok(value) => value,
    Err(error) => return Err(From::from(error)),
};
```

第一，提前返回；第二，用 `From` 把原来的错误转换成当前函数的错误类型。所以 `?` 能不能用，不取决于错误本身，而取决于当前函数的返回类型有没有实现对应的 `From`：

```rust
fn read_port() -> Result<u16, ConfigError>
```

如果 `read_port` 返回的是 `std::io::Error`，而当前函数要返回 `ConfigError`，编译器就会要求 `ConfigError: From<std::io::Error>`。没有这个实现，`?` 就无法使用。

`?` 也能用于 `Option`，但含义变成“遇到 `None` 就返回 `None`”，不能把 `Option` 直接变成 `Result`。

## 二、从零写一个能用的错误类型

先建一个最小项目：

```toml
[package]
name = "port-check"
version = "0.1.0"
edition = "2021"

[dependencies]
anyhow = "1"
thiserror = "2"
```

完整代码如下：

```rust
use std::env;
use std::num::ParseIntError;

use anyhow::Context;

#[derive(Debug, thiserror::Error)]
enum ConfigError {
    #[error("缺少环境变量 {0}")]
    Missing(&'static str),

    #[error("PORT={value:?} 不是合法端口")]
    InvalidPort {
        value: String,
        #[source]
        source: ParseIntError,
    },

    #[error("PORT 必须在 1..=65535 之间，收到 {0}")]
    OutOfRange(u32),
}

fn parse_port(value: &str) -> Result<u16, ConfigError> {
    let port: u32 = value.parse().map_err(|source| ConfigError::InvalidPort {
        value: value.to_owned(),
        source,
    })?;

    if !(1..=65535).contains(&port) {
        return Err(ConfigError::OutOfRange(port));
    }

    Ok(port as u16)
}

fn read_port() -> Result<u16, ConfigError> {
    let value = env::var("PORT").map_err(|_| ConfigError::Missing("PORT"))?;
    parse_port(&value)
}

fn main() -> anyhow::Result<()> {
    let port = read_port().context("读取服务配置失败")?;
    println!("listening on 127.0.0.1:{port}");
    Ok(())
}
```

这个错误类型包含三层信息：

- `Display`：给用户看的说明，由 `#[error("...")]` 生成；
- `Debug`：给开发者看的结构，由 `#[derive(Debug)]` 生成；
- `source()`：底层原因，由 `#[source]` 标记的字段提供。

把解析逻辑拆成纯函数 `parse_port`，而不是直接在 `read_port` 里读环境变量，是为了方便测试。环境变量是全局状态，测试之间容易互相污染；纯函数没有这个问题：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_normal_port() {
        assert_eq!(parse_port("8080").unwrap(), 8080);
    }

    #[test]
    fn rejects_zero_and_overflow() {
        assert!(matches!(parse_port("0"), Err(ConfigError::OutOfRange(0))));
        assert!(matches!(
            parse_port("70000"),
            Err(ConfigError::OutOfRange(70000))
        ));
    }
}
```

运行几种输入，输出很直观：

```text
$ cargo run
Error: 读取服务配置失败

Caused by:
    缺少环境变量 PORT

$ PORT=abc cargo run
Error: 读取服务配置失败

Caused by:
    0: PORT="abc" 不是合法端口
    1: invalid digit found in string

$ PORT=0 cargo run
Error: 读取服务配置失败

Caused by:
    PORT 必须在 1..=65535 之间，收到 0
```

注意，这里没有用 `#[from]` 自动生成 `From<ParseIntError>`，而是手写了 `map_err`。原因是自动转换只能保留 `ParseIntError`，会丢掉出错的原始字符串；手动构造 `InvalidPort` 才能把 `"abc"` 一起带进错误信息。

## 三、`Box<dyn Error>` 与 anyhow 的边界

标准库最常见的写法是：

```rust
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let port = read_port()?;
    println!("listening on 127.0.0.1:{port}");
    Ok(())
}
```

它能工作，但错误输出会变成：

```text
Error: OutOfRange(0)
```

因为 `main` 返回 `Err` 时，标准库打印的是错误的 `Debug`，不会自动展开 `source()` 链。用户看到 `OutOfRange(0)`，仍然不知道“0 不合法”这句话。

`anyhow` 的价值就在这里：它的 `Debug` 实现会打印整条上下文链，`context()` 还能在每一层补充“当时在做什么”：

```rust
let port = read_port().context("读取服务配置失败")?;
```

`context()` 不会覆盖原始错误，而是把它包在下面。上面那组输出中的 `Caused by` 就是这条链。

如果希望自己控制退出码和输出格式，可以不用 `main` 直接返回 `Result`，而是显式处理：

```rust
use std::process::ExitCode;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("错误: {error:#}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> anyhow::Result<()> {
    let port = read_port().context("读取服务配置失败")?;
    println!("listening on 127.0.0.1:{port}");
    Ok(())
}
```

`{error:#}` 是 `anyhow::Error` 的替代格式，会把上下文链压成一行，适合日志系统采集。

选择建议可以总结成一张表：

| 场景 | 推荐做法 | 原因 |
| --- | --- | --- |
| 库的公开 API | `thiserror` 或手写枚举 | 调用方可以匹配分支，也方便 `downcast` |
| 应用、CLI 主流程 | `anyhow` | `context` 方便，错误链完整 |
| 临时脚本 | `Box<dyn Error>` | 不引入依赖，够用 |
| 异步任务 | `anyhow` 或 `Box<dyn Error + Send + Sync>` | 跨线程要求错误类型可发送 |
| 需要区分错误分支 | 自定义枚举 | 类型安全，避免字符串匹配 |

库的公开 API 不建议直接返回 `anyhow::Error`。它会把 `anyhow` 变成使用者的隐式依赖，而且调用方很难穷举错误类型；`thiserror` 生成的枚举没有这个问题。

## 四、五个常见坑

**1. 在返回 `Result` 的函数里对 `Option` 用 `?`**

```rust
fn get_port() -> Result<u16, ConfigError> {
    let value: Option<String> = None;
    let value = value?; // 编译错误：? 只能返回 None
    Ok(0)
}
```

应该显式转换：

```rust
let value = value.ok_or(ConfigError::Missing("PORT"))?;
```

用 `anyhow` 时可以直接写 `value.context("缺少 PORT")?`。

**2. 同一个错误类型写了多个 `#[from]`**

```rust
#[derive(Debug, thiserror::Error)]
enum E {
    #[error("io: {0}")]
    A(#[from] std::io::Error),
    #[error("io again: {0}")]
    B(#[from] std::io::Error), // 冲突：重复实现 From
}
```

`#[from]` 会生成 `From<std::io::Error> for E`，两个变体都写就会冲突。保留一个自动转换，另一个用 `map_err` 手动指定。

**3. 用字符串把错误“压平”**

```rust
let port: u16 = value
    .parse()
    .map_err(|e| format!("端口格式错误: {e}"))?;
```

这样能编译，但 `source()` 链断了，调用方也没法再 `downcast` 到 `ParseIntError`。更好的做法是保留原始错误字段，或者用 `anyhow::Context` 附加说明。

**4. 在异步任务里使用 `Box<dyn Error>`**

`Box<dyn Error>` 默认不满足 `Send + Sync`。如果错误要跨 `.await` 或进入 `tokio::spawn`，需要写成：

```rust
Box<dyn std::error::Error + Send + Sync>
```

否则会遇到一堆“future cannot be sent between threads safely”的报错。

**5. 在库里随手 `unwrap()`**

库函数里的 `unwrap()` 会把可恢复错误变成 panic，调用方无法处理。确实表示“不可能发生”的地方，用 `expect("...")` 至少能留下原因；但在读文件、解析输入、访问环境变量这类地方，应该返回错误。

## 五、一份可落地的检查清单

- 库对外返回具体错误枚举，应用层再用 `anyhow` 汇总；
- 每个 `?` 都确认存在 `From` 实现，或者显式 `map_err`；
- 包装错误时保留 `source`，不要把错误变成纯字符串；
- 在 IO、配置、网络等边界加 `context`，说明“当时在做什么”；
- 测试里覆盖错误分支，而不只是 `happy path`；
- 需要控制退出码时，用 `ExitCode` 加 `{error:#}`，不要依赖默认的 `Debug` 输出。

`?` 本身很简单，复杂的是它背后的错误类型设计。把“库用枚举、应用用 anyhow、边界加 context”这三件事做好，大部分 Rust 错误处理问题都会变得清晰。

---

> 原文链接：[Rust 错误处理实战：? 运算符到底替你做成了什么](https://daily.xplanc.org/rust/Rust-%E9%94%99%E8%AF%AF%E5%A4%84%E7%90%86%E5%AE%9E%E6%88%98%EF%BC%9A-%E8%BF%90%E7%AE%97%E7%AC%A6%E5%88%B0%E5%BA%95%E6%9B%BF%E4%BD%A0%E5%81%9A%E6%88%90%E4%BA%86%E4%BB%80%E4%B9%88.md)
