> 原文链接：[改了 setAttribute，页面为什么没反应 - 码日新 · 每日文章](https://daily.xplanc.org/html/改了-setAttribute，页面为什么没反应.md)

---

# 改了 setAttribute，页面为什么没反应

上周帮同事看一段表单回填代码，逻辑很简单：拿到用户资料，把昵称写回输入框。

```js
const el = document.querySelector('#nick')
el.setAttribute('value', user.nickname)
```

代码没有报错，但页面上输入框依然是空的。换成 `el.value = user.nickname` 就正常了。类似的情况还有：把 `checked` 设成 `"false"`，复选框依然被勾选；用 `outerHTML` 保存表单，存下来的内容是旧的。

这些问题都指向同一件事：**HTML attribute 和 DOM property 是两个不同的东西**。

## 一个字符串，一个状态

```html
<input id="nick" value="阿伟">
```

浏览器解析这行标签时做了两件事：把 `value="阿伟"` 存进元素的 attribute 列表，再用它初始化 DOM 对象上的 `value` property。初始化完成之后，两者就开始各自独立了。

```js
const el = document.querySelector('#nick')

el.getAttribute('value')  // '阿伟'
el.value                  // '阿伟'

el.value = '小明'

el.value                  // '小明'
el.getAttribute('value')  // 还是 '阿伟'
```

规则可以总结成一句话：页面上显示什么，看 property；`outerHTML` 里是什么，看 attribute。

## dirty flag：改 attribute 偶尔也生效

如果只记住上面的结论，下面这种情况就会让你困惑。刚创建的元素还没被输入过，此时改 attribute 会同步到 property：

```html
<form id="f">
  <input id="nick" value="阿伟">
</form>
<script>
  const el = document.querySelector('#nick')

  el.setAttribute('value', '第一次')   // 还没被“弄脏”，页面显示“第一次”
  el.value = '用户输入'                // 置位 dirty value flag
  el.setAttribute('value', '第二次')   // 页面仍显示“用户输入”

  console.log(el.defaultValue)         // '第二次'
  document.querySelector('#f').reset() // 输入框变回“第二次”
</script>
```

规范里有个 dirty value flag：用户输入过，或者 JS 给 `el.value` 赋过值，这个 flag 就会置位。置位之后，attribute 只影响“默认值”，不再影响“当前值”。

这也解释了 `defaultValue`、`defaultChecked`、`defaultSelected` 这三个 property 的由来——它们就是 attribute 那一侧的别名。

## 一张对照表

| HTML 侧 | JS 侧 | 关系 |
| --- | --- | --- |
| `value` | `el.value` | attribute 是默认值，property 是当前值，单向 |
| `checked` | `el.checked` | attribute 是 `defaultChecked`，单向 |
| `selected` | `el.selected` | attribute 是 `defaultSelected`，单向 |
| `disabled` | `el.disabled` | 双向反射 |
| `required` | `el.required` | 双向反射 |
| `class` | `el.className`、`el.classList` | 双向反射 |
| `for` | `el.htmlFor` | 双向反射 |
| `href` | `el.href` | property 是解析后的绝对 URL |
| `style` | `el.style` | attribute 是文本，property 是对象 |
| `data-*` | `el.dataset` | 双向，短横线转驼峰 |

“反射”（reflect）指的是改一边会自动同步另一边。`disabled`、`required`、`hidden` 都是反射属性，而 `checked`、`value` 不是。

## 布尔属性：只看名字在不在

```html
<input type="checkbox" checked="false">
```

这个复选框仍然是选中的。HTML 的布尔属性只判断名字是否存在，值写了什么并不影响结果。

```js
el.setAttribute('checked', 'false') // 照样选中
el.checked = false                  // 取消选中，但 attribute 还在
el.removeAttribute('checked')       // 真正去掉
```

`disabled`、`required`、`readonly`、`multiple`、`hidden`、`open` 都属于这一类。

但要注意，`contenteditable`、`draggable`、`spellcheck` 是**枚举属性**，不是布尔属性：`contenteditable="false"` 确实表示不可编辑。`aria-*` 也是普通字符串属性，`aria-hidden="false"` 是有效且有意义的。把这两类和布尔属性混在一起，就会出问题。

还有一个不对称的地方：`el.disabled = false` 会把 attribute 一并删掉，因为它是反射属性；`el.checked = false` 不会，因为不是。所以“为什么我设了 property，attribute 还在”这个问题，答案取决于具体属性。

## URL 和 dataset 的两种读法

假设当前页面是 `https://example.com/blog/index.html`：

```html
<a id="link" href="../docs/a b.html">文档</a>
```

```js
link.getAttribute('href') // '../docs/a b.html'
link.href                 // 'https://example.com/docs/a%20b.html'
```

需要原始字符串就用 `getAttribute`，需要能直接交给 `fetch` 的地址就用 property。两者不是同一个值。

自定义数据也是类似情况：

```html
<div id="card" data-user-id="42" data-role="admin"></div>
```

```js
card.dataset.userId                // '42'
card.dataset.userId = 43
card.getAttribute('data-user-id')  // '43'
delete card.dataset.role
```

`dataset` 只负责字符串搬运，不做类型转换。`data-count="0"` 读出来是 `'0'`，`if (card.dataset.count)` 会为真，判断数量时记得先转数字。

## 序列化和克隆只认 attribute

```js
input.value = '用户刚输入的'
input.outerHTML       // 里面没有“用户刚输入的”
list.cloneNode(true)  // 克隆出来的输入框是空的
```

`outerHTML` 和 `cloneNode` 都走 attribute，不读当前状态。要拿当前值，用 `new FormData(form)` 或者直接读 property；要克隆带状态的节点，克隆完再手动同步一遍。

好消息是，表单提交本身用的是当前值，不是 attribute。所以 `outerHTML` 里没有输入内容，不影响提交，只影响你把 HTML 存下来做快照或草稿恢复的时候。

## 什么时候用哪个

- 写 HTML、服务端渲染、需要被选择器或 CSS 读到的值：用 attribute。
- 运行时改用户看到的状态：用 property。
- 读用户填的内容：用 property 或 `FormData`。
- 只是想知道标签上有没有写：用 `hasAttribute`，`getAttribute` 在缺失时返回 `null`，不是空字符串。
- 开关类状态：优先 property，不要写 `="false"`。

最后补一个容易忽略的点：`<option>` 没有 `value` attribute 时，`option.value` 会退化成它的文本内容。这是 property 自己的行为，attribute 那边依然是 `null`。

一句话收尾：attribute 是初始配置，property 是运行时状态。它们有时同步，有时不同步，而不同步的那几个，恰好是表单里最常用的。
