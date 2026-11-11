> 原文链接：[被低估的 details：折叠面板根本不用写 JS - 码日新 · 每日文章](https://daily.xplanc.org/html/被低估的-details：折叠面板根本不用写-JS.md)

---

# 被低估的 details：折叠面板根本不用写 JS

写 FAQ 页、帮助中心、订单详情时，很多人下意识就开始 `div` + `button` + class 切换，再补一堆 `aria-*` 属性和 keydown 监听。其实 HTML 里有个专门干这件事的标签：`<details>`。折叠、展开、键盘、读屏支持全部内建，一行 JavaScript 都不用写。

## 最小可用版本

```html
<details>
  <summary>订单多久发货？</summary>
  <p>付款后 48 小时内发出，法定节假日顺延。</p>
</details>
```

浏览器自动做三件事：渲染一个默认小三角；点击 summary 时切换 `open` 属性；收起的内容依然留在 HTML 源码里——SEO 不吃亏，而且就算访客禁用了 JS，折叠功能照常工作，因为它压根不依赖 JS。

想默认展开，加个 `open`：

```html
<details open>
  <summary>配送说明</summary>
  <p>……</p>
</details>
```

## 免费送的东西

和手写版对比一下，`<details>` 白送了这些：

- **键盘操作**：Tab 能聚焦到 summary，Enter 和空格键都能切换，不用写一行 keydown。
- **读屏语义**：读屏软件自动把它识别成可展开的控件，展开状态自动播报。
- **状态即属性**：`el.open` 是可读写的布尔属性，改它界面立刻跟着变；用户点击，它也立刻同步。
- **toggle 事件**：在状态变化之后触发，是“展开后做点事”的天然挂点。

一个坑要记：`toggle` 事件**不冒泡**。想偷懒绑在 document 上做事件委托，会发现根本收不到，老实绑到每个 `<details>` 上最省事。

顺手来个实用场景——记住用户上次是否展开：

```js
const el = document.querySelector('#faq-shipping');
if (localStorage.getItem('faq:shipping') === '1') {
  el.open = true;
}
el.addEventListener('toggle', () => {
  localStorage.setItem('faq:shipping', el.open ? '1' : '0');
});
```

## 一次只开一个

FAQ 常见的需求是排他：展开这一条，其他自动收起。以前只能靠 JS：

```js
const items = [...document.querySelectorAll('details[name="faq"]')];
items.forEach((d) =>
  d.addEventListener('toggle', () => {
    if (!d.open) return;
    for (const other of items) {
      if (other !== d) other.open = false;
    }
  })
);
```

现在 HTML 原生支持了：给同一组的 `<details>` 起相同的 `name`。

```html
<details name="faq" open>
  <summary>多久发货？</summary>
  <p>付款后 48 小时内。</p>
</details>
<details name="faq">
  <summary>支持退换吗？</summary>
  <p>签收后 7 天内可以申请。</p>
</details>
```

同名互斥由浏览器自动完成。`name` 从 Chrome 131 开始支持，其他引擎陆续跟进，用之前查一下 caniuse。就算浏览器不认识它，也只是退回“各自独立展开”，功能不坏——典型的渐进增强。上面的 JS 和 `name` 同时存在也不冲突，留着兜底正好。

## 样式：从去掉小三角开始

默认三角想去掉：

```css
summary {
  cursor: pointer;
  list-style: none;
}
summary::-webkit-details-marker {
  display: none; /* 照顾老 Safari */
}
```

换一个会旋转的自定义箭头：

```css
summary::after {
  content: "›";
  float: right;
  transition: rotate 0.2s ease;
}
details[open] summary::after {
  rotate: 90deg;
}
```

两个容易踩的坑：

- **summary 必须是第一个子元素**。前面先塞了别的元素，它就退化成普通内容，点击不再切换。
- **summary 里别放交互元素**。点击其中的链接、按钮、输入框时，折叠照样会被触发，体验很怪。需要交互，把元素放进展开后的内容里。

一个小技巧：summary 的内容模型允许混入标题元素，想要文档大纲语义可以这么写：

```html
<details>
  <summary><h2>配送说明</h2></summary>
  <p>……</p>
</details>
```

## 动画是块硬骨头

`<details>` 最常被嫌弃的地方：展开收起是瞬间的。想给高度加 transition，马上撞上 CSS 的老问题——`height: auto` 不可插值，动画根本跑不起来。

Chromium 系浏览器给出了原生解法，两半拼起来：

```css
/* 允许动画到 auto 这类关键字高度（Chromium 129+） */
:root {
  interpolate-size: allow-keywords;
}

/* ::details-content 指向展开区域（Chromium 131+） */
details::details-content {
  height: 0;
  overflow: clip;
  transition: height 0.3s ease, content-visibility 0.3s allow-discrete;
}

details[open]::details-content {
  height: auto;
}
```

`interpolate-size: allow-keywords` 让 `0 → auto` 变得可以过渡；`::details-content` 是官方给展开内容留的伪元素挂钩；`allow-discrete` 则让内容在收起动画播完之前保持可见。不支持的浏览器会直接忽略这些规则，退回瞬间切换——页面不会坏，只是少了 300 毫秒的顺滑。

想要全引擎一致的动画，就得 JS 全面接管：拦下 summary 的 click，量内容高度，自己播动画，结束后再改 `open`。能做，但代价是把“零 JS”的优势整个扔掉。动手之前先问一句：这个面板真的需要动画吗？

## 什么时候不该用它

`<details>` 的定位是“内容流里的折叠”，不是万能的显示/隐藏开关：

- 模态弹窗需要焦点圈定和遮罩，用 `<dialog>`（之前写过一篇）；
- 非模态的浮出层、菜单，`popover` 属性更合适；
- 用户必须看到的关键信息，别藏进折叠里——默认收起约等于默认没人看。

它真正适合的场景：FAQ、帮助文档的章节导航、设置项的补充说明、代码块里的“展开完整示例”。

## 小结

| | div + JS 手写 | `<details>` |
|---|---|---|
| JS 依赖 | 必须有 | 零 |
| 键盘与读屏 | 自己补齐 | 内建 |
| 排他展开 | 自己写 | `name` 属性，或几行兜底 JS |
| 动画 | 随便写 | 有解，但要接受降级或加 JS |

下次写折叠面板，先从 `<details>` 起步，缺什么再补什么。多数时候你会发现，一行都不用补。
