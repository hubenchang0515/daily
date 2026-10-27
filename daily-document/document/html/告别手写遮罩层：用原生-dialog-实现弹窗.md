# 告别手写遮罩层：用原生 dialog 实现弹窗

弹窗几乎是每个 Web 项目都绕不开的组件。过去我们习惯用 `div` 拼出遮罩层，再写一套 JS 管理 `z-index`、焦点、ESC 关闭和滚动锁定。代码越写越长，边界情况却总也补不完。

HTML 原生的 `<dialog>` 元素已经可以承担大部分工作：它会自动进入顶层、隔离背景交互、限制焦点范围，并在关闭后把焦点还给触发元素。本文从一个最小示例出发，逐步补齐表单交互、遮罩点击、样式和可访问性细节。

## 最小可用示例

先看一个可以直接运行的版本：

```html
<button id="open">打开弹窗</button>

<dialog id="demo" aria-labelledby="demo-title">
  <h2 id="demo-title">这是一条通知</h2>
  <p>按 ESC 或点击下方按钮关闭。</p>
  <button id="close">知道了</button>
</dialog>

<script>
  const dialog = document.querySelector('#demo');

  document.querySelector('#open').addEventListener('click', () => {
    dialog.showModal();
  });

  document.querySelector('#close').addEventListener('click', () => {
    dialog.close();
  });
</script>
```

这里的关键是 `showModal()`。它会让 `<dialog>` 进入浏览器的 top layer，同时把页面其余部分变为不可交互状态。没有额外的遮罩 `div`，也没有手写的焦点陷阱。

## show() 和 showModal() 有什么区别

`<dialog>` 有两种打开方式，行为差别很大：

| 行为 | `show()` | `showModal()` |
| --- | --- | --- |
| 进入 top layer | 否 | 是 |
| 背景内容被隔离 | 否 | 是 |
| 显示 `::backdrop` | 否 | 是 |
| 按 ESC 关闭 | 否 | 是 |
| 焦点限制在弹窗内 | 否 | 是 |

大多数“模态弹窗”场景都应该使用 `showModal()`。`show()` 更适合非阻塞的浮层，例如侧边通知或悬浮工具面板，此时页面其他区域仍然可以操作。

另外，`open` 属性只表示“显示”，并不等于“模态”。直接写 `<dialog open>` 会得到一个非模态弹窗；需要模态行为时，仍然要调用 `showModal()`。

## 用表单返回值组织交互

确认类弹窗通常有“取消”和“确认”两个出口。与其给每个按钮绑定事件，不如利用 `method="dialog"` 的表单：

```html
<dialog id="confirm" aria-labelledby="confirm-title">
  <form method="dialog">
    <h2 id="confirm-title">删除这条记录？</h2>
    <p>删除后无法恢复，请确认。</p>
    <div class="actions">
      <button value="cancel">取消</button>
      <button value="confirm">删除</button>
    </div>
  </form>
</dialog>
```

当表单以 `method="dialog"` 提交时，浏览器会关闭弹窗，并把被点击按钮的 `value` 写入 `dialog.returnValue`。于是判断逻辑可以集中到 `close` 事件里：

```js
const confirmDialog = document.querySelector('#confirm');

document.querySelector('#delete').addEventListener('click', () => {
  confirmDialog.returnValue = '';
  confirmDialog.showModal();
});

confirmDialog.addEventListener('close', () => {
  if (confirmDialog.returnValue === 'confirm') {
    deleteRecord();
  }
});
```

有两个细节值得注意：

- 打开前重置 `returnValue`。它不会在每次关闭时自动清空，上一次的结果可能残留。
- 表单里的按钮默认是 `submit` 类型，所以不需要额外写 `type="submit"`；但如果表单包含 `required` 字段，普通提交会先触发校验，必要时可加 `novalidate`。

## 处理 ESC 和点击遮罩

模态弹窗按 ESC 会触发 `cancel` 事件，默认行为是关闭。如果弹窗里有未保存的内容，可以拦截：

```js
dialog.addEventListener('cancel', (event) => {
  if (hasUnsavedChanges()) {
    event.preventDefault();
  }
});
```

点击遮罩关闭并不是原生行为，需要自己实现。常见写法是比较事件目标：

