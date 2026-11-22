> 原文链接：[别把 PowerShell 的三种遍历写法当成同义词 - 码日新 · 每日文章](https://daily.xplanc.org/pwsh/别把-PowerShell-的三种遍历写法当成同义词.md)

---

# 别把 PowerShell 的三种遍历写法当成同义词

PowerShell 里能把一组对象挨个处理的写法至少有三种：`foreach` 语句、`ForEach-Object` cmdlet 和 `.ForEach()` 方法。它们都能循环，名字也像，但输入方式、执行时机、变量作用域和 `break`/`continue` 的行为都不一样。把它们当成同义词，代码通常还能跑，只是会在性能、内存或流程控制上埋坑。

## 先看一张对照表

| 写法 | 类型 | 数据怎么进来 | 当前项 | `break`/`continue` | 典型场景 |
| --- | --- | --- | --- | --- | --- |
| `foreach ($x in $items)` | 关键字语句 | 先拿到完整集合 | 自定义变量，如 `$x` | 正常控制当前循环 | 内存里的集合，需要清晰的流程控制 |
| `$items \| ForEach-Object { ... }` | 管道 cmdlet | 管道逐个传入 | `$_` / `$PSItem` | 不建议使用，会寻找外层循环 | 流式处理，不想一次性攒住所有对象 |
| `$items.ForEach({ ... })` | 集合内置方法 | 已有集合对象 | `$_` / `$PSItem` | 不建议使用，会寻找外层循环 | 已在内存中的集合，想要简洁写法 |

下面用可运行的例子把差别拆开。

## `foreach` 语句：最接近传统循环

`foreach` 是 PowerShell 语言里的关键字，不是管道命令。它的特点很直接：先拿到要遍历的集合，再一项一项执行循环体。

```powershell
$files = Get-ChildItem -Path . -File

foreach ($file in $files) {
    "{0,-30} {1,8} bytes" -f $file.Name, $file.Length
}
```

这里 `Get-ChildItem` 会先执行完，结果放进 `$files`，然后 `foreach` 再遍历。数据量不大时这很清楚；如果上游会产生很多对象，这种写法会先占住内存。

`foreach` 的流程控制最符合直觉：

```powershell
$last = 0

foreach ($n in 1..10) {
    if ($n % 2 -eq 0) { continue }  # 跳过偶数
    if ($n -gt 7) { break }          # 大于 7 就停止
    $last = $n
}

"last = $last"  # last = 7
```

还有一个容易忽略的细节：`foreach` 的循环变量会留在当前作用域里。

```powershell
foreach ($n in 1..3) {
    $n | Out-Null
}

"循环结束后 n = $n"  # 循环结束后 n = 3
```

这不是 bug，但如果后面代码复用了同名变量，可能读到旧值。写脚本时，循环变量名最好明确一些，避免和外层变量混淆。

## `ForEach-Object`：它属于管道，不属于语句

`ForEach-Object` 是 cmdlet，专门吃管道输入。上游每产出一个对象，它就处理一个，处理完再接下一个。

```powershell
Get-ChildItem -Path . -File | ForEach-Object {
    "{0,-30} {1,8} bytes" -f $_.Name, $_.Length
}
```

当前对象通过 `$_`（也可以写 `$PSItem`）访问。因为是流式处理，它很适合“边读边处理”的场景，例如逐行筛选日志：

```powershell
Get-Content -Path .\app.log -ReadCount 1000 | ForEach-Object {
    $_ | Where-Object { $_ -match 'ERROR' }
} | Set-Content -Path .\error.log
```

`Get-Content` 配合 `-ReadCount` 分批读取，`ForEach-Object` 逐批处理，不需要把整个日志文件一次性装进内存。

它还有 `-Begin`、`-Process`、`-End` 三个脚本块，适合做初始化和收尾：

```powershell
1..5 | ForEach-Object -Begin {
    $sum = 0
} -Process {
    $sum += $_
} -End {
    "sum = $sum"  # sum = 15
}
```

PowerShell 7 还给 `ForEach-Object` 增加了 `-Parallel`，可以在多个 runspace 里并行处理：

```powershell
$prefix = "task"

1..3 | ForEach-Object -Parallel {
    "$using:prefix $_ 在 runspace 中执行"
} -ThrottleLimit 3
```

并行脚本块运行在不同的 runspace，访问外部变量要用 `$using:` 前缀。这是 `ForEach-Object` 相比 `foreach` 语句的一个现实优势：需要简单并行时，它现成可用。

### `break` 在这里不是你想的那个 `break`

这是 `ForEach-Object` 最常见的坑。很多人把它当成 `foreach` 的缩写，于是在脚本块里写 `break`，结果跳出了外层循环。

```powershell
foreach ($round in 1..3) {
    "round $round"

    1..5 | ForEach-Object {
        if ($_ -eq 3) { break }  # 不会只停下 ForEach-Object
        "  item $_"
    }
}
```

实际输出是：

```text
round 1
  item 1
  item 2
```

`break` 找的是外层能被打断的循环或 `switch`，它看到的是外面的 `foreach ($round in 1..3)`，于是把整个外层循环停掉了。如果外面没有可打断的循环，行为会更让人困惑。

在 `ForEach-Object` 里，跳过当前对象应该用 `return`：

```powershell
1..5 | ForEach-Object {
    if ($_ -eq 3) { return }  # 跳过当前项，继续下一个
    $_
}
# 输出：1 2 4 5
```

`return` 只退出当前脚本块这一次调用，相当于“跳过这一项”。如果你真的需要“处理到某个条件就提前结束整个遍历”，`foreach` 语句通常比 `ForEach-Object` 更清楚，因为 `break` 的意图一眼就能看出来。

## `.ForEach()` 方法：简洁，但前提是集合已在手里

PowerShell 会给集合对象添加 `.ForEach()` 和 `.Where()` 这类内置方法。它写起来很短：

```powershell
$nums = 1..5
$doubled = $nums.ForEach({ $_ * 2 })
$doubled  # 2 4 6 8 10
```

它和 `ForEach-Object` 一样，用 `$_` 表示当前项，但它不是管道 cmdlet，而是集合对象上的方法。调用它之前，集合已经在内存里了，因此它不适合流式处理。

`.ForEach()` 还有两个实用重载，不用写脚本块：

```powershell
# 取每个对象的属性
(Get-Process | Select-Object -First 3).ForEach('ProcessName')

# 调用每个对象的方法
('hello', 'world').ForEach('ToUpper')
```

性能上，它通常比 `ForEach-Object` 少一些管道开销；和 `foreach` 语句相比则没有绝对结论，差异往往不如代码可读性重要。更该注意的是边界：它不能边接收上游边处理，也不适合在脚本块里用 `break`/`continue` 控制流程，原因和 `ForEach-Object` 类似。

```powershell
$nums = 1..5
$nums.ForEach({
    if ($_ -eq 3) { return }  # 只能跳过当前项
    $_
})
# 输出：1 2 4 5
```

## 怎么选

可以用一个简单的判断顺序：

1. **需要 `break`/`continue`，或者逻辑分支较多**：优先 `foreach` 语句。它最直白，调试也最省心。
2. **数据来自管道，希望边产生边处理**：用 `ForEach-Object`。大文件、长列表、远程查询结果这类场景尤其合适。
3. **数据已经是内存里的集合，只想做简单转换或调用**：`.ForEach()` 很顺手，属性名和方法名的重载也很方便。
4. **看到脚本块里要写 `break`**：停一下，确认自己用的不是 `ForEach-Object` 或 `.ForEach()`。这两者里的 `break` 不会按“当前循环”来理解。

最后还有一个名字陷阱值得记住：在命令位置，`foreach` 是 `ForEach-Object` 的别名；在语句位置，`foreach` 是循环关键字。看起来一样，解析器看到的位置不同，行为也不同。

```powershell
# 这是 ForEach-Object cmdlet（命令位置）
1..3 | foreach { $_ * 2 }

# 这是 foreach 关键字（语句位置）
foreach ($n in 1..3) { $n * 2 }
```

同一个词，两种语法，两套规则。能写 `ForEach-Object` 时，尽量不要依赖 `foreach` 别名；能用 `foreach` 语句表达循环时，也不要把它塞进管道里增加理解成本。把名字写清楚，循环的边界也会清楚很多。

## 相关文章

- [别用字符串思维写 PowerShell 管道](https://daily.xplanc.org/pwsh/别用字符串思维写-PowerShell-管道.md)
- [PowerShell 没有“返回数组”这回事](https://daily.xplanc.org/pwsh/PowerShell-没有“返回数组”这回事.md)
- [ConvertTo-Json 默认只转两层，剩下的去哪了](https://daily.xplanc.org/pwsh/ConvertTo-Json-默认只转两层，剩下的去哪了.md)
- [PowerShell 错误处理：try/catch 为什么抓不住你的错误](https://daily.xplanc.org/pwsh/catch-为什么抓不住你的错误.md)

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
