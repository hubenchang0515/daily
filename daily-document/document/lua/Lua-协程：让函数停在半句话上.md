# Lua 协程：让函数停在半句话上

写 Lua 时经常会遇到一种需求：一个函数算到一半，先把结果交出去，等调用方处理完再继续。比如逐行读大文件、遍历一棵树、把分页接口包装成 `for` 循环。用回调写，代码会被拆得七零八落；用数组一次性装下，内存又受不了。

Lua 的协程（coroutine）就是为这种“暂停—恢复”准备的。它不涉及线程，也不涉及调度器，本质上是把函数的执行栈保存下来，之后从原地接着跑。

## resume 和 yield 是一对

`coroutine.create` 接收一个函数，返回一个 thread 对象。第一次 `resume` 开始执行，遇到 `yield` 就停下；再次 `resume` 从 `yield` 处继续。

```lua
local co = coroutine.create(function(a, b)
  print("开始", a, b)
  local c = coroutine.yield(a + b)
  print("恢复时收到", c)
  return "结束"
end)

print(coroutine.resume(co, 1, 2))
-- 开始 1 2
-- true 3

print(coroutine.resume(co, 10))
-- 恢复时收到 10
-- true 结束
```

两个方向都能传值：`resume` 的参数会变成 `yield` 的返回值；`yield` 的参数会变成 `resume` 的返回值。`resume` 的第一个返回值永远是布尔值，表示成功与否，真正的数据排在后面。

## 四种状态

`coroutine.status(co)` 返回四种字符串：

| 状态 | 含义 |
| --- | --- |
| `suspended` | 创建后还没跑，或停在 `yield` 处 |
| `running` | 正在执行 |
| `normal` | 它 resume 了另一个协程，自己暂停等待 |
| `dead` | 函数已返回，或出错终止 |

`normal` 容易被忽略。协程 A 里 resume 协程 B 时，A 的状态就是 `normal`——它还活着，只是不在执行。这也解释了为什么协程不是线程：同一时刻只有一个协程在跑。

## wrap：省掉一层判断

每次 `resume` 都要检查 `ok` 很啰嗦。`coroutine.wrap` 返回一个普通函数，调用它就等于 resume，出错时直接把错误抛出来：

```lua
local gen = coroutine.wrap(function()
  for i = 1, 3 do
    coroutine.yield(i)
  end
end)

print(gen())  --> 1
print(gen())  --> 2
print(gen())  --> 3
```

差别在于错误处理：`resume` 返回 `false, err`，`wrap` 直接 `error`。所以 `wrap` 适合“确定不会出错”的迭代器，`create` 适合需要检查状态、需要清理的场合。`wrap` 还有个限制：拿不到协程对象，没法查 `status`，也没法 `close`。

## 把递归遍历写成 for 循环

协程最实用的场景之一，是把“生产者”包装成迭代器。比如逐行读文件：

```lua
local function read_lines(path)
  local f = assert(io.open(path))
  return coroutine.wrap(function()
    for line in f:lines() do
      coroutine.yield(line)
    end
    f:close()
  end)
end

for line in read_lines("data.txt") do
  print(line)
end
```

注意 `f:close()` 在协程正常跑完时才会执行。如果循环里 `break` 了，协程停在 `yield`，文件要等到被回收才关闭。Lua 5.4 可以用 `<close>` 配合 `coroutine.close` 处理，但 `wrap` 不暴露协程对象，这时得改用 `create`。

递归遍历也一样。Lua 协程是“有栈”的，`yield` 可以写在任意深度的嵌套函数里：

```lua
local function walk(node)
  return coroutine.wrap(function()
    local function visit(n)
      if not n then return end
      visit(n.left)
      coroutine.yield(n.value)
      visit(n.right)
    end
    visit(node)
  end)
end

local tree = {
  value = 2,
  left = { value = 1 },
  right = { value = 3 },
}

for v in walk(tree) do
  io.write(v, " ")  --> 1 2 3
end
```

这一点和 JavaScript 的 generator 不同：JS 里 `yield` 只能出现在 generator 函数体内，Lua 没有这个限制。

## 协程不是线程

协程是协作式的：只有调用 `yield` 才会让出，没人能强行打断它。一个死循环的协程会卡住整个程序。

下面这个轮转调度器能说明问题：

```lua
local queue = {}

local function spawn(fn)
  queue[#queue + 1] = coroutine.create(fn)
end

local function run()
  while #queue > 0 do
    local co = table.remove(queue, 1)
    local ok, err = coroutine.resume(co)
    if not ok then
      print("任务出错:", err)
    elseif coroutine.status(co) ~= "dead" then
      queue[#queue + 1] = co
    end
  end
end

spawn(function()
  for i = 1, 2 do
    print("A", i)
    coroutine.yield()
  end
end)

spawn(function()
  for i = 1, 3 do
    print("B", i)
    coroutine.yield()
  end
end)

run()
-- A 1
-- B 1
-- A 2
-- B 2
-- B 3
```

输出是交替的，但顺序完全由 `yield` 决定。协程适合表达“状态机”和“生产者”，不适合做 CPU 并行。真要并行，还是得靠多进程、多线程或者外部 worker。

## 错误、栈和版本差异

协程里出错，`resume` 返回 `false` 和错误信息，协程随即变成 `dead`。默认的错误信息不带完整调用栈，排查时可以在里面套一层 `xpcall`：

```lua
local co = coroutine.create(function()
  local ok, err = xpcall(function()
    error("boom")
  end, debug.traceback)
  if not ok then error(err, 0) end
end)

local ok, err = coroutine.resume(co)
print(ok)   --> false
print(err)  --> 带完整调用栈的字符串
```

`error(err, 0)` 的 `0` 是为了避免再拼一次位置信息。

几个常见的坑：

- **对 dead 协程再 resume**：报 `cannot resume dead coroutine`。用 `wrap` 时同样会抛错。
- **跨 C 调用边界 yield**：例如在 `table.sort` 的比较函数里 `coroutine.yield()`，会得到 `attempt to yield across a C-call boundary`。C 函数没有保存 continuation，栈回不去。
- **5.1 与 5.2+ 的差异**：5.1 里不能在 `pcall` 内 yield，5.2 起可以；`coroutine.close` 是 5.4 才有的；`coroutine.isyieldable` 是 5.3 才有的。写兼容代码时别假设这些都在。
- **挂起的协程会保住内存**：它的栈和 upvalue 都还在。如果把它塞进全局表又忘了删，这部分内存就回不来。
- **忘记 resume**：创建了协程却没启动，它什么也不会发生；反过来，一直 resume 一个永远不 yield 的协程，它会一口气跑完。

## 什么时候该用

如果一段逻辑需要“多次产出、按需推进”，协程通常比回调清晰：分页拉取、解析流式数据、树的遍历、游戏里的行为脚本。反过来，如果只是普通的一次性计算，或者需要真正的并行，协程只会增加一层看不见的状态。

它的价值不在于快，而在于让调用方用 `for` 和顺序代码，去消费一个本来需要回调才能表达的过程。

---

> 原文链接：[Lua 协程：让函数停在半句话上](https://daily.xplanc.org/lua/Lua-%E5%8D%8F%E7%A8%8B%EF%BC%9A%E8%AE%A9%E5%87%BD%E6%95%B0%E5%81%9C%E5%9C%A8%E5%8D%8A%E5%8F%A5%E8%AF%9D%E4%B8%8A.md)
