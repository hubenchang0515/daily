> 原文链接：[PowerShell 没有“返回数组”这回事 - 码日新 · 每日文章](https://daily.xplanc.org/pwsh/PowerShell-没有“返回数组”这回事.md)

---

# PowerShell 没有“返回数组”这回事

上周同事的脚本在测试环境跑了两周都没问题，上线第一天却失败了。测试库里有几十条记录，生产库那天只有一条。代码没有改，变量却从数组变成了字符串。

这类 bug 在 PowerShell 里很常见，因为 PowerShell 的函数并不“返回”值：它往流里写东西，而调用方拿到的，是这条流被收集之后的结果。

## 函数写的是流

```powershell
function Get-Name {
    'alice'
    'bob'
}

$r = Get-Name
$r.GetType().Name   # Object[]
$r.Count            # 2
```

函数体里每一个没有被消费掉的对象，都会按顺序进入成功流。`return` 并不特殊，它只是“把后面的对象写进流，然后结束函数”。

调用方拿到什么，只取决于流里有几个对象：

| 流里的对象数 | `$r` 是什么 |
| --- | --- |
| 0 | `$null` |
| 1 | 那个对象本身 |
| n | `Object[]` |

所以严格说，PowerShell 里没有“返回一个数组”这个动作，只有“往流里写了 n 个东西，恰好被收集成数组”。

## 只剩一条时，类型就变了

最典型的场景是读日志：

```powershell
function Get-ErrorLine {
    param([string]$Path)
    Get-Content $Path | Where-Object { $_ -match 'ERROR' }
}

$lines = Get-ErrorLine ./app.log
```

`Get-Content` 读到多行时是 `string[]`，读到单行文件时是一个 `string`。于是同一个函数，输出三条错误时返回 `Object[]`，输出一条错误时返回 `String`。接着：

```powershell
$lines[0]        # 三条时是第一行；一条时是这一行的第一个字符
$lines.Length    # 三条时是行数；一条时是字符数
```

`.Count` 是最容易让人误判的。从 PowerShell 3.0 起，标量也被补上了 `Count` 属性，`$lines.Count` 在两种情况下都能正常返回 1 或 3，看起来没有问题。测试数据多的时候一切正常；线上只有一条时，`[0]` 和 `.Length` 已经悄悄换了含义。

零条记录时更隐蔽：

```powershell
$lines = Get-ErrorLine ./empty.log   # $null
$lines.Count                          # 0，看起来正常
$lines[0]                             # $null
$lines.ToString()                     # 空引用异常
```

`$null` 和执行“返回了一个空数组”是两件事，很多下游逻辑区分不出来。

## 管道默认会展开集合

数组进入管道时会被拆成一个个元素：

```powershell
@(1, 2, 3) | ForEach-Object { "item: $_" }    # 三行
,@(1, 2, 3) | ForEach-Object { "item: $_" }   # 一行，$_ 是 1 2 3
```

一元逗号 `,` 构造了一个“只含一个元素的数组”，这个元素才是原数组。管道展开的是外层，里层就保住了。

也不是所有东西都会被展开：

| 对象 | 进入管道后 |
| --- | --- |
| 数组、List、HashSet | 逐个元素 |
| 字符串 | 整体一个 |
| 哈希表 | 整体一个 |
| PSCustomObject | 整体一个 |

哈希表是 `IDictionary`，PowerShell 有意不拆它，否则 `@{a=1}` 会变成一堆 `DictionaryEntry`。

## 反过来：函数会偷偷多返回东西

流的另一个问题是它不挑来源。任何没有落到变量里、没有接 `Out-Null` 的输出，都会混进“返回值”：

```powershell
function Initialize-Workspace {
    param([string]$Path)
    New-Item -ItemType Directory -Path $Path -Force
    Set-Location $Path
    'ready'
}

$result = Initialize-Workspace ./out
$result.GetType().Name   # Object[]，里面是 DirectoryInfo 和 String
```

调用方以为拿到的是 `'ready'`，其实是两个对象。`if ($result)` 永远为真，`.Count` 永远是 2。

方法的返回值也一样：

```powershell
$sb = [System.Text.StringBuilder]::new()
$sb.Append('a')          # 输出的是 StringBuilder 本身
[void]$sb.Append('a')    # 丢弃
$null = $sb.Append('a')  # 同样丢弃

$list = [System.Collections.ArrayList]::new()
$list.Add('a')           # 输出 0，也就是新元素的索引
```

在循环里调 `.Add()`，屏幕上会莫名其妙冒出一串数字，原因就在这里。

## 把边界写明确

| 场景 | 写法 |
| --- | --- |
| 调用方不确定结果有几个 | `$r = @(Get-Thing)` |
| 函数要交出一个集合 | `return ,$arr` |
| 同上，用 cmdlet 语法 | `Write-Output -NoEnumerate $arr` |
| 高级函数里 | `$PSCmdlet.WriteObject($arr, $false)` |
| 调用只为副作用的方法 | `[void]$obj.Method()` |
| 参数必须收数组 | `param([string[]]$Name)` |

空数组的例子最能说明差别：

```powershell
function Get-None  { return @() }
function Get-None2 { return ,@() }

$null -eq (Get-None)    # True，什么都没写进流
$null -eq (Get-None2)   # False，(Get-None2).Count 是 0
```

## 排查时先看类型

遇到“数据少的时候才出错”的脚本，第一步不是读逻辑，而是确认类型：

```powershell
$r.GetType().FullName
@($r).Count
$r | Measure-Object
```

如果函数是你自己写的，就问一句：我是在往流里写东西，还是在交出一个值？前者适合管道，后者就该用 `,`、`-NoEnumerate` 或者 `WriteObject` 把边界钉死。PowerShell 的灵活来自这条流，麻烦也来自这条流。
