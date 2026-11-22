# 每日文章

AI 驱动的文章博客，每日更新。

<details>

<summary>项目说明</summary>

## AI 生成文章

```bash
npm run gen -- ${分类} ${题目} -m ${模型} -l ${语言}
```

* 省略`题目`时由 AI 自拟
* 省略`模型`时使用 opencode 默认模型
* 省略`语言`时默认中文，使用 `-l en` 生成英文文章

示例：

```bash
# 自拟主题
npm run gen -- linux

# 指定主题
npm run gen -- rust "所有权与借用检查"

# 生成英文文章
npm run gen -- linux "Understanding load average" --lang en
```

## 更新文章目录

README 末尾的文章目录由 `scripts/generate-readme-index.ts` 生成：

```bash
npm run index        # 重新生成
npm run index -- -c  # 仅检查是否最新，过期时退出码非 0
```

`npm run gen` 结束后会自动更新一次。目录内容位于 `<!-- ARTICLES:BEGIN -->` 与 `<!-- ARTICLES:END -->` 之间，无需手动修改。

## 自动发布流水线

使用方法：

```bash
./scripts/pipeline.sh ${分类} ${语言} ${模型}
```

示例：

```bash
./scripts/pipeline.sh linux                     # 中文，默认模型
./scripts/pipeline.sh linux en                  # 英文，默认模型
./scripts/pipeline.sh linux zh "provider/model" # 中文，指定模型（模型放在最后）
```

> 脚本依赖 `~/.nvm/nvm.sh` 与 `~/.opencode/bin`，使用前请按自己的环境调整。

定时自动发布（`crontab -e`）示例：

```shell
0 12 * * * $HOME/Projects/daily/scripts/pipeline.sh linux
0 18 * * * $HOME/Projects/daily/scripts/pipeline.sh linux en
```

* 每天中午 12 点自动发布一篇中文 Linux 文章
* 每天下午 6 点自动发布一篇英文 Linux 文章

## 站点配置

站点信息集中在 `src/config.ts`：

```ts
// 站点共用信息
export const SITE_CONFIG = {
    origin: 'https://daily.xplanc.org', // 配置为你的域名，例如 https://hubenchang0515.github.io
    basePath: '',                       // 配置为基础路径，例如 /daily
    repo: 'https://github.com/hubenchang0515/daily',
    defaultLanguage: 'zh',
}

// 每种语言的标题、描述、界面文案
export const LANGUAGE_CONFIG = {
    zh: {
        title: '每日文章',
        brand: '码日新 · 每日文章',
        description: '苟日新，日日新，又日新。每天一篇通俗易懂的编程实战文章。',
        // …
    },
    en: {
        title: 'Daily Coding Articles',
        brand: 'Code Daily · Daily Articles',
        description: 'One approachable programming article every day.',
        // …
    },
}

// 站长信息
export const OWNER_CONFIG = {
    name: 'AI 助手',
    avatar: SITE_CONFIG.basePath + "/avatar.png",
    username: "hubenchang0515",
    brief: "使用 AI 辅助创作。",
    url: 'https://xplanc.org/',
    email: 'hubenchang0515@gmail.com'
}
```

评论组件 `src/components/Discussion.tsx` 中的 Giscus `repo` / `repoId` 等参数需要替换为你自己的仓库配置。

## 部署

### Cloudflare Pages

```bash
npm run build
npm run deploy:cf 
```

### GitHub Pages

```bash
npm run build
npm run deploy:gh
```

</details>

## 文章目录

<!-- ARTICLES:BEGIN -->
共 84 篇（中文 83 篇，English 1 篇）。

### 中文

#### linux（20）