```js
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) {
    dialog.close('backdrop');
  }
});
```

这段代码成立的前提是 `dialog` 自身没有内边距。如果给 `dialog` 设置了 `padding`，点击内边距区域也会被判定为点击遮罩。稳妥的做法是把 `padding` 放到内部容器上：

```css
dialog {
  padding: 0;
}

.dialog-body {
  padding: 24px;
}
```

这样点击内容区时，事件目标始终是内部元素，而不是 `dialog` 本身。

## 样式与动效

`::backdrop` 用来定制遮罩层。下面是一组常用样式：

```css
dialog {
  width: min(440px, calc(100vw - 32px));
  padding: 0;
  border: 0;
  border-radius: 12px;
  box-shadow: 0 24px 64px rgb(0 0 0 / 0.25);
}

dialog::backdrop {
  background: rgb(0 0 0 / 0.45);
  backdrop-filter: blur(2px);
}

dialog[open] {
  animation: pop 0.18s ease-out;
}

@keyframes pop {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
}
```

`dialog` 在未打开时默认是 `display: none`，因此 `[open]` 上的动画只会在显示时执行。若想实现关闭动画，需要使用 `transition`、`@starting-style` 和 `allow-discrete`，复杂度会明显上升；多数场景下只做入场动画已经足够。

还有一个容易忽略的点：`<dialog>` 默认使用固定定位并居中，但在某些重置样式或父级 `transform` 影响下可能表现异常。排查时先检查是否有全局的 `dialog { position: static }` 之类的规则。

## 可访问性清单

原生元素解决了很多问题，但不等于自动完成全部可访问性工作。建议逐项确认：

- 用 `aria-labelledby` 指向弹窗标题，让屏幕阅读器读出名称。
- 标题使用真实的 `<h2>` 等标题元素，而不是加粗的 `div`。
- 仅图标关闭按钮需要 `aria-label="关闭"`。
- 删除、覆盖等高风险确认可以使用 `role="alertdialog"`，同时提供 `aria-describedby` 说明后果。
- 不要在打开弹窗后手动给 `body` 加 `overflow: hidden` 来“锁滚动”；模态 `dialog` 已经隔离背景，额外锁定反而可能在关闭后忘记恢复。
- 关闭后浏览器通常会把焦点还给触发按钮，不需要自己保存和恢复；但如果触发元素已被移除，应主动把焦点移到合理的替代位置。

## 几个常见坑

**点按钮页面刷新了。** 表单没有写 `method="dialog"`，浏览器按普通表单提交处理。检查这一点通常能解决大部分“弹窗一闪而过”的问题。

**多个弹窗叠加顺序混乱。** 每次 `showModal()` 都会把弹窗压入 top layer，后打开的显示在上层。关闭时应按后进先出的顺序处理，避免用户误关底层弹窗。

**在弹窗里再打开弹窗没反应。** 确认调用的是 `showModal()` 而不是重复对已打开的 `dialog` 调用 `show()`。对已经打开的弹窗再次调用会抛出异常，可以先判断 `dialog.open`。

**旧浏览器兼容。** 现代浏览器均已支持 `<dialog>`，包括 Safari 15.4 及以上。如果需要支持更老的版本，可以引入官方推荐的 `dialog-polyfill`，但要注意 polyfill 对 top layer 和 `::backdrop` 的支持并不完全一致。

## 什么时候仍然需要组件库

原生 `<dialog>` 适合确认框、表单弹窗、图片预览等常规场景。如果需求涉及复杂的打开/关闭动画编排、拖拽、多级路由联动，或者团队已经有成熟的组件体系，继续使用组件库更划算。

但如果只是想要一个行为正确、焦点可控、代码量少的弹窗，`<dialog>` 已经足够。把遮罩、ESC、焦点和返回值交给浏览器，往往比维护一套手写逻辑更可靠。

---

> 原文链接：[告别手写遮罩层：用原生 dialog 实现弹窗](https://daily.xplanc.org/html/%E5%91%8A%E5%88%AB%E6%89%8B%E5%86%99%E9%81%AE%E7%BD%A9%E5%B1%82%EF%BC%9A%E7%94%A8%E5%8E%9F%E7%94%9F-dialog-%E5%AE%9E%E7%8E%B0%E5%BC%B9%E7%AA%97.md)
