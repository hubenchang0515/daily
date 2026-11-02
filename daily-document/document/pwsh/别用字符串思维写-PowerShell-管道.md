> 原文链接：[别用字符串思维写 PowerShell 管道 - 码日新 · 每日文章](https://daily.xplanc.org/pwsh/%E5%88%AB%E7%94%A8%E5%AD%97%E7%AC%A6%E4%B8%B2%E6%80%9D%E7%BB%B4%E5%86%99-PowerShell-%E7%AE%A1%E9%81%93.md)

---

# 别用字符串思维写 PowerShell 管道

在大多数类 Unix Shell 里，管道两端流动的是一行行纯文本。`grep`、`awk`、`cut` 全部都靠切割字符串来达成目标。这种思路渗透太深，很多人刚接触 PowerShell 时也下意识地用同样的方法去写脚本：拿到一串输出、用正则把字段抠出来、再拼接下一条命令。

然而 PowerShell 的管道和 Shell 的文本管道完全不同。它流动的从来都不是字符串，而是 `.NET` 对象。只有先转变这个认知，才能体会到 PowerShell 真正省事的地方，也才不会在后续调试里栽进莫名其妙的坑。

## 1. 文本流和对象流的差距

随便找个场景来对比便一目了然。假设现在要统计本机上所有 `Running` 状态的服务数量。

在传统 Shell 思路下，你可能会先列出服务，再用 `findstr`、`grep` 过滤，再用 `wc` 计数，全程靠文本匹配。

在 PowerShell 里，`Get-Service` 本身就返回的是 `System.ServiceProcess.ServiceController` 类型的对象。每个对象都带着一堆属性：`Name`、`DisplayName`、`Status`、`StartType`、`DependentServices` 等等。你要做的从来不是“找某一行包含 `Running` 的文本”，而是“过滤那些 `Status` 属性等于 `Running` 的对象”。

```powershell
(Get-Service | Where-Object { $_.Status -eq 'Running' }).Count
```

这里没有任何字符串切割。`Where-Object` 直接用对象的属性做判断。等价的写法甚至还能更简短：

```powershell
(Get-Service | Where-Object Status -eq Running).Count
```

PowerShell 在遇到形如 `Where-Object Property -Operator Value` 的简写时，会自动帮你构造对应的过滤表达式。底层还是对象属性对比，只是语法少了几对花括号而已。

更关键的是：过滤完得到的仍然是 `ServiceController` 对象。如果后续还想查找它的二进制路径、依赖关系或者配置信息，完全不用重新解析文本，直接点属性就能用。

## 2. 管道里流动的到底是什么

要理解 PowerShell 管道，得先明白它的处理模型。每当你用 `|` 连接两个 cmdlet 时，左边 cmdlet 产生的对象会一个接一个地送到右边 cmdlet 的管道输入里。

这个过程和遍历数组极为相似，但有个细节常被忽略：很多 cmdlet 都是“流式”工作的。它们不会等所有对象都收齐才开始处理，而是接到一个、处理一个、立刻输出一个。对于上千个对象的场景，这种“边收边产”的方式既省内存也能更快地看到中间结果。

要观察这个过程最简单的方式就是用 `Get-Member`。它能列出对象所有公开的成员，几乎是排查“这个对象到底能用什么”的必备工具。

```powershell
Get-Process -Name pwsh | Get-Member -MemberType Property | Select-Object -First 10
```

运行这段代码会列出 `Process` 对象的属性列表。你会发现诸如 `Id`、`CPU`、`WorkingSet64`、`Path` 之类的东西全都摆在那里，随时可用。换成文本流的世界，你得先用 `tasklist`、`ps` 把这些信息格式化成表格，再想办法从表格里提取数字。

对象流的思路是反过来的：**先拿到完整的“物体”，再按需筛选需要的字段和数据**，而不是先把“物体”砍成一堆字符串再去猜哪里是数字。

## 3. 让自定义函数也能走对象流

既然管道是用来传递对象的，那自定义函数也理所当然该顺应这个约定。PowerShell 提供了 `ValueFromPipeline` 来实现这一点。只有正确地用上它，函数才不会变成“只接受数组参数”的孤岛。

来看一个最贴近日常的例子：计算文件占用的 MB 数。`Get-ChildItem` 返回的是 `FileInfo` 对象，天然就有 `Length` 属性。

```powershell
function ConvertTo-Megabyte {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true, ValueFromPipeline = $true)]
        [System.IO.FileInfo]$File
    )

    begin {
        $total = [int64]0
    }

    process {
        $mb = [Math]::Round($File.Length / 1MB, 2)
        [PSCustomObject]@{
            Name = $File.Name
            SizeMB = $mb
            FullName = $File.FullName
        }
        $total += $File.Length
    }

    end {
        Write-Verbose "共处理 $($total / 1GB) GB 的文件总大小"
    }
}

Get-ChildItem -File -Path $env:USERPROFILE\Documents -Recurse | ConvertTo-Megabyte | Sort-Object SizeMB -Descending | Select-Object -First 10
```

这里有几个要点：

- `ValueFromPipeline = $true`：允许函数直接接收管道传入的 `FileInfo` 对象。
- `begin` 块：在第一个对象到来前执行一次，常用来初始化计数器、建立连接等。
- `process` 块：每接收到一个对象就执行一次，这是处理管道流的核心。几乎所有要对“每个对象”做的操作都该放在这里。
- `end` 块：所有对象都处理完后执行一次，适合汇总、输出报表之类的收束工作。
- 最后用 `[PSCustomObject]` 封装成新对象：输出的结果依旧是对象流，可以继续被 `Sort-Object`、`Where-Object`、`Export-Csv` 等 cmdlet 处理。

如果忘记加 `ValueFromPipeline`，上面那串 `Get-ChildItem ... | ConvertTo-Megabyte` 就会报错，或者意外地把整个数组当成单个 `$File` 来处理。很多初学者栽在这里，根源仍是“用参数接收一堆值”和“用管道接收一连串对象”的概念混淆。

## 4. 用属性思考，而不是用文本解析

对象流最大的回报，是省去了大量脆弱的字符串处理。一旦开始用属性过滤、用属性格式化，脚本不仅更短，还能经受住环境变化的考验。

举个例子：找出所有占用内存超过 500MB 的进程，并只关心进程名、PID、工作集大小。

```powershell
Get-Process | 
  Where-Object { $_.WorkingSet64 -gt 500MB } | 
  Select-Object Name, Id, @{ Name = 'WorkingSetMB'; Expression = { [Math]::Round($_.WorkingSet64 / 1MB, 1) } } | 
  Sort-Object WorkingSetMB -Descending
```

注意 `500MB` 这种写法是 PowerShell 的倍数后缀（`KB`、`MB`、`GB`、`TB`），直接能和整数、长整型做运算。再配合计算属性（`@{Name=...; Expression=...}`），就能在不破坏原始对象的前提下，临时生成一个只为展示用的新字段。

再换个角度：要统计某个文件夹下各扩展名的文件总大小。

```powershell
Get-ChildItem -File -Path 'D:\Projects' -Recurse | 
  Group-Object Extension | 
  ForEach-Object {
      [PSCustomObject]@{
          Extension = if ($_.Name -eq '') { '(no extension)' } else { $_.Name }
          Count     = $_.Count
          TotalMB   = [Math]::Round(($_.Group | Measure-Object Length -Sum).Sum / 1MB, 2)
      }
  } | 
  Sort-Object TotalMB -Descending
```

这里用到了几个极具代表性的对象流 cmdlet：

- `Group-Object`：按指定属性把对象归类，返回的每个分组里都包含 `Name`、`Count` 以及装着该组所有原始对象的 `Group` 属性。
- `ForEach-Object`：遍历每个分组，对其做二次计算。
- `Measure-Object -Sum`：对数值属性求和。它本身也返回对象，而不是直接输出一行数字。

全程都在操作 `FileInfo`、分组对象这类已知类型。要是用文本流来做这件事，光是把 `dir /s` 的结果解析成“扩展名”和“字节数”就得费一番心思，还极易在文件名带空格时出错。

## 5. 小心 `Out-String`，它是对象流的刹车

PowerShell 里最常让人“从对象流掉回文本流”的命令，非 `Out-String` 莫属。

`Out-String` 的职责是“把对象格式化成字符串”。一旦调用它，后续的管道就再也拿不到原始对象了，只能拿到一大段带换行的纯文本。此时再去用 `Where-Object` 按属性过滤，十有八九都会得不到预期结果，甚至完全失效。

来看一个反面示例：

```powershell
# 错误示范：对象流被 Out-String 切断
Get-Process -Name pwsh | Out-String | Where-Object { $_ -match 'Id' }
```

`Out-String` 把整个表格渲染成多行字符串后传下去，`Where-Object` 此时拿到的 `$_` 是一整条“超长字符串”，而不是 `Process` 对象。自然也就找不到 `Id` 这个属性，匹配的逻辑会和你预期大相径庭。

正确的做法是：**在还需要筛选、排序、分组时，绝不要调用 `Out-String`。只有真正要“展示”或者要“传给只认文本的外部程序”时才去用它。**

举个实际场景：要用 `clip.exe` 复制进程列表的文本报表给别人。

```powershell
Get-Process | Format-Table Name, Id, CPU -AutoSize | Out-String | Set-Clipboard
```

这里顺序是对的：先用 `Format-Table` 进行“显示格式化”（它也会产生格式化对象，但对于纯粹的终端展示来说这是最常用的手法），再用 `Out-String` 转成最终要复制的文本，最后交给外部工具处理。注意 `Format-Table`、`Format-List` 这类 `Format-*` cmdlet 本身就更偏“美化输出”，它们产出的主要目的是给人看，而不是给后续 cmdlet 继续加工对象属性。

一个简单的原则可以帮你避开大多数误用：

| 场景 | 建议 |
| --- | --- |
| 还要用 `Where-Object`、`Sort-Object`、`Group-Object` 处理数据 | 保持对象流，直接用对象属性 |
| 要生成 `CSV`、`JSON`、`XML` 供脚本或其他工具解析 | 保持对象流，用 `ConvertTo-Csv`、`ConvertTo-Json` 等转换 cmdlet |
| 要在控制台整齐地打印表格给人阅读 | 用 `Format-Table`，必要时再配 `Out-String` |
| 要把结果原样扔给 `cmd`、`grep`、`sed` 这类外部可执行文件 | 用 `Out-String -Stream` 或直接让外部程序接收，但更常见的是先格式化再转字符串 |

## 6. 用好 `ForEach-Object` 和 `$_`

在对象流里，遍历是家常便饭。PowerShell 提供了两种方式：`foreach` 关键字和 `ForEach-Object` cmdlet。

两者看着像，适用场景却不同：

- `foreach ($item in $collection) { ... }`：是语言结构，运行在当前作用域，通常更快，且能直接用 `break`、`continue` 控制循环。
- `ForEach-Object { ... }`：是 cmdlet，天然就为管道而生。它能直接挂在 `|` 后面，最适合“接收管道对象并逐个处理”的场景。

在脚本块里，当前管道对象可以用 `$_` 或 `$PSItem` 两个变量来引用。它们完全等价，只是 `$PSItem` 可读性略好一些，在有嵌套管道时也不容易和其他语境产生视觉混淆。

再来看看 `ForEach-Object` 的一个进阶用法：配合 `-MemberName`。很多时候你并不想对整个对象操作，只想对某个属性调用方法。

```powershell
# 获取所有 .txt 文件的内容哈希（简化示例思路）
Get-ChildItem -Filter *.txt | ForEach-Object -MemberName FullName | Get-FileHash
```

这里 `-MemberName FullName` 会自动提取每个 `FileInfo` 的 `FullName` 属性值并送给下一个 cmdlet。相比写完整的 `{ $_.FullName }` 脚本块，这种写法更简洁，也更符合“对象流”一气呵成的感觉。

## 7. 从“切字符串”到“选属性”的思维练习

想真正养成对象流思维，最有效的方法就是刻意改掉旧习惯。下次遇到要从命令输出里提取信息时，不要去想“用哪段正则匹配”，先去想“这个对象有哪些属性”。

下面给出几个常用场景的对比，帮你快速转向正确思路。

| 需求 | 文本思维（易错且脆弱） | 对象思维（简洁且健壮） |
| --- | --- | --- |
| 找出所有 IPv4 地址 | 用 `ipconfig` 输出再配合正则匹配 `\d+\.\d+\.\d+\.\d+` | 用 `Get-NetIPAddress -AddressFamily IPv4`，直接拿 `IPAddress`、`InterfaceAlias` 属性 |
| 列出最近修改的 10 个文件 | 解析 `dir` 日期格式再排序 | `Get-ChildItem -File \| Sort-Object LastWriteTime -Descending \| Select-Object -First 10 Name, LastWriteTime` |
| 停止所有处于暂停的打印任务（示意场景） | 从文本表格里提取作业号 | 若存在对应 cmdlet（如 `Get-PrintJob`），直接 `Where-Object JobStatus -eq Paused \| ...` 用属性过滤 |
| 查看特定进程占用的模块路径 | 用任务管理器或者解析模块列表文本 | `Get-Process -Id $pid \| Select-Object -ExpandProperty Modules \| Select-Object ModuleName, FileName` |

注意表格里第二种思路几乎全程都没用 `-match`、`Split()`、`Substring()`。一旦改用 cmdlet 自带的属性过滤，脚本就能自动适配本地化、格式变化甚至不同 PowerShell 版本带来的微小差异。

还有个特别实用的技巧：`Select-Object` 不光能“选列”，还特别擅长“重塑形态”。

```powershell
Get-Service -Name 'WinRM', 'Spooler' | 
  Select-Object @{n='Service';e={$_.DisplayName}}, Status, StartType
```

用计算表达式给列换个更友好的标题，或者临时拼接两个属性，产出的是全新的 `[PSCustomObject]`，依旧能接着往下传递给管道。

## 8. 收束：什么时候该用对象，什么时候该离开对象流

要写出“地道”的 PowerShell，关键不在于“永远不用文本”，而在于**按需切换**。

- **加工阶段：留在对象流**。筛选、关联、统计、转换结构，这些全都该用对象属性去做。此时离开对象流只会徒增解析成本。
- **消费阶段：按目标决定**。要写入文件就用 `Export-Csv`、`Export-Clixml`（适合日后再用 `Import-Clixml` 原样还原对象）；要生成给人看的报告就用 `Format-Table`/`Format-List`；要喂给外部程序就用 `Out-File` 配合合适的格式，或者干脆用 `ConvertTo-Json -Compress` 这种结构化文本。
- **跨进程边界：几乎必然转文本**。一旦调用 `git`、`curl`、`jq`（若用在 Windows）、`robocopy` 这类外部可执行文件，它们只认 stdin/stdout 的字节流。此时再去执着“传对象”毫无意义，反而该老老实实地按外部程序的预期格式传递文本。

顺便提个容易踩的细节：`ConvertTo-Json`、`ConvertTo-Xml` 都是“对象转结构化文本”的 cmdlet，转换后产出的是字符串对象。它们是对象流到文本流的“有序过渡”，远比直接用 `Out-String` 暴力格式化要安全得多。

```powershell
Get-Process -Name pwsh | Select-Object Id, CPU, WorkingSet64 | ConvertTo-Json
```

这段输出能被几乎所有现代工具直接解析，既保留了字段名，又不会被控制台对齐搞得支离破碎。

## 写在最后

学 PowerShell 和学 Shell 最大的转向点，往往就在这一瞬间：**别去问“这一行输出长什么样”，去问“这一批数据本质是什么”**。

如果你习惯了用 `cut` 截取列，就试着用 `Select-Object` 挑选属性。如果你习惯了用 `grep` 匹配行，就试着用 `Where-Object` 匹配属性。如果你习惯了用管道堆砌十个文本工具，就先用 `Get-Member` 看看对象里究竟有什么，再挑一两个对象型 cmdlet 就能顶半个脚本。

管道传递的不是文本碎片，而是带着上下文的“实体”。属性是它的身份证，方法是它的能力。用字符串思维去折腾这些实体永远都有种“隔靴搔痒”的别扭，用对象思维去驾驭它们才会发现：原本要写一长串正则的活，往往只需要短短一行 `Where-Object`。

下次写 PowerShell 脚本时，不妨先停顿半秒，提醒自己一句：**流动在管道里的，是对象。**
