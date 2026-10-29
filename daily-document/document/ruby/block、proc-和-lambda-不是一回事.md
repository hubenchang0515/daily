# block、proc 和 lambda 不是一回事

第一次遇到 `LocalJumpError: unexpected return` 的时候，代码看起来毫无问题：一个方法里创建了 `Proc`，存进实例变量，稍后再调用。可只要这个 `Proc` 里写了 `return`，调用时就会炸。把 `proc` 改成 `lambda`，一切又恢复正常。

这不是玄学，而是 Ruby 里 block、proc、lambda 三者在「参数检查」和「控制流」上的语义差异。搞清楚这几点，很多看似奇怪的行为都能解释。

## 先理清关系：block 不是对象

Ruby 里只有 block 是语法结构，不是对象。它只能跟在方法调用后面，通过 `yield` 执行：

```ruby
def each_twice
  yield 1
  yield 2
end

each_twice { |n| puts n }
# 1
# 2
```

想把 block 当值传来传去，必须用 `&` 把它捕获成 `Proc`：

```ruby
def each_twice(&blk)
  blk.call(1)
  blk.call(2)
end
```

反过来，`&` 也能把任何响应 `to_proc` 的对象转成 block，这就是 `map(&:to_s)` 的原理。

proc 和 lambda 都是 `Proc` 的实例，区别藏在内部标志位里：

```ruby
pr = proc { |a, b| }
la = lambda { |a, b| }

pr.class    # => Proc
la.class    # => Proc
pr.lambda?  # => false
la.lambda?  # => true
```

`lambda?` 是唯一可靠的判断方式。下面三条差异，全都源于这个标志。

## 差异一：参数检查的严格程度

proc 对参数极其宽容：多了截断，少了补 `nil`。

```ruby
pr = proc { |a, b| "a=#{a.inspect}, b=#{b.inspect}" }
pr.call(1)        # => "a=1, b=nil"
pr.call(1, 2, 3)  # => "a=1, b=2"
```

lambda 则像普通方法一样严格：

```ruby
la = lambda { |a, b| "a=#{a.inspect}, b=#{b.inspect}" }
la.call(1)
# ArgumentError: wrong number of arguments (given 1, expected 2)
```

这个差异在回调场景里很关键。如果某个库会把不同数量的参数传给你的回调，用 lambda 会直接抛异常，而 proc 会默默吞掉多余参数——后者往往更难排查。

顺带一提，`arity` 也能反映区别：`proc { |a, b| }.arity` 是 `2`，`lambda { |a, b = 1| }.arity` 是 `-2`（负数表示有可选参数）。

## 差异二：return 回到哪里

这是最容易出事的一条。

在 proc 里，`return` 会从**定义 proc 的那个方法**返回：

```ruby
def run_proc
  pr = proc { return :from_proc }
  pr.call
  :never_reached
end

run_proc # => :from_proc
```

而在 lambda 里，`return` 只从 lambda 自身返回，调用它的方法继续往下走：

```ruby
def run_lambda
  la = lambda { return :from_lambda }
  result = la.call
  [:after, result]
end

run_lambda # => [:after, :from_lambda]
```

问题在于，proc 的 `return` 依赖「定义它的方法还活着」。一旦方法已经返回，再调用这个 proc 就无家可归：

```ruby
def build_proc
  proc { return :late }
end

pr = build_proc
pr.call
# LocalJumpError: unexpected return
```

这就是开头那个 bug 的成因。把回调存起来延迟执行时，proc 里的 `return` 是一颗定时炸弹；lambda 则没有这个问题，因为它本来就不向外返回。

值得注意的是，block 的 `return` 语义和 proc 一致，都返回外层方法。所以下面这种写法是成立的：

```ruby
def find_first_even(numbers)
  numbers.each do |n|
    return n if n.even?
  end
  nil
end

find_first_even([1, 3, 4, 5]) # => 4
```

## 差异三：break 和 next

`next` 在两者中行为一致：从当前这次调用返回。

`break` 则不同。在 proc 里，`break` 试图跳出创建它的那个「迭代」，但这个迭代早就不存在了：

```ruby
pr = proc { break 1 }
pr.call
# LocalJumpError: break from proc-closure
```

在 lambda 里，`break` 等价于 `return`，只结束 lambda 自身：

```ruby
la = lambda { break 1 }
la.call # => 1
```

而在普通 block 里，`break` 会让 `yield` 所在的方法立即返回，这也是 `[1, 2, 3].each { break }` 能提前结束循环的原因。

## 一张表总结

| 特性 | block | proc | lambda |
| --- | --- | --- | --- |
| 是否为对象 | 否 | 是（`Proc`） | 是（`Proc`） |
| 参数检查 | 宽松 | 宽松 | 严格 |
| `return` | 返回外层方法 | 返回定义它的方法 | 只返回 lambda 自身 |
| `break` | 结束 `yield` 所在方法 | `LocalJumpError` | 从 lambda 返回 |
| `next` | 结束本次块调用 | 结束本次调用 | 结束本次调用 |
| 创建方式 | `{}` / `do end` | `proc {}`、`Proc.new` | `lambda {}`、`->() {}` |
| 判断 | — | `lambda? == false` | `lambda? == true` |

## 几个容易踩的坑

**1. `define_method` 里不能用 `yield`**

`yield` 依赖词法上包裹它的 `def`。`define_method` 的块定义在类体里，没有这层关系，拿不到调用方传入的块。正确做法是显式声明块参数：

```ruby
class Greeter
  define_method(:hello) do |&blk|
    blk ? blk.call("world") : "hello"
  end
end

Greeter.new.hello                      # => "hello"
Greeter.new.hello { |name| "hi, #{name}" } # => "hi, world"
```

**2. `Proc.new` 不再隐式捕获块**

Ruby 3.0 起，`Proc.new` 在没有显式块时会抛 `ArgumentError`，不再默默抓取当前方法的 block。老代码里这种写法需要改成 `Proc.new(&blk)` 或直接用 `proc`。

**3. 用 `&blk` 捕获是有成本的**

每次调用都会把 block 实例化成 `Proc` 对象。只在确实需要传递、存储或调用 `call` 时才用 `&blk`，否则 `yield` 更轻，也更符合 Ruby 的习惯。判断有没有块用 `block_given?` 即可。

**4. lambda 通过 `&` 传入时仍保持自身语义**

即使被当成 block 传给别的方法，lambda 里的 `return` 依然只退出自己：

```ruby
def wrapper
  yield
  :after_yield
end

la = -> { return :inner }
wrapper(&la) # => :after_yield
```

## 怎么选

默认用 lambda。它的参数检查严格，`return` 不会牵连外层方法，作为回调、存储或跨方法传递时行为可预期。

需要写 DSL、迭代器，或者希望 `return` 能直接从外层方法退出时，用 block 配 `yield`。

proc 的用武之地其实很窄：你明确需要「宽松参数 + 返回定义处」这两个特性同时成立。大多数时候，那只是从旧代码或某个教程里抄来的写法。

判断标准可以简化成一句话：**这个 Proc 会不会在定义它的方法返回之后才被调用？** 会，就别用 proc；不会，也要想清楚 `return` 到底想回到哪一层。

---

> 原文链接：[block、proc 和 lambda 不是一回事](https://daily.xplanc.org/ruby/block%E3%80%81proc-%E5%92%8C-lambda-%E4%B8%8D%E6%98%AF%E4%B8%80%E5%9B%9E%E4%BA%8B.md)
