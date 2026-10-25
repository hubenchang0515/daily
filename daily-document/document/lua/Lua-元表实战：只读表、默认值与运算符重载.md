# Lua 元表实战：只读表、默认值与运算符重载

Lua 的表默认只有一种行为：读不存在的键返回 `nil`，写键直接生效，两个表不能相加。元表（metatable）是 Lua 留下的扩展点，它允许我们挂上一组元方法，改变表在索引、赋值、比较、运算、调用和打印时的表现。很多人把元表当成“高级语法”，其实它更像一张钩子表：只有当默认操作需要额外信息时，Lua 才会去元表里找对应的钩子。

本文示例基于 Lua 5.4，可直接保存为 `.lua` 文件后用 `lua 文件名.lua` 运行。

## 元表基础

每个表最多关联一个元表，元表本身也是表。`setmetatable(t, mt)` 会返回 `t`，因此可以嵌套调用；`getmetatable(t)` 用来取回元表。

```lua
local t = {}
local mt = {}

print(setmetatable(t, mt) == t) -- true
print(getmetatable(t) == mt)    -- true
```

常用元方法如下：

| 元方法 | 触发时机 |
| --- | --- |
| `__index` | 读取表中不存在的键 |
| `__newindex` | 给表中不存在的键赋值 |
| `__add`、`__sub`、`__mul`、`__div`、`__mod`、`__pow`、`__unm` | 算术运算 |
| `__concat` | 用 `..` 连接表 |
| `__eq`、`__lt`、`__le` | 比较两个表 |
| `__len` | 对表使用 `#` |
| `__call` | 把表当函数调用 |
| `__tostring` | 对表调用 `tostring` |
| `__metatable` | 保护元表 |

## __index：默认值与继承

当 `t[k]` 的原始值为 `nil` 时，Lua 会检查元表里有没有 `__index`。如果 `__index` 是表，就在那张表上继续查找；如果是函数，就调用 `__index(t, k)`，并把返回值作为查找结果。

一个常见的用途是给配置补默认值：

```lua
local defaults = {
  host = "127.0.0.1",
  port = 8080,
  timeout = 5,
}

local function with_defaults(opts)
  return setmetatable(opts or {}, {__index = defaults})
end

local cfg = with_defaults({port = 9090})

print(cfg.host)            -- 127.0.0.1
print(cfg.port)            -- 9090
print(cfg.timeout)         -- 5
print(rawget(cfg, "host")) -- nil

cfg.host = "0.0.0.0"
print(cfg.host)      -- 0.0.0.0
print(defaults.host) -- 127.0.0.1
```

`rawget` 会绕过元方法，所以它返回 `nil` 说明 `host` 并没有被复制进 `cfg`，只是在读取时临时从 `defaults` 取。给 `cfg.host` 赋值会在 `cfg` 上创建新键，不会污染 `defaults`。

`__index` 也是 Lua 实现继承的基础：

```lua
local Base = {}

function Base.greet(self)
  return "hello, " .. self.name
end

local obj = setmetatable({name = "Lua"}, {__index = Base})
print(obj:greet()) -- hello, Lua
```

`obj:greet()` 等价于 `obj.greet(obj)`。因为 `obj` 本身没有 `greet`，查找会落到 `Base` 上。

## __newindex：拦截写入与只读表

`__newindex` 与 `__index` 对称，但它只在给一个不存在的键赋值时触发。如果键已经存在，赋值就是普通赋值，元方法完全不会参与。

```lua
local t = setmetatable({}, {
  __newindex = function(self, k, v)
    print("write", k, v)
    rawset(self, k, v)
  end,
})

t.a = 1 -- write a 1
t.a = 2 -- 没有任何输出
print(t.a) -- 2
```

这个行为很容易让人写出“看起来只读、其实能改”的表。下面的写法是错的：

```lua
local data = {port = 8080}

setmetatable(data, {
  __newindex = function()
    error("read-only")
  end,
})

data.port = 9090 -- 不会报错，因为 port 已经存在
```

正确做法是用代理表：真实数据藏在闭包里，代理表保持为空，所有读写都经过元方法。

