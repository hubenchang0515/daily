> 原文链接：[管道里的 count，出了循环就归零 - 码日新 · 每日文章](https://daily.xplanc.org/linux/管道里的-count，出了循环就归零.md)

---

# 管道里的 count，出了循环就归零

写 shell 脚本时，统计文件行数是再常见不过的事。不少人会顺手写出 `cat file | while read line; do count=$((count+1)); done`：循环里打印明明一切正常，一出循环，`count` 却又变回了 0。问题不在算术，而在管道右边的循环跑在子 shell 里。它改动的是变量副本，进程一退出，改动也跟着没了。下面把这个现象拆开看：子 shell 的边界到底在哪，怎么把结果带回来，以及 `while read` 另一个常见坑——最后一行为什么会悄悄消失。

## 先把现象摆出来

先看一段看起来没毛病的脚本：

```bash
#!/usr/bin/env bash
count=0
printf 'a\nb\nc\n' | while read -r line; do
    count=$((count + 1))
    printf 'loop: %s -> count=%d\n' "$line" "$count"
done
printf 'final count=%d\n' "$count"
```

输出是：

```
loop: a -> count=1
loop: b -> count=2
loop: c -> count=3
final count=0
```

循环里明明加到了 3，退出循环后又变回了 0。把 `count` 换成数组、`declare -A` 的关联数组，或者在循环里 `cd` 到别的目录，结果都一样：循环里折腾得再热闹，循环外也什么都不知道。

## 管道右边，是一个独立的进程

原因只有一句话：**管道中的每一段命令都运行在自己的子 shell 里**。

`printf ... | while ...` 并不是“把数据喂给同一个 shell 里的循环”，而是启动了两个进程：左边负责往管道写，右边负责从管道读。右边的 `while` 是 bash 在子进程里重新解释执行的，它启动时会复制一份父 shell 的变量环境。子 shell 里对 `count` 的每一次修改，都只发生在这份副本上；进程退出时，副本连同结果一起被回收，父 shell 里的 `count` 从未被碰过。

这一点可以用几个特殊变量直接观察到：

```bash
echo "outside: PID=$$ BASHPID=$BASHPID SUB=$BASH_SUBSHELL"
printf 'x\n' | {
    echo "inside:  PID=$$ BASHPID=$BASHPID SUB=$BASH_SUBSHELL"
}
```

典型输出：

```
outside: PID=1243 BASHPID=1243 SUB=0
inside:  PID=1243 BASHPID=1246 SUB=1
```

这里有个很容易看错的地方：`$$` 在子 shell 里**不会变**，它始终展开为最初那个 shell 的 PID；想拿到当前进程真正的 PID，要用 Bash 4.0 引入的 `$BASHPID`。而 `$BASH_SUBSHELL` 从 0 变成 1，正是“我又套了一层子 shell”的直接证据。以后遇到类似问题，把这三个变量打出来，比猜快得多。

这个规则不是 bash 的 bug，而是 POSIX 对管道的定义。所以 `sh`、zsh 里行为大体一致，只是各自有不一样的“逃生口”。

## 把结果带回来的几种写法

边界搞清楚了，思路也就简单了：让循环留在当前 shell 里跑。

**第一种：用输入重定向替代管道。** 数据本来就在文件里时，这是最干净的做法：

```bash
count=0
while IFS= read -r line; do
    count=$((count + 1))
done < users.txt
printf 'total=%d\n' "$count"
```

`< users.txt` 只是把文件接到循环的标准输入上，`while` 从头到尾都在当前 shell 里执行，变量自然留得住。

**第二种：进程替换。** 数据需要先经过命令处理时，不要写 `cmd | while`，改写成 `while ... < <(cmd)`：

```bash
count=0
while IFS= read -r line; do
    [[ -z $line ]] && continue
    count=$((count + 1))
done < <(grep -v '^#' users.txt)
printf 'total=%d\n' "$count"
```

`<(grep ...)` 会被展开成一个类似 `/dev/fd/63` 的路径，循环用 `<` 从它读取。grep 自己仍然跑在子进程里，但它只是数据源，不影响循环所在的位置。需要过滤、排序、拼接多个来源时，这种写法尤其顺手。

**第三种：开启 lastpipe。** Bash 4.2 以上可以让管道的最后一段留在当前 shell：

```bash
shopt -s lastpipe
set +m                      # 交互式 shell 里需要关掉 job control
count=0
printf 'a\nb\n' | while read -r line; do
    count=$((count + 1))
done
printf 'total=%d\n' "$count"
```

注意两个限制：`lastpipe` 只在 job control 关闭时生效。脚本里通常默认关闭，但在交互式终端里试就得先 `set +m`；另外它只影响最后一段，前面的命令照样是子 shell。因为条件比较苛刻，我一般把它当应急手段，不作为脚本的常规写法。

**第四种：干脆不带出来，让子 shell 把结果说出来。** 如果循环里不需要修改外部状态，只想拿到一个汇总值，那就顺着子 shell 的思路，把结果从标准输出传回来：

```bash
total=$(
    printf 'a\nb\nc\n' | while read -r line; do
        printf '%d\n' "$((++n))"
    done | tail -n 1
)
printf 'total=%s\n' "$total"
```

子 shell 里的 `n` 爱怎么加怎么加，最后一行打印出来即可。当然，如果需求真的只是数行数，`awk 'END { print NR }' users.txt` 更短，没必要为了用 while 而用 while。

把这几种写法放在一起看：

| 写法 | while 运行位置 | 变量能否带出 | 适用场景 |
|---|---|---|---|
| `cmd \| while ...` | 子 shell | 不能 | 循环内自洽，不需要外部状态 |
| `while ... < file` | 当前 shell | 能 | 数据来自文件，首选 |
| `while ... < <(cmd)` | 当前 shell | 能 | 数据来自命令，首选 |
| `shopt -s lastpipe` + 管道 | 当前 shell | 能 | 已有管道不易改，且有版本要求 |

## 顺手补上另一个坑：最后一行去哪了

变量丢失解决了，`while read` 还有另一个容易踩的坑。看这个例子：

```bash
printf 'a\nb' | while read -r line; do
    printf '[%s]\n' "$line"
done
```

输出只有 `[a]`，`b` 不见了。

原因是 `read` 以换行符作为一条记录的结束标志。它读到 `b` 时已经到了文件末尾，虽然把内容放进了变量，但返回码是非零，于是 `while` 认为循环该结束了，循环体没有执行。文本文件如果最后一行没有换行符——比如用 `printf` 生成，或者某些工具导出的文件——就会中招。

修法是给循环再加一个判断：即使 `read` 失败，只要变量非空就再处理一次。

```bash
while IFS= read -r line || [[ -n $line ]]; do
    printf '[%s]\n' "$line"
done < <(printf 'a\nb')
```

这次 `[a]` 和 `[b]` 都会打印出来。文件以换行符正常结尾时，最后一次 `read` 失败且 `line` 为空，`[[ -n $line ]]` 为假，不会多跑一次空行，所以这个写法是安全的。

再说说 `IFS= read -r` 这对老搭档：`-r` 告诉 read 不要把反斜杠当转义字符，`IFS=` 则避免行首行尾的空格和制表符被悄悄裁掉。处理路径、日志、带缩进的配置时，少了它们迟早会出玄学问题。建议把它当成条件反射写进每一条 read。

## 小结

管道里的变量为什么会归零？根子不在变量作用域，而在进程边界：`|` 右边跑的是另一个进程，它改不了你当前 shell 里的状态。用法上记住三点就够：数据在文件里，用 `<` 重定向；数据来自命令，用 `<(cmd)` 进程替换；管道实在改不动，再考虑 `lastpipe`。再把 `IFS= read -r line || [[ -n $line ]]` 养成习惯，`while read` 这套老搭档就不太会再给你惊喜了。

下次发现循环里的计数、数组、`cd` 出了循环就失效，先别怀疑自己的算术，去问问 `$BASH_SUBSHELL` 是多少。

## 相关文章

- [chmod 777 之后，为什么还是 Permission denied](https://daily.xplanc.org/linux/chmod-777-之后，为什么还是-Permission-denied.md)
- [管道另一头断了：SIGPIPE 与退出码 141](https://daily.xplanc.org/linux/管道另一头断了：SIGPIPE-与退出码-141.md)
- [关掉终端，进程为什么就没了](https://daily.xplanc.org/linux/关掉终端，进程为什么就没了.md)

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
