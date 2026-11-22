# AGENTS.md

给在本仓库工作的 AI 助手与贡献者的说明。修改生成流程、文章格式或站点结构时，请同步更新本文件。

## 项目概览

- 每日更新中英文编程文章的静态博客，文章由 AI 生成、人工校验后自动发布。
- Next.js（App Router）+ React 19 + Tailwind CSS 4，`output: 'export'` 静态导出到 `out/`。
- 文章是普通 Markdown 文件，没有 frontmatter、数据库或 CMS，直接放在 `daily-document/document/<语言>/<分类>/` 下。
- 站点信息与语言文案集中在 `src/config.ts`，部署目标为 Cloudflare Pages / GitHub Pages。

## 常用命令

```bash
npm install                # 安装依赖

npm run dev                # 本地开发（先拉取 Primers sitemap）
npm run build              # 静态构建，产物在 out/（用任意静态服务器预览，next start 不适用于静态导出）

npm run gen -- <分类> [主题] [-l zh|en] [-m 模型] [-s slug] [--dry-run] [-f]
                           # 生成文章（默认中文）；结束后自动执行 npm run index
npm run index              # 重新生成 README 文章目录（包含所有语言）
npm run index -- -c        # 只检查目录是否最新（过期时退出码非 0）

npm run lint               # ESLint（flat config）
npx tsc --noEmit           # 类型检查

npm run deploy:cf          # 部署到 Cloudflare Pages（wrangler）
npm run deploy:gh          # 部署到 GitHub Pages（gh-pages）
./scripts/pipeline.sh <分类> [语言] [模型]   # 拉取 → 生成 → 构建 → 提交 → 推送 → 部署
```

- `npm run gen` 通过 `opencode run --format json` 调用模型，超时 15 分钟；省略主题时由模型自拟并避开已有标题。
- `--lang en` 生成英文文章到 `daily-document/document/en`，网页路径为 `/en/...`；省略时默认中文。
- `--dry-run` 只打印结果不写文件，同时输出模型的思考过程，适合验证生成效果。
- `predev` / `prebuild` 会执行 `scripts/fetch-primers-sitemap.ts` 拉取 `https://primers.xplanc.org/sitemap.xml` 缓存到 `.cache/`；失败时回退到已有缓存，不阻断构建。

## 目录结构

```
daily-document/document/<语言>/<分类>/<文章>.md   # 全部文章（仓库内目录，不是 submodule）
scripts/generate-article.ts                      # AI 生成文章（唯一的写入入口）
scripts/generate-readme-index.ts                 # README 文章目录（按语言分组）
scripts/fetch-primers-sitemap.ts                 # Primers 外链数据
scripts/pipeline.sh                              # 定时发布流水线
src/app/page.tsx                                 # 按浏览器语言跳转，无法识别时显示语言选择
src/app/[lang]/                                  # 路由：/<语言>、/<语言>/page/N、/<语言>/<分类>、/<语言>/<分类>/page/N、/<语言>/<分类>/<文章>
src/components/Markdown.tsx                      # Markdown 渲染（代码高亮、锚点、外链跳转）
src/utils/document.ts                            # 读取文章列表与内容（创建时间取自 git log）
src/utils/seo.ts                                 # URL 拼接、标题/摘要提取
src/utils/markdown.ts                            # 原文链接块的生成与剥离（中英文）
src/config.ts                                    # 语言、站点、站长、文档路径、友链、广告配置
```

## 文章规范

### 文件与标题

- 文件名即 URL slug，也是页面路径 `/<语言>/<分类>/文件名.md`；使用文章标题作文件名（可含中文）。
- 文章 URL 由文件名直接生成，没有重定向机制：改名等于旧链接 404，优先新增而不是重命名。
- 新增分类只需在 `daily-document/document/<语言>/` 下新建目录，无需改代码；分类按文章数量排序。
- 中英文文章互不翻译、各自独立成文，同一分类名在两种语言下可以复用。
- `normalizeSlug` 会把空白和 `\ / : * ? " < > |` 替换为 `-`，并去掉首尾的 `.`/`-`。
- 第一行必须是 `# 一级标题`，页面标题、列表、SEO 都从这一行读取；没有 frontmatter。
- 摘要取自正文首段（代码块、标题、纯图片行会被跳过），因此首段要能独立概括全文。
- 标题尽量一行内、风格多样，避免反复使用“xx实战”模板。

### 开头与结尾（由脚本自动生成）

`npm run gen` 写文件时的结构固定为：

```markdown
> 原文链接：[标题 - 码日新 · 每日文章](https://daily.xplanc.org/<语言>/<分类>/<文件名>.md)
> Original link: [Title - Code Daily · Daily Articles](https://daily.xplanc.org/<语言>/<分类>/<文件名>.md)

---

# 标题

正文……

## 相关文章 / Related Articles

- [同分类同语言文章标题](https://daily.xplanc.org/<语言>/<分类>/<文件名>.md)
- …（随机 3～5 篇，排除本篇）

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
> This article was generated with AI assistance and reviewed by a human. Corrections are welcome.
```