```lua
local function readonly(data)
  return setmetatable({}, {
    __index = data,
    __newindex = function(_, k)
      error("attempt to modify read-only table: " .. tostring(k), 2)
    end,
  })
end

local cfg = readonly({host = "127.0.0.1", port = 8080})
print(cfg.host) -- 127.0.0.1

local ok, err = pcall(function()
  cfg.port = 9090
end)
print(ok)  -- false
print(err) -- ...read-only table: port
```

如果数据是数组，还可以再加一个转发到 `data` 的 `__len`，让 `#proxy` 正常工作。但要注意，这不是安全边界：调用方仍然可以用 `rawset(proxy, "port", 9090)` 绕过限制。元表约束的是正常 API 用法，不是恶意代码。

## 运算符元方法：让表像值对象一样运算

算术和比较元方法可以让表拥有类似数字的语义。以二维向量为例：

```lua
local Vector = {}
Vector.__index = Vector

function Vector.new(x, y)
  return setmetatable({x = x, y = y}, Vector)
end

function Vector.__add(a, b)
  return Vector.new(a.x + b.x, a.y + b.y)
end

function Vector.__eq(a, b)
  return a.x == b.x and a.y == b.y
end

function Vector.__lt(a, b)
  return a.x * a.x + a.y * a.y < b.x * b.x + b.y * b.y
end

function Vector.__le(a, b)
  return a.x * a.x + a.y * a.y <= b.x * b.x + b.y * b.y
end

function Vector.__tostring(v)
  return string.format("(%g, %g)", v.x, v.y)
end

local a = Vector.new(1, 2)
local b = Vector.new(3, 4)

print(tostring(a + b))       -- (4, 6)
print(a == Vector.new(1, 2)) -- true
print(a < b)                 -- true
print(a <= b)                -- true
```

这里把 `Vector` 同时当作构造函数、方法表和实例元表。`Vector.__index = Vector` 让实例在找不到字段时回到 `Vector` 查方法，这是 Lua 里最常见的“类”写法。

几个细节：

- `__eq` 只在两个操作数都是表（或都是 userdata）时才有机会被调用，表与数字比较不会触发它。
- `__lt` 和 `__le` 最好成对实现，避免依赖不同 Lua 版本的默认回退规则。
- `__tostring` 必须返回字符串，否则运行时会报错。
- 如果希望向量能和字符串拼接，可以再实现 `__concat`。

## __call 与 __metatable

`__call` 让表可以像函数一样被调用，适合做带状态的计数器或工厂：

```lua
local counter = setmetatable({n = 0}, {
  __call = function(self, step)
    self.n = self.n + (step or 1)
    return self.n
  end,
})

print(counter())  -- 1
print(counter(5)) -- 6
```

`__metatable` 用来保护元表。一旦设置，`getmetatable` 返回这个值，`setmetatable` 会直接报错：

```lua
local locked = setmetatable({}, {__metatable = "locked"})
print(getmetatable(locked)) -- locked

local ok, err = pcall(setmetatable, locked, {})
print(ok)  -- false
print(err) -- cannot change a protected metatable
```

调试时如果确实需要拿到真实元表，可以用 `debug.getmetatable` 绕过保护。

## 容易踩的坑

1. **`__newindex` 只对不存在的键生效。** 想做严格只读表，必须使用空代理表，不能直接把 `__newindex` 挂在数据表上。
2. **`pairs` 不会走 `__index`。** 代理表本身是空的，`pairs(proxy)` 遍历不到任何东西。需要遍历时，最好在代理上提供一个显式方法，或直接遍历原始数据。
3. **`__eq` 不会跨类型比较。** 表和数字、表和字符串之间的 `==` 不会调用元方法。
4. **`rawget` 和 `rawset` 是逃生舱。** 调试元表问题时它们很好用，但在业务代码里滥用会破坏元表语义。
5. **继承链太长会影响性能，成环会导致无限递归。** `__index` 指向表时会沿着链继续查找，设计时尽量保持层级浅而清晰。

## 小结

元表不是语法糖，而是 Lua 的扩展机制。掌握 `__index` 和 `__newindex`，就能实现默认配置、继承和只读代理；掌握运算符元方法，就能写出可读性更好的领域对象。使用前先想清楚“原始操作在什么条件下才会触发元方法”，再决定用函数还是表，大部分坑都可以提前避开。
