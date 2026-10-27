# Python 导入机制实战：改了代码为什么不生效

改完一个模块里的常量，重启脚本，输出还是旧值；在 Jupyter 里调整了函数，调用结果纹丝不动；线上服务报 `ModuleNotFoundError`，本地却一切正常。这些问题的根源大多不在代码逻辑，而在 `import` 背后那套缓存与路径规则。

这篇文章不讲语法，只讲排查：`import` 到底做了什么，以及几类"代码明明改了却不生效"的典型场景。

## 一、`import` 只执行一次

Python 的 `import` 语句在真正加载模块前，会先查一个全局字典 `sys.modules`。命中就直接返回，模块代码不会再执行第二遍。

```python
# demo.py
import sys

print("demo 模块被执行")
VALUE = 1
```

```python
import demo
import demo
import demo

print(demo.VALUE, sys.modules["demo"].__file__)
```

输出只有一行 `demo 模块被执行`。这说明后两次 `import` 都是缓存命中。

所以第一条结论：**同一个进程里，模块代码只跑一次**。变量的值停留在第一次导入时的状态，除非有人显式修改它。

`sys.modules` 是一个普通 dict，可以查看，也可以删除：

```python
del sys.modules["demo"]
import demo  # 这次会重新执行
```

但不要在生产代码里随手这么干。删掉条目只是让下次 `import` 重新加载，其他模块里已经持有的旧对象引用不会跟着更新，只会制造更难查的问题。

## 二、`reload` 解决不了大部分问题

标准库给了 `importlib.reload`，很多人以为它等于"热更新"：

```python
import importlib
import demo

demo.VALUE = 999
importlib.reload(demo)   # 重新执行 demo.py
print(demo.VALUE)        # 1
```

`reload` 确实会重新执行模块源码，但它有两个明确的边界：

1. **只更新模块对象本身**。如果别的模块写的是 `from demo import VALUE`，那个 `VALUE` 是导入时拷贝的引用，`reload` 之后依然是旧值。
2. **不会替换已经创建的实例**。类被重新定义后，旧实例的 `type(obj)` 仍指向旧类，`isinstance` 判断可能出现意外结果。

因此 `reload` 适合交互式调试，不适合当作部署手段。真要更新代码，重启进程是最省事的做法。

## 三、先确认你导入的是哪个文件

排查"不生效"的第一步永远是打印路径：

```bash
python -c "import app; print(app.__file__)"
```

更完整一点，看整个导入链：

```bash
python -v -c "import app" 2>&1 | grep -E "matches|code object"
```

`-v` 会打印每个模块的查找来源。如果出现 `matches /home/me/project/app.py`，说明加载的是本地文件而不是安装包。

常见的遮蔽来源：

| 现象 | 原因 |
| --- | --- |
| `import random` 行为异常 | 当前目录有 `random.py` |
| `import types` 报错 | 项目里有 `types.py` |
| 导入的是旧版本 | `PYTHONPATH` 里残留了另一份代码 |

一条命令列出路径优先级：

```bash
python -c "import sys; [print(p) for p in sys.path]"
```

顺序大致是：脚本所在目录（或空字符串，代表当前目录）、`PYTHONPATH`、标准库、`site-packages`。**越靠前优先级越高**，这也是本地文件能盖掉标准库的原因。同名文件放在脚本旁边，比任何安装包都优先。

## 四、`__pycache__` 什么时候会背锅

很多人一出问题就 `rm -rf __pycache__`，但默认情况下它很少是元凶。Python 复用 `.pyc` 的条件是：源文件的 **修改时间（mtime）和大小** 都与 pyc 头部记录的一致。

也就是说，正常的编辑必然会触发重新编译。只有在下面这些情况下才可能读到旧字节码：

- 用工具同步文件，保留了原始的 mtime，同时内容长度恰好没变；
- 手动改过系统时间，或从备份恢复导致 mtime 回退；
- 源文件被替换，但 mtime 和大小恰好相同。