- 实际文章只保留对应语言的一行原文链接；渲染时由 `stripOriginalLink` 隐藏，用于转载保留出处，不要删除。
- “相关文章”随机挑选同语言同分类下 3～5 篇已有文章；分类内不足 3 篇时取现有全部，为空则省略该区块。
- AI 声明固定在全文最后一行（中文或英文）；手动补写文章时同样要带上这两个区块与声明。

### 正文写作

- 中文，约 1500～2500 字，结构清晰；使用小标题、列表、表格和可运行的代码示例。
- 不要用代码块包裹整篇文章，也不要输出解释、说明或结束语。
- 代码围栏标注语言（如 `python`、`cpp`、`bash`、`html`），页面用 Prism 高亮，`shell` 按 `shell-session` 渲染。
- 行内代码与代码块中的标识符会在渲染时自动匹配 Primers 文档，但同一个文档只在首次出现处转为链接；文章正文末尾会自动以“参考文档”列表汇总（列表预览不插入），这是渲染层行为（`src/utils/primers.ts`），无需手动加链接。
- `h2`～`h6` 的锚点由页面按标题内容哈希自动生成（`#` + SHA-256 前 6 位），不要手写 HTML 锚点。
- 图片使用 Markdown 语法；相对路径以 `daily-document/` 为基准（不是文章所在目录），构建时会被内联为 base64。

## 代码约定

- 路径别名 `@/*` → `src/*`；页面默认是服务端组件，保持静态可预渲染（勿引入只能在运行时执行的动态能力）。
- 站点域名、品牌、描述只能写在 `src/config.ts`；组件与脚本中不要硬编码域名。
- 站内链接统一走 `src/utils/seo.ts`：
  - 页面/元数据：`languagePath`、`absoluteUrl`、`categoryPath`、`articlePath`（后两者第一个参数是语言）；
  - Markdown 文本中的链接：`readableUrl`（保留中文，不转义）。
  - 文件名含 `()`、空格等字符时按 `scripts/generate-readme-index.ts` 的方式转义。
- 根路径 `/` 先显示跳转加载态；静态页面中的内联脚本读取 `navigator.languages`，中文跳 `/zh`、英文跳 `/en`，都不是时再显示语言选择页。
- 旧链接缺少语言前缀时（如 `/linux/xxx.md`），`src/app/not-found.tsx` 会跳转到 `/zh` 加原路径，兼容站内链接迁移前的地址。
- 新增路由时同步更新 `src/app/sitemap.ts`、`src/app/robots.ts`，并实现 `generateStaticParams`（静态导出要求所有路径可枚举）。
- 元数据用 `generateMetadata`，必要时补充 JSON-LD（参考 `src/app/[lang]/[category]/[article]/page.tsx`）。
- 语言列表与文案在 `src/config.ts` 的 `LANGUAGE_CONFIG` 中维护；组件通过 `language` 参数读取，不要硬编码 `zh` 或中文文案。
- 缩进 4 个空格；引号与所在文件保持一致（`src` 内双引号居多，`scripts`/`config.ts` 用单引号）。
- 文章排序与创建时间来自 `git log`：不要 `git mv`、批量重写历史或伪造提交时间，否则首页、分类页与 README 的时间会变。

## 生成与校验

- 修改 `scripts/generate-article.ts` 时：文章模板（原文链接、相关文章、AI 声明）只能在该脚本里维护，不要在别处重复实现。
- README 的文章目录位于 `<!-- ARTICLES:BEGIN -->` 与 `<!-- ARTICLES:END -->` 之间，由 `npm run index` 生成，不要手改。
- 提交前建议执行：

  ```bash
  npm run lint
  npx tsc --noEmit
  npm run index -- -c
  npm run build
  ```

  当前 `npm run lint` 存在历史遗留的 `no-explicit-any` 报错与 `<img>` 警告，目标是“不新增问题”，不要为了清零而大改无关文件。

- 不要提交构建产物与缓存：`out/`、`.cache/`、`next-env.d.ts`、`*.tsbuildinfo` 已在 `.gitignore` 中。

## 发布与环境

- `scripts/pipeline.sh` 是每日定时发布入口（示例 crontab：`0 12 * * * $HOME/Projects/daily/scripts/pipeline.sh linux en`），会依次执行拉取、生成、构建、更新目录、提交、推送与部署；失败会重试 3 次（5s → 10s 退避）。
- 脚本依赖 `~/.nvm/nvm.sh` 与 `~/.opencode/bin`，换机器时按实际情况调整。
- 在 WSL 中工作时先 `source ~/.nvm/nvm.sh`，确保使用 Linux 版 Node/npm；否则可能调用到 `/mnt/c/...` 下的 Windows 版本，在 UNC 路径下会报错。
