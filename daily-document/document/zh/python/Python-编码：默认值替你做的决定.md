> 原文链接：[Python 编码：默认值替你做的决定 - 码日新 · 每日文章](https://daily.xplanc.org/zh/python/Python-编码：默认值替你做的决定.md)

---

# Python 编码：默认值替你做的决定

en 是 encoding 的缩写，也是 Python 里最容易导致编码错误的两个字母。`str` 与 `bytes` 之间的转换规则本身不复杂，真正麻烦的是那些“不写也行”的默认值：`open()` 跟随系统 locale，子进程跟随 locale，HTTP 客户端相信响应头。平时一切正常，换台机器、换个容器就全是乱码。下面把这些默认值逐个拆开。

## 先分清方向

Python 3 里，`str` 是 Unicode 码点序列，`bytes` 是字节序列。`encode` 把 str 变成 bytes，`decode` 把 bytes 变回 str。

```python
s = "中文"
len(s)                       # 2
len(s.encode("utf-8"))       # 6
s.encode("utf-8")            # b'\xe4\xb8\xad\xe6\x96\x87'
s.encode("gbk")              # b'\xd6\xd0\xce\xc4'
```

方向记清楚，错误信息就不容易让人困惑：`UnicodeEncodeError` 说明某个字符在目标编码里表示不了，`UnicodeDecodeError` 说明这串字节不合法。两者都不是“字符串坏了”，而是选错了编码。

## 默认编码到底是谁

很多人以为 Python 3 默认就是 UTF-8，依据是 `sys.getdefaultencoding()` 返回 `utf-8`。这个值只说明解释器内部怎么处理文本，并不决定文件读写。

| 入口 | 不显式指定时使用的编码 |
| --- | --- |
| `open()`、`Path.read_text()` | `locale.getpreferredencoding(False)` |
| `subprocess` 的 `text=True` | 同上 |
| 重定向后的 `sys.stdout` | 同上 |
| 直接连终端的 `sys.stdout` | Windows 下为 UTF-8，POSIX 下通常是 UTF-8 |
| 源码文件 | UTF-8（PEP 3120） |
| `json.loads(bytes)` | 自动识别 UTF-8/16/32 |
| `requests` 的 `r.text` | 响应头 charset，缺失时 `text/*` 回退 ISO-8859-1 |

中文 Windows 上 `locale.getpreferredencoding(False)` 常常是 `cp936`，Linux 桌面是 `UTF-8`，精简容器里则可能是 ASCII。同一份代码，三种行为。

Python 3.7 起，POSIX 的 C locale 会被自动升级为 `C.UTF-8`，所以在 `LANG=C` 下运行脚本时，未必会像老版本那样报错；但更老的解释器会直接抛出 `UnicodeEncodeError`。这就是“在我机器上是好的”的常见来源。PEP 686 计划从 3.15 起把 UTF-8 模式设为默认，不过现存的运行环境不会立刻升级，显式写 `encoding` 仍是最省事的自保方式。

## 文件：把 encoding 写死

```python
from pathlib import Path

text = Path("note.txt").read_text(encoding="utf-8")
Path("out.txt").write_text(text, encoding="utf-8")
```

读写都写 `utf-8`。如果文件来自 Windows 记事本或 Excel，开头可能带 BOM：`EF BB BF`。用 `utf-8` 解码后，正文第一个字符会变成不可见的 `\ufeff`，`json.loads`、正则匹配、字符串比较都可能莫名失败。

```python
raw = b"\xef\xbb\xbfhello"
raw.decode("utf-8")       # '\ufeffhello'
raw.decode("utf-8-sig")   # 'hello'
```

`utf-8-sig` 读的时候会处理掉 BOM，写的时候则主动加上 BOM。给 Excel 准备 CSV 时，这个组合很实用，同时别忘了 `newline=""`：

```python
import csv

with open("data.csv", "w", encoding="utf-8-sig", newline="") as f:
    writer = csv.writer(f)
    writer.writerow(["名称", "数量"])
    writer.writerow(["苹果", 3])
```

## 终端、管道与子进程

`print()` 的目标是终端还是文件，使用的编码并不一样。Windows 上直接连控制台时，Python 走 `WriteConsoleW`，中文能正常显示；一旦重定向到文件或管道，就退回 locale 编码，日志里于是出现：

```text
UnicodeEncodeError: 'gbk' codec can't encode character ...
```

临时处理可以让标准输出固定为 UTF-8：

```python
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
```

子进程也一样。`text=True` 只是省去了手动 decode，没给 `encoding` 时用的仍是 locale：

```python
import subprocess

proc = subprocess.run(
    ["git", "log", "-1"],
    capture_output=True,
    text=True,
    encoding="utf-8",
    errors="replace",
)
print(proc.stdout)
```

`errors="replace"` 会把非法字节换成 `�`，适合展示，不适合需要逐字节还原的场景。

## 网络响应：别直接信 `.text`

`requests` 的 `r.text` 使用 `r.encoding`。这个值从 `Content-Type` 的 charset 推断；如果响应是 `text/html` 却没有 charset，按照 RFC 2616 会回退到 ISO-8859-1。服务器实际发的是 UTF-8，`.text` 就会产出乱码。

```python
import requests

r = requests.get(url, timeout=10)
r.encoding = "utf-8"                 # 已知编码时直接指定
text = r.content.decode("utf-8")     # 或者完全绕开 .text
```

`r.apparent_encoding` 靠统计猜测，短文本经常猜错，只适合兜底，不适合当默认值。

## errors 不是垃圾桶

`open()`、`encode()`、`decode()` 都接受 `errors` 参数，它的作用不是“让错误消失”：

| 值 | 行为 | 适用场景 |
| --- | --- | --- |
| `strict` | 遇错就抛出 | 默认，也是排查时最该用的 |
| `replace` | 换成 `�` | 日志、展示 |
| `ignore` | 直接丢掉 | 几乎总是错的 |
| `backslashreplace` | 写成 `\xNN` | 保留可读线索 |
| `surrogateescape` | 把非法字节映射成代理字符 | POSIX 文件名、环境变量的往返 |

`ignore` 最危险：它不报错，也不告诉你少了什么。一个字段被悄悄吞掉，最后变成数据库里的空值。`surrogateescape` 是 POSIX 上 `os.environ` 和文件名的默认策略，能保证 `bytes → str → bytes` 原样往返，但不要拿它去处理普通文本文件。

另外，如果字符串已经变成乱码，只有还原路径明确时才能救回来，例如 UTF-8 字节被当成 Latin-1 读入：

```python
fixed = broken.encode("latin-1").decode("utf-8")
```

一旦解码时用了 `replace` 或 `ignore`，原始字节已经丢了，再转也补不回来。所以排查阶段要用 `strict`，让问题尽早暴露。

## 一个可执行的排查顺序

1. 确认当前对象是 `str` 还是 `bytes`，错误发生在 encode 还是 decode。
2. 找出是谁在做隐式解码：`open`、`read_text`、`subprocess`、`response.text`，还是 `sys.stdout`。
3. 打印 `locale.getpreferredencoding(False)` 和 `sys.stdout.encoding`，确认运行环境的默认值。
4. 检查文件头三个字节是不是 `EF BB BF`，必要时改用 `utf-8-sig`。
5. 把 `errors` 改回 `strict`，读错误信息里的位置和字节，而不是继续加 `ignore`。
6. 在边界处固定编码：文件、子进程、HTTP 响应、数据库连接，各写各的 `encoding`。

编码问题很少是 Python 的错，多数是我们把选择权交给了默认值。默认值在开发机上往往是对的，到了服务器、容器或别人的电脑上就未必。把 `encoding="utf-8"` 写出来，麻烦会少很多。

## 相关文章

- [with 离开之后：读懂 Python 的上下文管理器](https://daily.xplanc.org/zh/python/with-离开之后：读懂-Python-的上下文管理器.md)
- [异步 IO 入门：从阻塞到 asyncio](https://daily.xplanc.org/zh/python/异步-IO-入门：从阻塞到-asyncio.md)
- [Python 的 super() 到底调用了谁](https://daily.xplanc.org/zh/python/Python-的-super%28%29-到底调用了谁.md)

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
