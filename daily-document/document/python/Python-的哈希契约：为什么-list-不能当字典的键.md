> 原文链接：[Python 的哈希契约：为什么 list 不能当字典的键 - 码日新 · 每日文章](https://daily.xplanc.org/python/Python-的哈希契约：为什么-list-不能当字典的键.md)

---

# Python 的哈希契约：为什么 list 不能当字典的键

上周帮同事看一个缓存问题：他用列表拼了个 key，运行时直接抛出 `TypeError: unhashable type: 'list'`。改成元组就好了。

但另一个更隐蔽的 bug 是：对象明明还在字典里，却怎么也取不出来。这两个问题其实指向同一条规则——**能当字典键的东西，必须遵守哈希契约**。

## 一次 `d[key]` 到底发生了什么

Python 的 `dict` 本质是哈希表。执行 `d[key]` 时，解释器大致做两件事：

1. 计算 `hash(key)`，用结果定位到某个桶；
2. 在桶里用 `==` 比较候选键。

为了效率，比较之前还会先看是不是同一个对象；身份相同就直接命中。

```python
class Key:
    def __init__(self, value):
        self.value = value

    def __hash__(self):
        print(f"hash({self.value})")
        return hash(self.value)

    def __eq__(self, other):
        print(f"eq({self.value}, {getattr(other, 'value', other)})")
        return isinstance(other, Key) and self.value == other.value

d = {Key(1): "a"}
print("--- 查找 ---")
print(d[Key(1)])
```

输出：

```text
hash(1)
--- 查找 ---
hash(1)
eq(1, 1)
a
```

这也解释了字典的两条硬性要求：

- 相等的键必须有相同的哈希；
- 键的哈希在它待在字典里的时候不能变。

违反任何一条，字典就可能找不到东西。

## list 不行，tuple 也不一定行

`list` 是可变的，所以 Python 直接把它的 `__hash__` 设成了 `None`：

```python
print(list.__hash__)      # None
print(hash((1, 2)))       # 正常
print(hash((1, [2])))     # TypeError: unhashable type: 'list'
```

元组本身不可变，但它的哈希是由元素组合出来的。只要里面有一个元素不可哈希，整个元组就不可哈希。这个规则会递归传递：

```python
hash((1, (2, 3)))          # 可以
hash((1, (2, [3])))        # TypeError
```

所以“把 list 改成 tuple”并不是万能药。如果列表里还藏着列表或字典，照样会失败。

## 写了 `__eq__`，`__hash__` 就没了

自定义类默认按身份哈希，也就是基于 `id()`。两个内容相同的对象，默认就是两个不同的键。

一旦你实现了 `__eq__`，Python 会把 `__hash__` 置为 `None`，除非你也显式实现它：

```python
class User:
    def __init__(self, uid, name):
        self.uid = uid
        self.name = name

    def __eq__(self, other):
        return isinstance(other, User) and self.uid == other.uid

print(User.__hash__)      # None
# hash(User(1, "a"))      # TypeError: unhashable type: 'User'
```

补上 `__hash__` 时，字段必须和 `__eq__` 保持一致：

```python
class User:
    def __init__(self, uid, name):
        self.uid = uid
        self.name = name

    def __eq__(self, other):
        return isinstance(other, User) and self.uid == other.uid

    def __hash__(self):
        return hash(self.uid)
```

这里 `name` 可变，但不参与相等判断，也不参与哈希，所以修改它不会破坏字典。

如果整个对象都该不可变，可以用冻结的 dataclass：

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class User:
    uid: int
    name: str
```

默认的 `@dataclass(frozen=True)` 会生成 `__eq__` 和 `__hash__`，并阻止属性赋值。注意它的哈希会用到所有参与比较的字段；如果只想按 `uid` 判等，还是得手写。

## 最隐蔽的坑：键被修改了

下面这段代码不会报错，但会让键“消失”：

```python
class MutableKey:
    def __init__(self, value):
        self.value = value

    def __hash__(self):
        return hash(self.value)

    def __eq__(self, other):
        return isinstance(other, MutableKey) and self.value == other.value

k = MutableKey(1)
d = {k: "one"}

k.value = 2

print(k in d)        # False
print(d.get(k))      # None
print(list(d))       # 键还在字典里
print(d[k])          # KeyError
```

字典并没有坏。它只是按照新的哈希去 2 号桶找，而当初存进去的是 1 号桶。旧条目还在，但已经无法通过这个键访问。

解决办法不是“改完再 rehash”，而是别让键变：

- 用不可变对象当键；
- 只把不会变的字段放进 `__hash__`；
- 真需要可变键，就先删除旧键，改完再插回去。

## 相等但哈希不同，也会出事

还有一种更隐蔽的写法：`__eq__` 按值比较，`__hash__` 却按身份生成。

```python
class BadKey:
    def __init__(self, value):
        self.value = value

    def __eq__(self, other):
        return isinstance(other, BadKey) and self.value == other.value

    def __hash__(self):
        return id(self)

a, b = BadKey(1), BadKey(1)

print(a == b)                 # True
print(hash(a) == hash(b))     # False

d = {a: "a"}
print(d[b])                   # KeyError
print(len({a, b}))            # 2
```

两个对象相等，却被放进了不同的桶。字典既无法保证“一个键只出现一次”，也无法通过等价的键找到值。

## 顺带一提：`1`、`1.0` 和 `True`

```python
d = {1: "int", 1.0: "float", True: "bool"}
print(d)    # {1: 'bool'}
```

三者相等，哈希也相同，所以它们是同一个键，后写入的覆盖先写入的。这不是 bug，而是哈希契约的正常结果。

NaN 则是另一个极端：

```python
nan = float("nan")
d = {nan: "x"}

print(d[nan])             # x，身份相同，直接命中
print(d[float("nan")])    # KeyError，新对象既不等于自己，哈希也不同
```

所以别拿 NaN 当键。如果数据里可能出现 NaN，先清洗再入字典。

## 实践清单

| 想用的键 | 能否直接用 | 建议 |
| --- | --- | --- |
| `int` / `str` / `bytes` | 是 | 不可变，哈希稳定 |
| `tuple` | 视元素而定 | 元素必须全部可哈希 |
| `list` / `dict` / `set` | 否 | 可变，`__hash__` 为 `None` |
| `frozenset` | 是 | 元素必须可哈希 |
| 普通自定义对象 | 是 | 默认按 `id()`，身份语义 |
| 实现了 `__eq__` 但没实现 `__hash__` | 否 | `__hash__` 会被置为 `None` |

几条可以直接照做的建议：

- 组合键优先用元组；嵌套的 list 转成 tuple，dict 转成 `tuple(sorted(d.items()))`，set 转成 `frozenset`。
- 自定义值对象要同时实现 `__eq__` 和 `__hash__`，并保证两者使用同一组字段。
- 对象放进字典后，不要修改参与哈希的字段。
- 需要身份语义时，就用默认的 `object.__hash__` 和 `object.__eq__`，不要多写。
- 调试时可以直接打印 `Cls.__hash__`，或者在修改前后对比 `hash(k)`。

回到开头那个缓存：把 list 换成 tuple 只是第一步，真正要确认的是这个 key 在缓存生命周期里不会变。字典不会帮你检查这件事，它只负责按照你给的哈希去找。哈希契约是调用方和维护者之间的约定，Python 把签字笔递给了你。