- 2026-11-22 [负载 12，CPU 却在摸鱼：读懂 Linux 的 load average](https://daily.xplanc.org/zh/linux/负载-12，CPU-却在摸鱼：读懂-Linux-的-load-average.md)
- 2026-11-22 [改了 /etc/hosts，为什么还是连到旧地址](https://daily.xplanc.org/zh/linux/hosts，为什么还是连到旧地址.md)
- 2026-11-22 [关掉终端，进程为什么就没了](https://daily.xplanc.org/zh/linux/关掉终端，进程为什么就没了.md)
- 2026-11-22 [管道里的 count，出了循环就归零](https://daily.xplanc.org/zh/linux/管道里的-count，出了循环就归零.md)
- 2026-11-22 [管道另一头断了：SIGPIPE 与退出码 141](https://daily.xplanc.org/zh/linux/管道另一头断了：SIGPIPE-与退出码-141.md)
- 2026-11-22 [僵尸进程：死了，但还没走](https://daily.xplanc.org/zh/linux/僵尸进程：死了，但还没走.md)
- 2026-11-22 [连接早就关了，端口为什么还占着](https://daily.xplanc.org/zh/linux/连接早就关了，端口为什么还占着.md)
- 2026-11-22 [删掉的大文件，空间为什么没回来](https://daily.xplanc.org/zh/linux/删掉的大文件，空间为什么没回来.md)
- 2026-11-22 [手动能跑，cron 不跑：定时任务的五个隐形坑](https://daily.xplanc.org/zh/linux/手动能跑，cron-不跑：定时任务的五个隐形坑.md)
- 2026-11-22 [文件变了，inotify 为什么没反应](https://daily.xplanc.org/zh/linux/文件变了，inotify-为什么没反应.md)
- 2026-11-22 [终端突然卡住，敲什么都不动：先按 Ctrl+Q](https://daily.xplanc.org/zh/linux/终端突然卡住，敲什么都不动：先按-Ctrl+Q.md)
- 2026-11-22 [Argument list too long：参数撞上的那堵墙](https://daily.xplanc.org/zh/linux/Argument-list-too-long：参数撞上的那堵墙.md)
- 2026-11-22 [chmod 777 之后，为什么还是 Permission denied](https://daily.xplanc.org/zh/linux/chmod-777-之后，为什么还是-Permission-denied.md)
- 2026-11-22 [DNS 又变了：谁在偷偷改写 resolv.conf](https://daily.xplanc.org/zh/linux/DNS-又变了：谁在偷偷改写-resolv.conf.md)
- 2026-11-22 [kill -9 也杀不掉的进程](https://daily.xplanc.org/zh/linux/kill--9-也杀不掉的进程.md)
- 2026-11-22 [Linux 磁盘空间突然满了怎么办：从 df 到 inode 的排查](https://daily.xplanc.org/zh/linux/Linux-磁盘空间突然满了怎么办：从-df-到-inode-的排查.md)
- 2026-11-22 [Linux 的时间为什么会被拨回去](https://daily.xplanc.org/zh/linux/Linux-的时间为什么会被拨回去.md)
- 2026-11-22 [Linux 内存去哪了：一次 OOM Killer 排查实录](https://daily.xplanc.org/zh/linux/Linux-内存去哪了：一次-OOM-Killer-排查实录.md)
- 2026-11-22 [Linux 文件描述符泄漏排查：从 Too many open files 说起](https://daily.xplanc.org/zh/linux/Linux-文件描述符泄漏排查：从-Too-many-open-files-说起.md)
- 2026-11-22 [tail -f 跟着跟着就跟丢了：日志轮转后发生了什么](https://daily.xplanc.org/zh/linux/tail--f-跟着跟着就跟丢了：日志轮转后发生了什么.md)

#### cpp（7）

- 2026-11-22 [表达式里的求值顺序：同一行代码，换个编译器结果就变了](https://daily.xplanc.org/zh/cpp/表达式里的求值顺序：同一行代码，换个编译器结果就变了.md)
- 2026-11-22 [C++ 迭代器失效：删掉一个元素，循环为什么漏掉一个](https://daily.xplanc.org/zh/cpp/C++-迭代器失效：删掉一个元素，循环为什么漏掉一个.md)
- 2026-11-22 [C++ 全局对象的初始化顺序，为什么靠不住](https://daily.xplanc.org/zh/cpp/C++-全局对象的初始化顺序，为什么靠不住.md)
- 2026-11-22 [C++ 条件变量：wait 为什么必须放在 while 里](https://daily.xplanc.org/zh/cpp/C++-条件变量：wait-为什么必须放在-while-里.md)
- 2026-11-22 [C++ 移动语义实战：std::move 之后，对象为什么还有值](https://daily.xplanc.org/zh/cpp/C++-移动语义实战：std-move-之后，对象为什么还有值.md)
- 2026-11-22 [C++ ABI 兼容性实战：改一行头文件为什么会让程序崩溃](https://daily.xplanc.org/zh/cpp/C++-ABI-兼容性实战：改一行头文件为什么会让程序崩溃.md)
- 2026-11-22 [C++ string_view 实战：不拷贝，也不保证活着](https://daily.xplanc.org/zh/cpp/C++-string_view-实战：不拷贝，也不保证活着.md)

#### python（7）

- 2026-11-22 [异步 IO 入门：从阻塞到 asyncio](https://daily.xplanc.org/zh/python/异步-IO-入门：从阻塞到-asyncio.md)
- 2026-11-22 [Python 编码：默认值替你做的决定](https://daily.xplanc.org/zh/python/Python-编码：默认值替你做的决定.md)
- 2026-11-22 [Python 导入机制实战：改了代码为什么不生效](https://daily.xplanc.org/zh/python/Python-导入机制实战：改了代码为什么不生效.md)
- 2026-11-22 [Python 的 super() 到底调用了谁](https://daily.xplanc.org/zh/python/Python-的-super%28%29-到底调用了谁.md)
- 2026-11-22 [Python 的哈希契约：为什么 list 不能当字典的键](https://daily.xplanc.org/zh/python/Python-的哈希契约：为什么-list-不能当字典的键.md)
- 2026-11-22 [Python 缓存实战：lru_cache 的五个坑与正确用法](https://daily.xplanc.org/zh/python/Python-缓存实战：lru_cache-的五个坑与正确用法.md)
- 2026-11-22 [with 离开之后：读懂 Python 的上下文管理器](https://daily.xplanc.org/zh/python/with-离开之后：读懂-Python-的上下文管理器.md)

#### 编程笑话（6）

- 2026-11-22 [「删掉那行代码试试」：程序员的调试玄学](https://daily.xplanc.org/zh/编程笑话/「删掉那行代码试试」：程序员的调试玄学.md)
- 2026-11-22 [「在我机器上是好的」：程序员最诚实的谎言](https://daily.xplanc.org/zh/编程笑话/「在我机器上是好的」：程序员最诚实的谎言.md)
- 2026-11-22 [代码考古指南：如何调查一行祖传代码](https://daily.xplanc.org/zh/编程笑话/代码考古指南：如何调查一行祖传代码.md)
- 2026-11-22 [代码评审黑话词典：LGTM 的十种语气](https://daily.xplanc.org/zh/编程笑话/代码评审黑话词典：LGTM-的十种语气.md)
- 2026-11-22 [所有的临时方案，最后都成了基础设施](https://daily.xplanc.org/zh/编程笑话/所有的临时方案，最后都成了基础设施.md)
- 2026-11-22 [Git 提交信息鉴赏：从 fix 到 fix again](https://daily.xplanc.org/zh/编程笑话/Git-提交信息鉴赏：从-fix-到-fix-again.md)

#### go（6）

- 2026-11-22 [Go 的 defer：return 之后发生的事](https://daily.xplanc.org/zh/go/Go-的-defer：return-之后发生的事.md)
- 2026-11-22 [Go 的 goroutine 泄漏：没人接收的消息去哪了](https://daily.xplanc.org/zh/go/Go-的-goroutine-泄漏：没人接收的消息去哪了.md)
- 2026-11-22 [Go 的 map 被并发写时，为什么连 recover 都救不了](https://daily.xplanc.org/zh/go/Go-的-map-被并发写时，为什么连-recover-都救不了.md)
- 2026-11-22 [Go 切片实战：扩容、共享底层数组与隐藏的内存泄漏](https://daily.xplanc.org/zh/go/Go-切片实战：扩容、共享底层数组与隐藏的内存泄漏.md)
- 2026-11-22 [Go 切片实战：append 之后，原数组为什么变了](https://daily.xplanc.org/zh/go/Go-切片实战：append-之后，原数组为什么变了.md)
- 2026-11-22 [nil 指针，为什么不等于 nil](https://daily.xplanc.org/zh/go/nil-指针，为什么不等于-nil.md)

#### html（6）

- 2026-11-22 [被低估的 details：折叠面板根本不用写 JS](https://daily.xplanc.org/zh/html/被低估的-details：折叠面板根本不用写-JS.md)
- 2026-11-22 [别急着写 JS：用原生 HTML 完成表单校验](https://daily.xplanc.org/zh/html/别急着写-JS：用原生-HTML-完成表单校验.md)
- 2026-11-22 [改了 setAttribute，页面为什么没反应](https://daily.xplanc.org/zh/html/改了-setAttribute，页面为什么没反应.md)
- 2026-11-22 [告别手写遮罩层：用原生 dialog 实现弹窗](https://daily.xplanc.org/zh/html/告别手写遮罩层：用原生-dialog-实现弹窗.md)
- 2026-11-22 [写了 srcset，浏览器为什么还是下载了最大那张图](https://daily.xplanc.org/zh/html/写了-srcset，浏览器为什么还是下载了最大那张图.md)
- 2026-11-22 [preload 写了，字体为什么还是下载两遍](https://daily.xplanc.org/zh/html/preload-写了，字体为什么还是下载两遍.md)

#### rust（6）

- 2026-11-22 [写给线程的闭包，为什么带不走一个借用](https://daily.xplanc.org/zh/rust/写给线程的闭包，为什么带不走一个借用.md)
- 2026-11-22 [Rust 闭包的三张面孔：Fn、FnMut 与 FnOnce](https://daily.xplanc.org/zh/rust/Rust-闭包的三张面孔：Fn、FnMut-与-FnOnce.md)
- 2026-11-22 [Rust 错误处理实战：? 运算符到底替你做成了什么](https://daily.xplanc.org/zh/rust/Rust-错误处理实战：-运算符到底替你做成了什么.md)
- 2026-11-22 [Rust 的 Drop 顺序：谁先走，谁后走](https://daily.xplanc.org/zh/rust/Rust-的-Drop-顺序：谁先走，谁后走.md)
- 2026-11-22 [Rust 的整数溢出：debug 会崩，release 为什么不会](https://daily.xplanc.org/zh/rust/Rust-的整数溢出：debug-会崩，release-为什么不会.md)
- 2026-11-22 [Rust 智能指针实战：Rc、RefCell 与循环引用](https://daily.xplanc.org/zh/rust/Rust-智能指针实战：Rc、RefCell-与循环引用.md)

#### 每周报告（5）

- 2026-11-22 [本周记录：把 SSH 登录收紧了一圈](https://daily.xplanc.org/zh/每周报告/本周记录：把-SSH-登录收紧了一圈.md)
- 2026-11-22 [本周迁移实录：把 pip 换成 uv](https://daily.xplanc.org/zh/每周报告/本周迁移实录：把-pip-换成-uv.md)
- 2026-11-22 [本周清单：让终端活得久一点](https://daily.xplanc.org/zh/每周报告/本周清单：让终端活得久一点.md)
- 2026-11-22 [本周实验：备份只有恢复过才算数](https://daily.xplanc.org/zh/每周报告/本周实验：备份只有恢复过才算数.md)
- 2026-11-22 [本周折腾：监控装好了，告警却没响](https://daily.xplanc.org/zh/每周报告/本周折腾：监控装好了，告警却没响.md)

#### pwsh（5）

- 2026-11-22 [别把 PowerShell 的三种遍历写法当成同义词](https://daily.xplanc.org/zh/pwsh/别把-PowerShell-的三种遍历写法当成同义词.md)
- 2026-11-22 [别用字符串思维写 PowerShell 管道](https://daily.xplanc.org/zh/pwsh/别用字符串思维写-PowerShell-管道.md)
- 2026-11-22 [ConvertTo-Json 默认只转两层，剩下的去哪了](https://daily.xplanc.org/zh/pwsh/ConvertTo-Json-默认只转两层，剩下的去哪了.md)
- 2026-11-22 [PowerShell 错误处理：try/catch 为什么抓不住你的错误](https://daily.xplanc.org/zh/pwsh/catch-为什么抓不住你的错误.md)
- 2026-11-22 [PowerShell 没有“返回数组”这回事](https://daily.xplanc.org/zh/pwsh/PowerShell-没有“返回数组”这回事.md)

#### js（3）

- 2026-11-22 [ESM 循环依赖：为什么 import 进来的是 undefined](https://daily.xplanc.org/zh/js/ESM-循环依赖：为什么-import-进来的是-undefined.md)
- 2026-11-22 [setTimeout(fn, 0) 从来不是立即执行：读懂事件循环](https://daily.xplanc.org/zh/js/setTimeout%28fn,-0%29-从来不是立即执行：读懂事件循环.md)
- 2026-11-22 [structuredClone 复制不了什么](https://daily.xplanc.org/zh/js/structuredClone-复制不了什么.md)

#### qt（3）

- 2026-11-22 [QSettings 写了，重启怎么又没了](https://daily.xplanc.org/zh/qt/QSettings-写了，重启怎么又没了.md)
- 2026-11-22 [Qt 链接报 vtable 未定义，问题常常不在你的代码里](https://daily.xplanc.org/zh/qt/Qt-链接报-vtable-未定义，问题常常不在你的代码里.md)
- 2026-11-22 [Qt 信号槽：槽函数到底在哪个线程执行](https://daily.xplanc.org/zh/qt/Qt-信号槽：槽函数到底在哪个线程执行.md)

#### java（2）

- 2026-11-22 [CompletableFuture 吞掉的异常去哪了](https://daily.xplanc.org/zh/java/CompletableFuture-吞掉的异常去哪了.md)
- 2026-11-22 [Java 线程池实战：核心线程、队列与拒绝策略的三个坑](https://daily.xplanc.org/zh/java/Java-线程池实战：核心线程、队列与拒绝策略的三个坑.md)

#### lua（2）

- 2026-11-22 [Lua 协程：让函数停在半句话上](https://daily.xplanc.org/zh/lua/Lua-协程：让函数停在半句话上.md)
- 2026-11-22 [Lua 元表实战：只读表、默认值与运算符重载](https://daily.xplanc.org/zh/lua/Lua-元表实战：只读表、默认值与运算符重载.md)

#### sql（2）

- 2026-11-22 [NULL 的三值逻辑：查不到、排不掉、算不准](https://daily.xplanc.org/zh/sql/NULL-的三值逻辑：查不到、排不掉、算不准.md)
- 2026-11-22 [SQL 实战：LEFT JOIN 之后，行数为什么变多了](https://daily.xplanc.org/zh/sql/SQL-实战：LEFT-JOIN-之后，行数为什么变多了.md)

#### docker（1）

- 2026-11-22 [docker stop 之后，那十秒在等什么](https://daily.xplanc.org/zh/docker/docker-stop-之后，那十秒在等什么.md)

#### ruby（1）

- 2026-11-22 [block、proc 和 lambda 不是一回事](https://daily.xplanc.org/zh/ruby/block、proc-和-lambda-不是一回事.md)

#### zig（1）

- 2026-11-22 [Zig 没有隐藏的 malloc](https://daily.xplanc.org/zh/zig/Zig-没有隐藏的-malloc.md)

### English

#### python（1）

- 2026-11-22 [Finding Memory Leaks in Python with tracemalloc](https://daily.xplanc.org/en/python/Finding-Memory-Leaks-in-Python-with-tracemalloc.md)
<!-- ARTICLES:END -->
