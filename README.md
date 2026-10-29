# [每日文章](https://daily.xplanc.org/)

AI 驱动的每日文章博客，自动化 GitHub 绿点打卡。

## AI 生成文章

```bash
# 自拟主题
npm run gen -- linux

# 指定主题
npm run gen -- rust "所有权与借用检查"
```

## 自动发布流水线

`scripts/pipeline.sh` 串起了「拉取代码 → 生成文章 → 构建 → 提交 → 部署」的完整的整个流程。

使用方法：

```bash
./scripts/pipeline.sh ${分类} ${模型} 
```

> 脚本依赖 `~/.nvm/nvm.sh` 与 `~/.opencode/bin`，使用前请按自己的环境调整，并日志将写入 `/tmp/daily.log`。

## 站点配置

站点信息集中在 `src/config.ts`：

- `SITE_CONFIG`：域名、`basePath`、标题、品牌、SEO 描述与关键词
- `OWNER_CONFIG`：站长昵称、头像、简介、邮箱
- `DOCUMENT_CONFIG`：文章根目录与分页大小
- `LINKS`：侧边栏外链

部署到子路径（例如 GitHub Pages 的 `/daily`）时，把 `SITE_CONFIG.basePath` 设为对应值即可，`next.config.ts`、sitemap、CSS 背景图都会自动跟随。

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

