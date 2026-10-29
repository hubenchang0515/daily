# [每日文章](https://daily.xplanc.org/)

AI 驱动的每日文章博客，自动化 GitHub 绿点打卡。

## AI 生成文章

```bash
npm run gen -- ${分类} ${题目} -m ${模型}
```

* 省略`题目`时由 AI 自拟
* 省略`模型`时使用 opencode 默认模型

示例：

```bash
# 自拟主题
npm run gen -- linux

# 指定主题
npm run gen -- rust "所有权与借用检查"
```

## 自动发布流水线

使用方法：

```bash
./scripts/pipeline.sh ${分类} ${模型}
```

> 脚本依赖 `~/.nvm/nvm.sh` 与 `~/.opencode/bin`，使用前请按自己的环境调整。

定时自动发布（`crontab -e`）示例：

```shell
0 12 * * * $HOME/Projects/daily/scripts/pipeline.sh linux
```

* 每天中午 12 点自动发布一篇 Linux 的文章

## 站点配置

站点信息集中在 `src/config.ts`：

```ts
// 站点信息
export const SITE_CONFIG = {
    origin: 'https://daily.xplanc.org', // 配置为你的域名，例如 https://hubenchang0515.github.io
    basePath: '',                       // 配置为基础路径，例如 /daily
    title: '每日文章',
    brand: '码日新 · 每日文章',
    slogan: '书到用时方恨少，事非经过不知难。',
    repo: 'https://github.com/hubenchang0515/daily',
    description: '苟日新，日日新，又日新。每天一篇通俗易懂的编程实战文章，涵盖 Python、Linux、Lua、HTML。',
    keywords: ['码日新', '编程日课', '每日文章', '编程实战', 'Python', 'Linux', 'Lua', 'HTML', 'AI 编程', '技术博客'],
    locale: 'zh_CN',
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

