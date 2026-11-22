> 原文链接：[Kotlin 扩展函数：写在类外面的方法，运行时去哪了 - 码日新 · 每日文章](https://daily.xplanc.org/zh/kotlin/Kotlin-扩展函数：写在类外面的方法，运行时去哪了.md)

---

# Kotlin 扩展函数：写在类外面的方法，运行时去哪了

给 `String` 加一个 `lastChar()`，调用起来就像它本来就属于 `String`：

```kotlin
fun String.lastChar(): Char = this[length - 1]

fun main() {
    println("kotlin".lastChar()) // n
}
```

写法很自然，于是很多人顺手把它用在继承体系里，然后被输出结果教育了一次。

## 一个和直觉不符的输出

```kotlin
open class Animal
class Dog : Animal()

fun Animal.speak() = "..."
fun Dog.speak() = "汪汪"

fun main() {
    val dog: Dog = Dog()
    val animal: Animal = dog

    println(dog.speak())    // 汪汪
    println(animal.speak()) // ...
}
```

同一个对象，只因为变量的**声明类型**不同，调用了不同的函数。更典型的是下面这种：

```kotlin
open class Base {
    open fun run() = "member base"
}

class Sub : Base() {
    override fun run() = "member sub"
}

fun Base.run() = "extension base"

fun main() {
    println(Base().run()) // member base
    println(Sub().run())  // member sub
}
```

`fun Base.run()` 从来没有被调用过。IDE 甚至会提示“扩展函数被成员函数遮蔽”。原因不在 Kotlin 的脾气，而在它的实现方式。

## 它其实是第一个参数

Kotlin 的扩展函数没有修改被扩展的类。编译之后，它就是一个普通的静态方法，接收者变成了第一个参数：

```kotlin
// Demo.kt
package demo

fun String.lastChar(): Char = this[length - 1]
```

用 `javap` 看生成的字节码：

```text
public final class DemoKt {
  public static final char lastChar(java.lang.String);
}
```

所以 `"kotlin".lastChar()` 在 JVM 上约等于 `DemoKt.lastChar("kotlin")`。这也解释了几件事：

- 从 Java 调用时没有点号语法，只能写 `DemoKt.lastChar("kotlin")`；
- 文件名会变成类名，可以用 `@file:JvmName("StringUtils")` 改掉；
- 扩展函数不能访问类的 `private` / `protected` 成员，它只是个外部函数；
- 扩展函数不能被 `open`、`override`，因为它根本不在类的虚函数表里。

调用哪个扩展函数，在**编译期**就按表达式的静态类型定死了。运行时对象是谁，不参与这个决定。这就是“静态解析”。

## 成员函数为什么总是赢

Kotlin 的解析顺序很明确：先找成员，再找扩展。只要成员函数在签名上匹配，扩展函数就没有机会。

```kotlin
class User {
    fun name(): String = "member"
}

fun User.name(): String = "extension"

fun main() {
    println(User().name()) // member
}
```

同理，成员属性也会遮蔽同名的扩展属性。所以给一个已有同名方法的类写扩展，通常是在制造一段永远不会执行的代码。

如果确实需要多态，扩展函数不是正确工具，应该回到接口或密封类：

```kotlin
sealed interface Shape {
    fun area(): Double
}

data class Circle(val r: Double) : Shape {
    override fun area() = Math.PI * r * r
}

data class Rect(val w: Double, val h: Double) : Shape {
    override fun area() = w * h
}

fun total(shapes: List<Shape>) = shapes.sumOf { it.area() }
```

把 `area()` 写成 `fun Circle.area()`、`fun Rect.area()`，`List<Shape>` 上就没法统一调用了，因为扩展函数不参与动态分派。

## 扩展属性没有幕后字段

扩展属性看起来像属性，实际上只有 getter/setter：

```kotlin
val String.lastChar: Char
    get() = this[length - 1]
```

它不能有初始化器，也不能写 `field`：

```kotlin
// 编译错误：扩展属性不能有幕后字段
val String.cached: Int = 42
```

这意味着每次访问都会重新计算。想缓存结果，只能自己找地方存，比如外部 `Map`，但那会引入生命周期和内存泄漏问题。需要状态时，老老实实写一个类，通常比扩展属性更清楚。

## 泛型擦除带来的签名冲突

下面两个扩展函数在源码里类型不同，在 JVM 上却都是 `second(List)`：

```kotlin
fun List<Int>.second(): Int = this[1]
fun List<String>.second(): String = this[1]
```

编译器会报平台声明冲突。解决办法是用 `@JvmName` 给其中一个换名字：

```kotlin
@JvmName("secondInt")
fun List<Int>.second(): Int = this[1]

@JvmName("secondString")
fun List<String>.second(): String = this[1]
```

Kotlin 侧调用不受影响，Java 侧会看到两个不同名字的静态方法。这是泛型擦除的老问题，只是扩展函数让它更容易撞上。

## 两个接收者：成员扩展函数

扩展函数也可以写在类里面，这时它有两个接收者：

```kotlin
class Html {
    fun String.bold(): String = "<b>$this</b>"

    fun render(): String = "hi".bold()
}

fun main() {
    println(Html().render()) // <b>hi</b>
}
```

在 `bold()` 内部：

- `this` 是扩展接收者，也就是那个 `String`；
- `this@Html` 才是分发接收者，也就是 `Html` 实例。

编译后它是 `Html` 的一个实例方法，签名是 `bold(String)`。调用时必须有一个 `Html` 实例在作用域里，所以常配合 `with` 或带接收者的 lambda 使用，这也是 Kotlin DSL 的基础：

```kotlin
fun html(block: Html.() -> Unit): Html = Html().apply(block)

val page = html {
    render()
}
```

## 什么时候该用，什么时候不该

| 需求 | 扩展函数 | 成员函数 / 接口 |
| --- | --- | --- |
| 给第三方或 final 类加工具方法 | 合适 | 改不了 |
| 需要子类改变行为 | 不合适 | 合适 |
| 需要保存状态 | 不合适 | 合适 |
| 构建 DSL | 合适 | 一般 |
| 包装可空值、提供默认值 | 合适 | 视情况 |

一个实用的判断标准：**如果你希望“运行时对象是谁”来决定行为，就不要用扩展函数。** 扩展函数适合做无状态的工具、语法糖和 DSL，不适合伪装成类的一部分去参与继承。

理解它编译后只是一个静态方法，很多“为什么没走我的实现”“为什么子类没生效”的问题就都有答案了。

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
