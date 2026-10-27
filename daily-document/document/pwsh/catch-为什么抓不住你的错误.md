# PowerShell 错误处理：try/catch 为什么抓不住你的错误

凌晨两点，同步脚本跑完了。日志里一串红色报错，但脚本继续往下执行，最后打印出「完成，成功 0 个文件」，退出码 0。CI 显示绿色，直到第二天业务方问：数据怎么没更新？

问题不在 `Copy-Item`，而在于 PowerShell 的错误模型和大多数人的直觉不一样：**不是所有错误都会中断执行，也不是所有错误都能被 `try/catch` 捕获**。这篇文章从最小复现开始，把这件事讲清楚。

## 一、PowerShell 有两类错误

PowerShell 把错误分成两类：

- **终止性错误（terminating error）**：像异常一样中断当前语句或管道。`throw`、.NET 方法抛出的异常、以及加了 `-ErrorAction Stop` 的 cmdlet 都属于这一类。
- **非终止性错误（non-terminating error）**：写入错误流后继续执行。大多数内置 cmdlet 的常见失败（路径不存在、权限不足、单个对象处理失败）都是这一类。

关键区别如下：

| 场景 | 默认行为 | `try/catch` 能否捕获 |
| --- | --- | --- |
| `Get-Item` 路径不存在 | 写错误流，继续执行 | 否 |
| `Get-Item -ErrorAction Stop` | 终止 | 是 |
| `throw "..."` | 终止 | 是 |
| .NET 方法抛异常 | 终止 | 是 |
| 原生命令退出码非 0 | 只设置 `$LASTEXITCODE` | 否 |
| `Write-Error` | 非终止 | 否（除非偏好设为 Stop） |

## 二、最小复现

先看不加参数的版本：

```powershell
try {
    Get-Item -Path C:\not-exist
    '这一行仍然会执行'
} catch {
    "捕获到: $($_.Exception.Message)"
}

"脚本继续"
```

输出会是错误信息、`这一行仍然会执行`、`脚本继续`，`catch` 块完全没进去。因为 `Get-Item` 把「找不到路径」当成非终止性错误，写进错误流后正常返回。

加上 `-ErrorAction Stop` 就完全不同：

```powershell
try {
    Get-Item -Path C:\not-exist -ErrorAction Stop
    '不会执行'
} catch {
    "捕获到: $($_.Exception.GetType().Name)"
}
```

这时会输出 `捕获到: ItemNotFoundException`。区别只在这一个参数。

顺带说一句，即使错误被「吞掉」，它仍然会进入自动变量 `$Error`，最近的一条在 `$Error[0]`。PowerShell 7 还提供了 `Get-Error`，可以把 ErrorRecord 的完整结构（包括内部异常和调用栈）展开：

```powershell
Get-Error -InputObject $Error[0]
```

## 三、把错误升级为终止性错误

有三种常见做法，作用范围依次扩大。

**1. 在调用点加 `-ErrorAction Stop`**

推荐优先用这个。范围最小，不会影响其他命令：

```powershell
Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop
```

**2. 设置 `$ErrorActionPreference = 'Stop'`**

适合放在脚本开头，让整个作用域的 cmdlet 默认变成终止性错误：

```powershell
$ErrorActionPreference = 'Stop'
```

注意两点：在函数内部赋值只影响该函数及其子作用域，函数退出后恢复；它**不影响原生命令，也不影响 .NET 方法调用**——后者本来就是终止性的。

**3. 在函数内部主动 `throw`**

自己写的函数，最好把「失败」明确表达出来，而不是靠调用方猜：

```powershell
function Copy-Required {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][string]$Destination
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        throw "源文件不存在: $Source"
    }

    Copy-Item -LiteralPath $Source -Destination $Destination -ErrorAction Stop
}
```

如果希望错误信息更规范（带错误 ID、分类、目标对象），可以用 `$PSCmdlet.ThrowTerminatingError()`：

```powershell
$record = [System.Management.Automation.ErrorRecord]::new(
    [System.IO.FileNotFoundException]::new("找不到 $Source"),
    'SourceNotFound',
    [System.Management.Automation.ErrorCategory]::ObjectNotFound,
    $Source
)
$PSCmdlet.ThrowTerminatingError($record)
```

## 四、原生命令是另一套规则

`git`、`npm`、`docker`、`robocopy` 这些外部程序，失败时只是返回一个非零退出码。PowerShell 不会为此生成 ErrorRecord，`try/catch` 自然抓不到：

```powershell
try {
    git push origin main
    '推送成功'
} catch {
    '这里永远不会执行'
}
```

真正要检查的是 `$LASTEXITCODE`：

```powershell
git push origin main
if ($LASTEXITCODE -ne 0) {
    throw "git push 失败，退出码 $LASTEXITCODE"
}
```

这里有个容易踩的点：**要在命令执行后立刻检查**。`$LASTEXITCODE` 会一直保留到下一个原生命令执行，中间插入几条 cmdlet 并不会更新它，容易误判。

另外，给原生命令加 `-ErrorAction Stop` 是无效的，它会被当作普通参数传给对方。PowerShell 7.3 引入了 `PSNativeCommandErrorActionPreference` 实验特性（对应变量 `$PSNativeCommandUseErrorActionPreference`），开启后非零退出码可以按错误偏好处理。但不同版本默认状态不一致，跨版本脚本不要依赖它，显式检查退出码更稳。

一个可复用的小封装：

```powershell
function Invoke-Native {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(ValueFromRemainingArguments)][string[]]$ArgumentList
    )

    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath 退出码 $LASTEXITCODE"
    }
}

Invoke-Native git status --short
```

## 五、catch 块里到底有什么

