> 原文链接：[三个 lambda 共用一个变量：读懂闭包的延迟绑定 - 码日新 · 每日文章](https://daily.xplanc.org/zh/python/三个-lambda-共用一个变量：读懂闭包的延迟绑定.md)

---

# 三个 lambda 共用一个变量：读懂闭包的延迟绑定

循环里创建的几个函数，调用时却给出了同一个答案——这是 Python 里最经典的"灵异现象"之一。表面看是 lambda 出了问题，根子却在闭包捕获变量的方式上：它保存的是变量本身，而不是创建那一刻的值。理解这一点，不仅能避开坑，还能让你在回调、线程和装饰器里少写很多补丁。

## 先看一个反直觉的结果

把下面这段代码敲进解释器，猜猜它会打印什么：

```python
funcs = []
for i in range(3):
    funcs.append(lambda: i)

for f in funcs:
    print(f())
```

直觉告诉你应该是 0、1、2。实际输出却是：

```
2
2
2
```

三个 lambda 好像商量好了，全都记住了最后一个值。更让人困惑的是，如果在循环体里直接 `print(i)`，明明是老老实实的 0、1、2。函数到底在什么时候"偷看"了这个变量？

## 闭包装的是变量，不是照片

答案藏在两个规则里。

第一，**Python 的 `for` 循环不创建作用域**。不像 C++ 或 Java 的块级作用域，`i` 自始至终是所在函数里同一个变量，循环只是反复给它赋值。三轮循环下来，并没有产生三个独立的 `i`，只有一个被改了三次的 `i`。

第二，**闭包捕获的是变量的绑定，而不是当时的值**。定义 `lambda: i` 时，Python 并没有把此刻的 `0` 拍成一张照片塞进函数，而是让函数记住了"去外面的作用域找 `i`"这件事。等真正调用时再去找，循环早就跑完了，`i` 停在 `2`。

所以三个 lambda 看着是三个函数，背后指向的是同一个变量。它们不是三台各存一份数据的相机，而是三根指向同一个房间的指针——房间里的东西换了，谁进去看到的都是新东西。这叫**延迟绑定**（late binding）：名字在函数被调用时才解析，而不是定义时。

## 把 cell 拆开看

如果觉得抽象，可以直接把闭包内部翻出来看。函数对象的 `__closure__` 属性是一个 cell 元组，每个 cell 存着一个被捕获的变量：

```python
funcs = []
for i in range(3):
    funcs.append(lambda: i)

for f in funcs:
    cell = f.__closure__[0]
    print(cell.cell_contents, id(cell))
```

输出会显示三个 cell 的内容都是 `2`，而且 `id(cell)` 完全相同：

```
2 140708...
2 140708...
2 140708...
```

这实锤了"同一个变量"的说法。三个函数共享同一个 cell，cell 里的值在循环结束后才定型。

## 四种把值钉住的办法

既然问题出在共享绑定上，思路就清楚了：**让每次迭代产生一个独立的、不会被改动的值，让函数去捕获它**。

### 1. 用默认参数固化

最简洁的写法，把循环变量作为默认参数传进去：

```python
funcs = []
for i in range(3):
    funcs.append(lambda i=i: i)

print([f() for f in funcs])  # [0, 1, 2]
```

关键在于默认参数在**函数定义时**就求值完毕。`lambda i=i: i` 中，等号右边的 `i` 是当前循环变量，左边是新函数的形参名。每一轮都把当时的值复制一份，三个函数各有各的默认参数，互不干扰。

这个写法看起来有点绕（两个 `i`），但它是 Python 社区里最通行的解法。

### 2. 用 functools.partial

如果觉得默认参数太隐晦，可以把绑定意图写得更直白：

```python
from functools import partial

def show(x):
    return x

funcs = [partial(show, i) for i in range(3)]
print([f() for f in funcs])  # [0, 1, 2]
```

`partial` 会把调用时的参数值"冻结"进新对象，本质上和默认参数是一回事，但读起来更像是在说"把这个值绑上去"。

### 3. 用一个工厂函数

把创建 lambda 的动作放进一个函数里，借助函数调用产生的新作用域来隔离变量：

```python
def make_func(i):
    return lambda: i

funcs = [make_func(i) for i in range(3)]
print([f() for f in funcs])  # [0, 1, 2]
```

每次调用 `make_func` 都会新建一个局部作用域，里面的 `i` 是独立的，返回的 lambda 各自捕获自己的那一份。这个写法最"正统"，也最容易推广到复杂场景。

### 4. 列表推导里的注意点

有人以为列表推导在 Python 3 里有独立作用域就万事大吉，其实不然：

```python
funcs = [lambda: i for i in range(3)]
print([f() for f in funcs])  # [2, 2, 2]
```

推导式的独立作用域只保护了 `i` 不泄漏到外部，但里头的 lambda 依然是延迟绑定，仍然共享同一个 `i`。该用的默认参数一个都不能少：

```python
funcs = [lambda i=i: i for i in range(3)]
```

## 坑不只在 lambda 里

任何"先定义函数、后调用"的场景都可能踩到同一个雷。

**线程**是最常见的受害者：

```python
import threading

threads = []
for i in range(3):
    threads.append(threading.Thread(target=lambda: print(i)))

for t in threads:
    t.start()
for t in threads:
    t.join()
```

线程启动有个时间差，等它们真正执行时，循环往往已经结束，打印出来的多半是三个 `2`。修法照旧：`target=lambda i=i: print(i)`。

**GUI 回调**也一样。用 tkinter 创建三个按钮，希望点哪个就打印哪个的编号：

```python
import tkinter as tk

root = tk.Tk()
for i in range(3):
    btn = tk.Button(root, text=f"按钮 {i}", command=lambda: print(i))
    btn.pack()
root.mainloop()
```

不管点哪个按钮，打印的都是 `2`。因为 `command` 里的 lambda 是在点击时才调用的。

**装饰器**里也有类似的影子。写一堆装饰器套在同一个函数上时，如果闭包引用了循环变量或后续会被修改的状态，就要格外小心。记住一条判断准则：只要函数的定义和调用之间存在时间差，并且它引用了外层会被改动的变量，就应该想想是不是该把值钉住。

## 延迟绑定并不总是坏事

这个机制本身不是 bug，它只是"按引用捕获"的自然结果。很多时候我们恰恰需要这种特性——闭包希望能读到变量的最新状态，而不是定义时的旧值。

比如计数器，靠的就是闭包持有并修改同一个变量：

```python
def make_counter():
    count = 0

    def counter():
        nonlocal count
        count += 1
        return count

    return counter

c = make_counter()
print(c(), c(), c())  # 1 2 3
```

再比如多个回调函数共享一份配置对象，配置改了之后所有回调立刻看到新值——这种"活"的连接正是延迟绑定带来的便利。

问题从来不是延迟绑定本身，而是**你以为它捕获了值，它却捕获了变量**。当你的意图是"定格此刻"，就得主动用默认参数、`partial` 或工厂函数把值固化下来；当你的意图是"共享状态"，延迟绑定反而是最顺手的工具。

## 小结

- `for` 循环没有独立作用域，循环变量是同一个变量被反复赋值。
- 闭包捕获的是变量的绑定，在函数被调用时才解析名字，这就是延迟绑定。
- 循环里创建函数若不处理，多个函数会共享最后一个值的变量。
- 固化值有三板斧：默认参数 `lambda i=i`、`functools.partial`、工厂函数；列表推导不能幸免。
- 回调、线程、装饰器都是高发区；而计数器、共享配置这类场景则可以放心利用延迟绑定。

下次再看到"为什么全是最后一个值"，先别怀疑 lambda，去问问它捕获的那个变量，此刻到底指向了谁。

## 相关文章

- [Python 编码：默认值替你做的决定](https://daily.xplanc.org/zh/python/Python-编码：默认值替你做的决定.md)
- [Python 的哈希契约：为什么 list 不能当字典的键](https://daily.xplanc.org/zh/python/Python-的哈希契约：为什么-list-不能当字典的键.md)
- [Python 的 super() 到底调用了谁](https://daily.xplanc.org/zh/python/Python-的-super%28%29-到底调用了谁.md)
- [异步 IO 入门：从阻塞到 asyncio](https://daily.xplanc.org/zh/python/异步-IO-入门：从阻塞到-asyncio.md)

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
