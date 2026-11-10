> 原文链接：[Python 的 super() 到底调用了谁 - 码日新 · 每日文章](https://daily.xplanc.org/python/Python-的-super()-到底调用了谁.md)

---

# Python 的 super() 到底调用了谁

写出下面这段代码的时候，十个人里有九个以为 `super()` 就是“调用父类”：

```python
class A:
    def who(self):
        return "A"

class B(A):
    def who(self):
        return "B -> " + super().who()

class C(A):
    def who(self):
        return "C -> " + super().who()

class D(B, C):
    pass

print(D().who())
```

如果 `super()` 的含义是“父类”，那么 `B` 里的 `super().who()` 应该调用 `A`，输出应该是 `B -> A`。实际运行结果是：

```
B -> C -> A
```

`B` 的 `super()` 调到了 `C`——一个和 `B` 没有任何直接继承关系的类。这不是 bug，而是 Python 多重继承的核心设计。

## MRO：类创建时就写死的名单

`super()` 的查找顺序由 MRO（Method Resolution Order，方法解析顺序）决定。MRO 在类**被定义的那一刻**就算好了，存在 `__mro__` 属性里：

```python
>>> D.__mro__
(<class 'D'>, <class 'B'>, <class 'C'>, <class 'A'>, <class 'object'>)
```

`super()` 的真实语义是：以“当前方法定义所在的类”为起点，在**实例类型**的 MRO 名单里，找到排在它后面的、第一个实现了这个方法的类。

`D().who()` 的完整过程是：

1. `D` 自己没有 `who`，沿 MRO 找到 `B.who`，执行；
2. `B.who` 里的 `super().who()` 不是找 `B` 的父类 `A`，而是在 `D` 的 MRO 里找 `B` 后面的下一个——是 `C`；
3. `C.who` 里的 `super().who()` 同理，找到 `A`；
4. 拼出 `B -> C -> A`。

## 名单是怎么排出来的

MRO 用的是 C3 线性化算法，规则可以概括成三条：

- 子类永远排在它的父类前面；
- 多个基类按声明顺序排（`class D(B, C)` 里 `B` 在 `C` 前）；
- 每个类只出现一次，且相对顺序不能和前两条冲突。

第三条不是摆设。有些继承结构就是排不出合法顺序：

```python
class X: pass
class Y(X): pass

class Z(X, Y): pass
```

运行到第三行直接报错：

```
TypeError: Cannot create a consistent method resolution order (MRO) for bases X, Y
```

原因是矛盾：`Z` 的声明要求 `X` 排在 `Y` 前面，而 `Y` 是 `X` 的子类又要求 `Y` 排在前面。遇到这个报错，通常说明继承图本身画歪了，需要拆出一个公共基类来解环。

## super() 不是父类指针

在方法里不带参数写 `super()`，等价于：

```python
super(__class__, self)
```

这里有两个关键角色，各管一件事：

- `type(self)`（实例的实际类型）决定用**哪份 MRO 名单**；
- `__class__`（方法定义所在的类）决定从名单的**哪个位置往后找**。

`__class__` 是编译器自动注入的，你不需要写。也正因为它是编译器魔法，离开类体定义的方法它就不存在了——在模块顶层或者普通函数里调用无参的 `super()`，会得到：

```
RuntimeError: super(): no arguments
```

另外，`super()` 返回的不是父类的实例，而是一个代理对象，它只做一件事：转发属性访问到 MRO 里的下一个类。你也可以手动指定起点，比如 `super(B, self).who()` 表示“从 B 之后开始找”，这在需要跳过某个类的行为时很有用。

## 同一个方法，两种跳转

把上面两件事组合起来，会得到一个更反直觉的现象：

```python
print(B().who())   # B -> A
print(D().who())   # B -> C -> A
```

同样是 `B.who` 里的那行 `super().who()`，两次执行跳到了不同的类：

- `B()` 的实例，`type(self)` 是 `B`，MRO 是 `B, A, object`，从 `B` 往后找到 `A`；
- `D()` 的实例，`type(self)` 是 `D`，MRO 是 `D, B, C, A, object`，从 `B` 往后找到 `C`。

这正是 mixin 能工作的原理：mixin 在写 `super()` 的时候并不需要知道“下一个是谁”，由最终组合它的那个类决定。`super()` 是一条链上的接力棒，而不是一个写死的地址。

## 把 __init__ 写成协作式的

很多人在多重继承里不用 `super()`，而是显式调用父类构造函数，觉得“更可控”：

```python
class A:
    def __init__(self):
        print("A.__init__")

class B(A):
    def __init__(self):
        A.__init__(self)
        print("B.__init__")

class C(A):
    def __init__(self):
        A.__init__(self)
        print("C.__init__")

class D(B, C):
    def __init__(self):
        B.__init__(self)
        C.__init__(self)
        print("D.__init__")

D()
```

输出：

```
A.__init__
B.__init__
A.__init__
C.__init__
D.__init__
```

两个问题：`A` 被初始化了**两次**（如果它是数据库连接池，就是两次握手、两份资源），而且 `C` 的初始化发生在 `B` 之后——顺序也没法沿 MRO 走。全部改用 `super()`：

```python
class A:
    def __init__(self):
        print("A.__init__")

class B(A):
    def __init__(self):
        print("B.__init__")
        super().__init__()

class C(A):
    def __init__(self):
        print("C.__init__")
        super().__init__()

class D(B, C):
    def __init__(self):
        print("D.__init__")
        super().__init__()

D()
```

输出变成：

```
D.__init__
B.__init__
C.__init__
A.__init__
```

每个类恰好一次，严格沿 MRO。这就是“协作式多重继承”：每个 `__init__` 都负责把接力棒传下去，哪怕自己的直接父类是 `object`。

## 参数怎么传

构造函数带参数时，惯用的约定是“各取所需，其余下传”：

```python
class LogMixin:
    def __init__(self, *, log_level="info", **kwargs):
        self.log_level = log_level
        super().__init__(**kwargs)

class Base:
    def __init__(self, name, **kwargs):
        self.name = name
        super().__init__(**kwargs)

class Service(LogMixin, Base):
    def __init__(self, name, **kwargs):
        super().__init__(name=name, **kwargs)

svc = Service("api", log_level="debug")
print(svc.name, svc.log_level)   # api debug
```

链条是 `Service → LogMixin → Base → object`：`LogMixin` 消化 `log_level`，`Base` 消化 `name`，最后 `object.__init__()` 收到空参数。三个要点：

- 链上每一层都要继续调 `super().__init__(...)`，包括最底层的 `Base`；
- 参数统一走 `**kwargs`，每层只取自己认识的，剩下的继续下传；
- 顶层把显式参数收进签名，避免同一个参数在链上被传两遍。

## 四个常见的坑

1. **中途断链。** 链上任何一层忘了调 `super().__init__()`，它之后的所有类都不会被初始化，而且不报错，只会在某个属性缺失时炸出 `AttributeError`，离案发现场很远。
2. **报错位置在 object 上。** 如果某个参数沿途没人消化，最终报的是 `TypeError: object.__init__() takes exactly one argument`。看着像是 `object` 出了问题，其实是链条中某层漏了消化参数。
3. **MRO 冲突。** 出现 `Cannot create a consistent method resolution order` 时，去检查继承图有没有画出矛盾的顺序，而不是去改调用代码。
4. **无参 super() 用错地方。** 它只在类体定义的方法里可用；模块级或普通函数里会得到 `RuntimeError: super(): no arguments`。

排查时最顺手的一招，是在出问题的方法里加一行：

```python
print(type(self).__mro__)
```

把实际生效的名单打出来，再看当前类排在哪、后面是谁，跳转目标一目了然。

## 小结

| 直觉 | 事实 |
| --- | --- |
| `super()` 调用父类 | 在实例类型的 MRO 里，找当前类之后的下一个 |
| MRO 深度优先遍历 | C3 线性化，每类一次，声明顺序不乱 |
| 显式调 `父类.__init__` 更稳 | 会重复执行、打断 MRO 链 |
| mixin 直接父类是 object，不用 super | 恰恰必须 super，下一个是谁由组合方决定 |

记住一句话就够了：`super()` 不是“我的父类”，而是“这条链上，我后面的那位”。至于是谁，得看最终的 MRO 名单——写 mixin 的人不需要知道，组合 mixin 的人才说了算。
