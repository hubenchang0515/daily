> 原文链接：[preload 写了，字体为什么还是下载两遍 - 码日新 · 每日文章](https://daily.xplanc.org/html/preload-写了，字体为什么还是下载两遍.md)

---

# preload 写了，字体为什么还是下载两遍

首屏那行标题明明用的是本地字体，打开 Network 却看到同一个 `inter-latin-400.woff2` 出现了两次：一次 Initiator 是 `(index)`，一次是 `app.css`。更怪的是，第二次刷新后有时又只剩一次。问题通常不在字体文件，而在 preload 和 CSS 发出的两个请求“长得不像”，浏览器没把它们当成同一个资源。

## 先看一个“看起来完全正确”的写法

```html
<!-- 看起来没毛病，但少了 crossorigin -->
<link rel="preload" href="/fonts/inter-latin-400.woff2" as="font" type="font/woff2">
```

CSS 里是这样的：

```css
@font-face {
  font-family: "Inter";
  src: url("/fonts/inter-latin-400.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
```

正确写法只差一个属性：

```html
<head>
  <meta charset="utf-8">
  <link rel="preload"
        href="/fonts/inter-latin-400.woff2"
        as="font"
        type="font/woff2"
        crossorigin>
  <link rel="stylesheet" href="/assets/app.css">
</head>
```

`crossorigin` 不写值等价于 `crossorigin="anonymous"`。字体请求固定走 CORS 模式，哪怕字体和页面同源，preload 也必须带上它，否则两个请求的模式不同，没法复用。

## 浏览器匹配的是“请求”，不只是 URL

preload 的结果要被后续请求命中，下面这些字段都得对上：

| 不一致项 | 常见写法 | 结果 |
| --- | --- | --- |
| CORS / 凭据模式 | preload 没写 `crossorigin` | 同一 URL 下载两次，控制台提示 preloaded but not used |
| 请求目标 | 漏写 `as`，或写成 `as="fetch"` | destination 不匹配，preload 白下载 |
| URL | CSS 里是 `../fonts/x.woff2`，HTML 里写 `/fonts/x.woff2` | 解析后是两个 URL |
| 查询参数 | CSS 带 `?v=3`，preload 没带 | 两个缓存 key |
| `integrity` | preload 写了 SRI，CSS 的 `url()` 没法带 | 匹配失败 |
| `type` | 写成浏览器不支持的 MIME | preload 被直接忽略，只剩 CSS 那次下载 |

所以别只盯着 `href`。把 CSS 里 `url()` 解析后的完整地址抄到 preload，通常比手拼更靠谱。

## 三个最常被忽略的细节

### 1. 同源也要写 crossorigin，但别乱写 use-credentials

空值就够了：

```html
<link rel="preload" href="/fonts/a.woff2" as="font" type="font/woff2" crossorigin>
```

不要顺手写成 `crossorigin="use-credentials"`。它会把凭据模式改成 include，和 CSS 字体请求不一致。除非你确认服务器要求凭据并且返回了精确的 `Access-Control-Allow-Origin`，否则都用默认的 anonymous。

同源不需要额外的 CORS 响应头；跨域时才需要在字体服务器上看：

```bash
curl -I -H 'Origin: https://example.com' \
  https://cdn.example.com/fonts/inter-latin-400.woff2
```

期望看到：

```http
Access-Control-Allow-Origin: https://example.com
```

如果返回的是登录页 HTML，浏览器也会让字体加载失败，这类问题同样会被误判成 preload 失效。

### 2. 相对路径按 CSS 文件解析，不按 HTML 解析

假设 CSS 在 `/assets/app.css`：

```css
@font-face {
  font-family: "Inter";
  src: url("../fonts/inter-latin-400.woff2") format("woff2");
}
```

它请求的是 `/fonts/inter-latin-400.woff2`，不是 `/assets/../fonts/...` 这种字面路径，也不是相对于首页的 `./fonts/...`。preload 里直接写解析后的绝对地址最省心：

```html
<link rel="preload" href="/fonts/inter-latin-400.woff2" as="font" type="font/woff2" crossorigin>
```

构建工具给文件名加 hash 时，模板里也应该用同一个变量输出 `href`，避免 HTML 和 CSS 各写各的。

### 3. 两个 woff2 文件不一定是重复下载

很多字体按 `unicode-range` 切了子集：

```css
@font-face {
  font-family: "Inter";
  src: url("/fonts/inter-latin-400.woff2") format("woff2");
  unicode-range: U+0000-00FF;
}

@font-face {
  font-family: "Inter";
  src: url("/fonts/inter-cjk-400.woff2") format("woff2");
  unicode-range: U+4E00-9FFF;
}
```

中文页面同时下载 Latin 和 CJK 两个文件是正常的。如果你只 preload 了 Latin，而正文主要是中文，反而会看到 `was preloaded using link preload but not used within a few seconds`。先确认控制台里的 URL 到底是“同一个”还是“两个子集”，再决定改哪一处。

## 怎么验证它真的生效了

1. 打开 DevTools → Network，取消 `Disable cache`，右键刷新选择 **Empty Cache and Hard Reload**。
2. 过滤 `woff2`，打开 **Initiator** 列。若同一个 URL 有两行，分别来自 `(index)` 和 `app.css`，就是匹配失败。
3. Console 里搜 `preloaded`，出现 “was preloaded ... but not used” 说明 preload 没被后续请求用上。
4. 再普通刷新一次，Size 列应该显示 `(memory cache)` 或 `(disk cache)`，而不是再次 `200`。

另外，`font-display: swap` 本身就会先显示回退字体再切换，preload 只是缩短这段等待，不等于完全不闪。想避免文字跳动可以试 `font-display: optional`，但慢网络下本次可能一直用回退字体。

## 上线前对照清单

- [ ] `as="font"`、`type="font/woff2"` 写全
- [ ] `crossorigin` 有，且空值或 `anonymous`
- [ ] `href` 与 CSS `url()` 解析后逐字一致，包括查询参数
- [ ] 没乱加 `integrity`，没写 `use-credentials`
- [ ] 只 preload 首屏真的会用到的子集和字重

preload 不是“提前下载就行”，它是在提前发起一个必须能被精确认领的请求。把上面几项对齐，那次多出来的下载才会消失。

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
