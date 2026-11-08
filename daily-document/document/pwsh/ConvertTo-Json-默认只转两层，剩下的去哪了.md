> 原文链接：[ConvertTo-Json 默认只转两层，剩下的去哪了 - 码日新 · 每日文章](https://daily.xplanc.org/pwsh/ConvertTo-Json-默认只转两层，剩下的去哪了.md)

---

# ConvertTo-Json 默认只转两层，剩下的去哪了

如果你曾经把 `ConvertTo-Json` 的输出直接发给后端，又在日志里看到 `"address": "System.Collections.Hashtable"`，那多半不是后端的问题。PowerShell 的 JSON 转换有一套自己的默认值，平时写小脚本感觉不到，一旦数据结构深一点、数组短一点，或者字段里带个时间、大整数，问题就冒出来了。

下面这几个坑，基本覆盖了日常脚本里最常见的翻车现场。

## 默认深度只有 2

先看一段很普通的代码：

```powershell
$payload = @{
    order = @{
        customer = @{
            address = @{
                city = '杭州'
            }
        }
    }
}

$payload | ConvertTo-Json
```

在 Windows PowerShell 5.1 上，输出大致是这样：

```json
{
    "order": {
        "customer": {
            "address": "System.Collections.Hashtable"
        }
    }
}
```

`address` 已经不是一个对象，而是一行字符串。原因是 `ConvertTo-Json` 的 `-Depth` 默认值是 2：`order` 算一层，`customer` 算一层，再往里的 `address` 就不展开了。PowerShell 7 上被截断的层可能显示成 `@{city=杭州}`，具体字符串不同，但结果一样：数据已经变形。

这类问题最阴险的地方是它不报错。你看到的是合法 JSON，只有接收方解析时才发现字段类型不对。

修复方式很直接：

```powershell
$json = $payload | ConvertTo-Json -Depth 10
```

`-Depth` 最大可以写到 100。对于不确定层级的对象，直接给 100 通常比猜一个数字省事。代价是输出会变大，循环引用也会更晚才暴露，所以别把它当成万能药。

验证一下截断是否真的发生了：

```powershell
$back = ($payload | ConvertTo-Json) | ConvertFrom-Json
$back.order.customer.address.city
# 没有输出，因为 address 现在是字符串
```

## 数组只有一个元素时，它就消失了

PowerShell 的管道会自动展开数组。这个特性在 `ForEach-Object` 里很方便，到了 JSON 序列化就成了陷阱：

```powershell
@(42) | ConvertTo-Json
# 42
```

你给的是一个数组，得到的却是一个标量。接收方如果按数组解析，就会直接报类型错误。反方向也一样：

```powershell
'[{"id":1}]' | ConvertFrom-Json
# 返回单个 PSCustomObject，而不是只有一个元素的数组
```

顶层数组经过管道时被枚举，赋值时又因为只有一个结果而被解包。想保留数组结构，序列化时用 `-InputObject`：

```powershell
ConvertTo-Json -InputObject @(42)
# [
#     42
# ]
```

反序列化时用 `@()` 强制包一层：

```powershell
$items = @('{"items":[{"id":1}]}' | ConvertFrom-Json).items
@($items).Count
# 1
```

空数组也值得注意。`@() | ConvertTo-Json` 什么都得不到，而 `ConvertTo-Json -InputObject @()` 会老老实实输出 `[]`。接口里“没有数据”和“字段不存在”是两回事，别让管道把空数组吃掉。

## 时间和大数字都会变样

JSON 没有日期类型，也没有区分整数和浮点数。PowerShell 的类型信息在序列化那一刻就丢了：

```powershell
$o = [pscustomobject]@{
    createdAt = [datetime]'2024-05-01T08:00:00'
    id        = [int64]9223372036854775807
}

$json = $o | ConvertTo-Json
$back = $json | ConvertFrom-Json

$back.createdAt.GetType().Name   # String
$back.id.GetType().Name          # Int64
```

时间回来是字符串，需要自己转：

```powershell
$created = [datetime]$back.createdAt
```

如果原始时间带时区，最好用 `[datetimeoffset]`，否则跨时区比较时容易差几个小时。

大整数更麻烦。超过 `Int64` 范围的值，在 Windows PowerShell 5.1 上会退化成 `Double`，末几位直接变掉。PowerShell 7 对部分大数会给出 `BigInteger`，但不同版本行为并不完全一致。最稳的办法不是研究转换规则，而是别把 ID 当数字传：

```powershell
$o = [pscustomobject]@{
    id = '9223372036854775808'
}
```

订单号、雪花 ID、银行流水号，这些字段在 JSON 里用字符串表示，能省掉一整类精度问题。

## `$null`、缺失字段和大小写

反序列化之后，访问一个不存在的字段不会报错，只会得到 `$null`：

```powershell
$o = '{"id":1}' | ConvertFrom-Json
$o.name
# 没有输出
```

于是 `$o.name -eq $null` 和“字段根本不存在”看起来一模一样。要区分，可以查属性表：

```powershell
$o.PSObject.Properties.Name -contains 'name'
# False
```

PowerShell 6 及以上还可以直接转成哈希表：

```powershell
$h = '{"id":1}' | ConvertFrom-Json -AsHashtable
$h.ContainsKey('name')
# False
```

另外，`PSCustomObject` 的属性名大小写不敏感，`$o.Name` 和 `$o.name` 指向同一个东西。JSON 本身区分大小写，如果上游同时给了 `Name` 和 `name`，在 PowerShell 里就会变得很难说清。接口字段统一用 camelCase 或 snake_case，比事后调试便宜得多。

## 编码和 BOM 也别忽略

Windows PowerShell 5.1 和 PowerShell 7 的默认文本编码不一样：

| 写法 | Windows PowerShell 5.1 | PowerShell 7 |
| --- | --- | --- |
| `Out-File` | UTF-16LE | UTF-8 无 BOM |
| `Set-Content` | ANSI | UTF-8 无 BOM |
| `Set-Content -Encoding utf8` | UTF-8 带 BOM | UTF-8 无 BOM |

用 5.1 写 JSON 文件，很容易写出带 BOM 的 UTF-8，某些严格的 JSON 解析器看到开头三个字节就直接失败。跨版本最稳的写法是显式指定无 BOM：

```powershell
[System.IO.File]::WriteAllText(
    (Join-Path $PWD 'payload.json'),
    $json,
    [System.Text.UTF8Encoding]::new($false)
)
```

通过 HTTP 发送时也一样。5.1 的 `Invoke-RestMethod` 对字符串 Body 的编码处理并不总是符合预期，中文容易变问号。把字符串先转成字节数组，可以避开这个问题：

```powershell
Invoke-RestMethod -Uri $uri -Method Post `
    -ContentType 'application/json; charset=utf-8' `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
```

PowerShell 7 在这方面省心不少，直接传字符串通常就是 UTF-8。

## 一份够用的封装

如果不想每次写 JSON 都检查一遍参数，可以包一个小函数：

```powershell
function ConvertTo-JsonDeep {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, Position = 0)]
        [AllowNull()]
        $InputObject,

        [ValidateRange(1, 100)]
        [int]$Depth = 100,

        [switch]$Compress
    )

    ConvertTo-Json -InputObject $InputObject -Depth $Depth -Compress:$Compress
}
```

调用时：

```powershell
$json = ConvertTo-JsonDeep -InputObject $payload -Compress
```

它做了三件事：默认给足深度、用 `-InputObject` 避免管道展开数组、允许显式传入 `$null`。`-Compress` 在写日志或发请求时能少占一点带宽，排查问题时再去掉它，让输出可读。

## 检查清单

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| JSON 里出现 `System.Collections.Hashtable` | 默认 `-Depth 2` | 显式传 `-Depth 100` |
| 单元素数组变成标量 | 管道枚举 / 单结果解包 | 序列化用 `-InputObject`，反序列化用 `@()` |
| 时间字段变成字符串 | JSON 没有日期类型 | 读取时显式 `[datetime]` 或 `[datetimeoffset]` |
| 大整数末位变化 | 数字精度丢失 | ID 一律用字符串传输 |
| 字段存在性判断不准 | 缺失字段和 `$null` 无法区分 | 查 `PSObject.Properties` 或用 `-AsHashtable` |
| 中文乱码或解析失败 | 5.1 默认 UTF-16/ANSI、BOM | 写文件用无 BOM UTF-8，发请求用字节数组 |

JSON 本身不复杂，复杂的是 PowerShell 在类型、管道和默认参数上替你做的那些决定。把 `-Depth`、`-InputObject` 和编码这三件事固定下来，大部分“数据发过去就变了”的问题就不会再出现。