`catch` 里的 `$_` 是一个 `ErrorRecord`，常用字段如下：

| 属性 | 用途 |
| --- | --- |
| `$_.Exception.Message` | 给人看的错误描述 |
| `$_.Exception.GetType().Name` | 异常类型，适合分支判断 |
| `$_.CategoryInfo.Category` | 错误分类，如 `ObjectNotFound` |
| `$_.FullyQualifiedErrorId` | 稳定的错误标识，适合做判断 |
| `$_.TargetObject` | 出错的对象，通常是路径或参数 |
| `$_.ScriptStackTrace` | 脚本级调用栈，排查深层函数很有用 |
| `$_.InvocationInfo.PositionMessage` | 出错行及上下文 |

需要按类型分别处理时，写多个 `catch`，**具体的放前面**：

```powershell
try {
    Get-Item -LiteralPath $path -ErrorAction Stop
} catch [System.Management.Automation.ItemNotFoundException] {
    "路径不存在: $path"
} catch [System.UnauthorizedAccessException] {
    "没有权限: $path"
} catch {
    "其他错误: $($_.Exception.Message)"
}
```

如果只是记录后继续往上抛，用不带表达式的 `throw` 可以保留原始错误：

```powershell
catch {
    Write-Warning "处理 $($_.TargetObject) 失败: $($_.Exception.Message)"
    throw
}
```

不要写成 `throw $_.Exception.Message`，那样会丢掉类型、错误 ID 和调用栈，只剩一句字符串。

## 六、几个高频坑

**1. `SilentlyContinue` 和 `try/catch` 一起用**

```powershell
try {
    Get-Item -Path $path -ErrorAction SilentlyContinue -ErrorAction Stop
} catch { }
```

后一个 `-ErrorAction` 会覆盖前一个，实际是 Stop。但如果是 `-ErrorAction SilentlyContinue` 配 `try/catch`，错误被丢弃且不终止，`catch` 不会执行。要收集错误又不想中断，用 `-ErrorVariable`：

```powershell
$errs = @()
Get-ChildItem -Path C:\data -Recurse -ErrorAction SilentlyContinue -ErrorVariable +errs
"共 $($errs.Count) 个错误"
```

注意 `SilentlyContinue` 仍会写入 `$Error`，而 `Ignore` 不会。

**2. 用 `2>&1` 合并流**

`2>&1` 会把错误对象混进成功管道，后面的 `ForEach-Object` 可能拿到 ErrorRecord 却当成正常数据处理，报出更难懂的错误。需要区分时，优先用 `-ErrorVariable` 或分开两次调用。

**3. 全局 Stop 让「可容忍的错误」变成致命错误**

脚本开头设了 `$ErrorActionPreference = 'Stop'`，然后执行 `Get-ChildItem C:\ -Recurse`，第一个「拒绝访问」就会中断整个扫描。对这类命令要单独降级：

```powershell
Get-ChildItem -Path C:\ -Recurse -ErrorAction SilentlyContinue -ErrorVariable scanErrors
```

**4. 并行 runspace 里的异常不会自动冒泡**

`ForEach-Object -Parallel` 在独立 runspace 中执行，内层的失败默认不会终止外层脚本，调用方的 `$ErrorActionPreference` 也不一定按预期生效。稳妥做法是在脚本块内自己 `try/catch`，把结果整理成对象返回。

**5. 拼写错误静默通过**

`$fileNmae` 这种笔误在默认模式下只得到 `$null`，不会报错。脚本开头加一行能省掉大量排查时间：

```powershell
Set-StrictMode -Version Latest
```

未初始化变量、不存在的属性都会直接报错。

## 七、两个可直接套用的骨架

**快速失败型**：适合一次性任务，任何一步失败就停。

```powershell
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Source,
    [Parameter(Mandatory)][string]$Destination
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

trap {
    [Console]::Error.WriteLine("失败: $($_.Exception.Message)")
    exit 1
}

$files = Get-ChildItem -LiteralPath $Source -File
foreach ($file in $files) {
    Copy-Item -LiteralPath $file.FullName -Destination $Destination
}

"已复制 $($files.Count) 个文件"
```

`trap` 捕获当前作用域内未处理的终止性错误；`exit 1` 保证用 `pwsh -File script.ps1` 调用时进程退出码非 0，CI 才能正确判断。

**批量容错型**：适合同步、迁移这类「个别失败不影响整体」的任务，把错误变成数据。

```powershell
$report = foreach ($file in $files) {
    try {
        Copy-Item -LiteralPath $file.FullName -Destination $Destination -ErrorAction Stop
        [pscustomobject]@{ File = $file.Name; Ok = $true; Error = '' }
    } catch {
        [pscustomobject]@{ File = $file.Name; Ok = $false; Error = $_.Exception.Message }
    }
}

$report | Format-Table -AutoSize

if ($report.Ok -contains $false) {
    exit 1
}
```

这样既有逐条明细，又能让流水线拿到正确的退出码。

## 小结

记住三句话就够了：内置 cmdlet 默认「报错但继续」，要捕获就加 `-ErrorAction Stop`；原生命令只看 `$LASTEXITCODE`，`try/catch` 管不着；需要让调用方感知失败时，用 `throw` 而不是 `Write-Error`。把这三点落实到脚本骨架里，凌晨两点那类「显示成功但其实没干活」的问题，基本可以绝迹。

---

> 原文链接：[PowerShell 错误处理：try/catch 为什么抓不住你的错误](https://daily.xplanc.org/pwsh/catch-%E4%B8%BA%E4%BB%80%E4%B9%88%E6%8A%93%E4%B8%8D%E4%BD%8F%E4%BD%A0%E7%9A%84%E9%94%99%E8%AF%AF.md)
