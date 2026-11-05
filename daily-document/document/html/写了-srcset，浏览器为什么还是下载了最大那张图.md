> 原文链接：[写了 srcset，浏览器为什么还是下载了最大那张图 - 码日新 · 每日文章](https://daily.xplanc.org/html/写了-srcset，浏览器为什么还是下载了最大那张图.md)

---

# 写了 srcset，浏览器为什么还是下载了最大那张图

一位同事给首页大图配了三档 `srcset`：640w、1280w、2560w。本地用手机模拟器看，Network 面板里老老实实加载了 640w；上线后看 CDN 统计，移动端流量最大的文件却是 2560w。

代码没写错，`srcset` 的语法也挑不出毛病。问题出在另一个属性上：`sizes` 没写，或者写了却没和真实布局对上。

## srcset 是候选集，不是加载列表

先明确一点：`srcset` 里的多个地址不会依次加载，浏览器只会从中挑一个。

```html
<img
  src="hero-1280.jpg"
  srcset="hero-640.jpg 640w,
          hero-1280.jpg 1280w,
          hero-2560.jpg 2560w"
  alt="首页大图">
```

上面的写法里，`640w`、`1280w`、`2560w` 是**宽度描述符**，表示这个文件本身的像素宽度。浏览器拿它和“图片即将被显示多宽”做比较，再结合设备像素比（DPR）决定下载哪一张。

注意：只要 `srcset` 用了 `w` 描述符，在支持 `srcset` 的浏览器里，`src` 就不再参与候选选择，只作为老浏览器的兜底。所以 `src` 写多大都行，但别指望它能“保底”。

## w 描述符必须配合 sizes

`w` 只说了图片有多宽，没说它会被显示多宽。这个信息由 `sizes` 提供。

```html
<img
  src="hero-1280.jpg"
  srcset="hero-640.jpg 640w,
          hero-1280.jpg 1280w,
          hero-2560.jpg 2560w"
  sizes="(min-width: 960px) 720px, 100vw"
  width="1280"
  height="720"
  alt="首页大图">
```

这段 `sizes` 的意思是：

- 视口宽度 ≥ 960px 时，图片槽位按 720 CSS px 计算；
- 否则按 `100vw`，也就是整个视口宽度计算。

浏览器的大致算法是：

| 项目 | 示例值 |
| --- | --- |
| `sizes` 给出的槽位宽度 | 720 CSS px |
| 设备像素比 DPR | 2 |
| 实际需要的像素宽度 | 720 × 2 = 1440 px |
| 候选集中不小于 1440 的最小宽度 | 2560w |

所以在 1440px 宽、DPR 为 2 的屏幕上，即使图片在页面里只占 720px，浏览器也会去拿 2560w。因为 1280w 不够 1440px，只能往上取。

反过来，如果 DPR 是 1，需要 720px，640w 不够，浏览器通常选 1280w。

### 最常见的错误：不写 sizes

`sizes` 的默认值是 `100vw`。也就是说，浏览器会假设图片铺满整个视口。

一个实际宽度只有 600px 的图片，如果没写 `sizes`，在 1440px 宽的屏幕上、DPR 为 2 时，浏览器会认为需要 2880px，于是直接拿最大的 2560w。这就是“明明 CSS 写了 `max-width: 600px`，却下载了最大图”的典型原因。

CSS 里的宽度，浏览器在预加载扫描阶段往往还不知道；`sizes` 是你提前告诉它的提示。两者不一致，它只能按 `sizes` 猜。

### sizes 要跟着布局改

下面这种写法很常见，但 `sizes` 和 CSS 对不上：

```css
.hero img {
  width: 100%;
  max-width: 600px;
}
```

```html
<img
  srcset="hero-640.jpg 640w, hero-1280.jpg 1280w"
  sizes="100vw"
  alt="...">
```

在宽屏上，图片实际最多 600px，`sizes` 却说 100vw。应该改成：

```html
<img
  srcset="hero-640.jpg 640w, hero-1280.jpg 1280w"
  sizes="(min-width: 600px) 600px, 100vw"
  alt="...">
```

`sizes` 里的媒体条件按顺序匹配，第一个成立的生效。条件里用 `min-width` 还是 `max-width` 都可以，但顺序要和你的 CSS 断点一致。

## 浏览器不保证选“刚刚好”的那张

规范并没有强制浏览器必须选“最小但足够”的候选。实际选择还会受到这些因素影响：

- 当前网络类型，比如省流量模式、弱网；
- 候选图片是否已经在缓存里；
- 浏览器自己的启发式策略；
- 页面是否在后台标签页加载。

所以不要写测试断言“移动端一定请求 640w”。真正可信的是 `currentSrc`：

```js
const img = document.querySelector('.hero img');
console.log(img.currentSrc);
console.log(img.getBoundingClientRect().width);
console.log(window.devicePixelRatio);
```

在 DevTools 的 Elements 面板选中 `<img>`，也能直接看到 `currentSrc`。调试时记得勾选 Disable cache，并把网络限速打开，否则缓存会干扰判断。

## 什么时候用 x 描述符

如果图片的显示尺寸是固定的，比如头像、图标、固定宽度的卡片图，用 `x` 描述符更直接：

```html
<img
  src="avatar-80.png"
  srcset="avatar-80.png 1x,
          avatar-160.png 2x,
          avatar-240.png 3x"
  width="80"
  height="80"
  alt="用户头像">
```

`1x`、`2x` 表示设备像素比，不需要 `sizes`。但同一个 `srcset` 里不能混用 `w` 和 `x`，这是硬性规则。

简单记：

- 宽度随布局变化：用 `w` + `sizes`；
- 宽度固定，只随屏幕密度变化：用 `x`。

## 换构图、换格式，用 picture

`srcset` 只解决“同一张图的不同尺寸”。如果要针对不同屏幕换裁剪比例，或者提供 AVIF、WebP、JPEG 的回退，要用 `<picture>`：

```html
<picture>
  <source
    type="image/avif"
    srcset="hero-800.avif 800w, hero-1600.avif 1600w"
    sizes="(min-width: 960px) 720px, 100vw">
  <source
    type="image/webp"
    srcset="hero-800.webp 800w, hero-1600.webp 1600w"
    sizes="(min-width: 960px) 720px, 100vw">
  <img
    src="hero-800.jpg"
    srcset="hero-800.jpg 800w, hero-1600.jpg 1600w"
    sizes="(min-width: 960px) 720px, 100vw"
    width="1600"
    height="900"
    alt="首页大图">
</picture>
```

浏览器按顺序检查每个 `<source>`：`type` 支持、`media` 匹配，就用它；都不匹配才落到 `<img>`。所以格式回退要把新格式放前面。

注意每个 `<source>` 有自己的 `srcset` 和 `sizes`，不要以为写一个就能全继承。`<img>` 仍然必须有，它是最终兜底，也是无障碍和布局的锚点。

## 最后检查这几件事

- `sizes` 是否等于图片真实的布局宽度，尤其是容器有 `max-width` 时；
- 是否混用了 `w` 和 `x`；
- 是否为 LCP 图片误加了 `loading="lazy"`；
- 是否给首屏大图加了 `fetchpriority="high"`；
- 是否写了 `width` 和 `height`，避免图片加载时页面跳动；
- 如果用 `<link rel="preload">` 预加载图片，`imagesrcset` 和 `imagesizes` 必须与 `<img>` 上的值完全一致，否则可能下载两次。

```html
<link
  rel="preload"
  as="image"
  imagesrcset="hero-800.jpg 800w, hero-1600.jpg 1600w"
  imagesizes="(min-width: 960px) 720px, 100vw">
```

`srcset` 的语法十分钟就能学会，难的是让 `sizes` 和真实布局始终说同一句话。每次改完响应式布局，顺手检查一下 `currentSrc`，比上线后看 CDN 账单便宜得多。