判断方法：先 `touch` 一下源文件，再跑一次。

```bash
touch app.py
python -c "import app; print(app.__file__)"
```

如果行为变了，就是 pyc 的问题；没变，就别再纠结缓存了，去查路径和 `sys.modules`。

清理缓存可以用：

```bash
find . -name "__pycache__" -type d -exec rm -rf {} +
```

另外，`python -B` 会完全禁用字节码写入，适合排查时使用。

## 五、循环导入：错误信息其实写得很清楚

```
ImportError: cannot import name 'a_func' from partially initialized module 'a'
(most likely due to a circular import)
```

看到 `partially initialized`，基本可以确定是循环导入。

```python
# a.py
from b import b_func

def a_func():
    return "a"

print(b_func())
```

```python
# b.py
from a import a_func

def b_func():
    return a_func()
```

执行 `python a.py`：`a` 开始执行，第一行去导入 `b`；`b` 又要从 `a` 导入 `a_func`，可此时 `a` 才执行到第一行，`a_func` 还没定义，于是报错。

三种改法，按优先级排列：

1. **抽出公共模块**。把双方都需要的函数放进 `c.py`，`a` 和 `b` 各自导入 `c`。这是最干净的做法。
2. **改成导入模块，而不是导入名字**：`import a` 然后调用 `a.a_func()`。属性在调用时才查找，此时 `a` 已经初始化完毕。
3. **延迟导入**。把 `from a import a_func` 挪进 `b_func` 函数体，调用时才触发导入。

第三种写法在框架里很常见（避免启动期加载过重），但会掩盖依赖关系，能不用就不用。

## 六、`python -m` 和 `python file.py` 不是一回事

这是 `ModuleNotFoundError` 最常见的来源。

```bash
python -m pkg.mod     # sys.path[0] 是当前工作目录
python pkg/mod.py     # sys.path[0] 是 pkg/ 目录
```

| 启动方式 | `sys.path[0]` | 相对导入 | 能否 `import pkg` |
| --- | --- | --- | --- |
| `python -m pkg.mod` | 当前工作目录 | 可用 | 可以 |
| `python pkg/mod.py` | `pkg/` | 报错 | 通常不行 |

直接运行文件时，Python 只把该文件所在目录加入路径，`pkg` 的父目录并不在里面，所以包内绝对导入会失败；同时该文件被当作顶层脚本，没有包上下文，相对导入会抛出：

```
ImportError: attempted relative import with no known parent package
```

结论很简单：**包内的模块一律用 `python -m` 启动**。CI 脚本里尤其要注意，别在 `cd pkg && python mod.py` 这类写法上浪费半天。

## 七、一份排查清单

按顺序执行，基本能覆盖九成问题：

1. 打印真实路径：`python -c "import m; print(m.__file__)"`
2. 打印路径顺序：`python -c "import sys; print(*sys.path, sep='\n')"`，检查有无同名遮蔽
3. 看导入过程：`python -v -c "import m"`，确认命中的是预期文件
4. 看耗时与来源：`python -X importtime -c "import m"`，顺带发现启动期的重依赖
5. 怀疑缓存：`touch m.py` 后重跑，或 `python -B`
6. 检查启动方式是否用了 `-m`
7. 检查 `PYTHONPATH`、`.pth` 文件、虚拟环境是否指向了另一份代码

最后一条经验：**遇到"代码没生效"，先假设是环境问题，再假设是逻辑问题**。把导入路径打出来，往往比读十遍代码更快。

---

> 原文链接：[Python 导入机制实战：改了代码为什么不生效](https://daily.xplanc.org/python/Python-%E5%AF%BC%E5%85%A5%E6%9C%BA%E5%88%B6%E5%AE%9E%E6%88%98%EF%BC%9A%E6%94%B9%E4%BA%86%E4%BB%A3%E7%A0%81%E4%B8%BA%E4%BB%80%E4%B9%88%E4%B8%8D%E7%94%9F%E6%95%88.md)
