# 别急着写 JS：用原生 HTML 完成表单校验

很多表单在提交前都有一段相似的 JavaScript：遍历输入框、判断空值、用正则表达式验证邮箱、比较两次密码，再给每个字段插入一行红字。代码越堆越多，提示文案和浏览器自带的气泡还不一致。

其实 HTML 早就内置了一套约束校验（Constraint Validation）。只要把规则写在标签上，浏览器就会负责拦截提交、聚焦第一个出错的字段，并显示本地化提示。JavaScript 只需要处理那些真正需要自定义的部分。

## 浏览器已经帮你做了什么

下面这些属性和输入类型，都会自动参与校验：

| 写法 | 约束 | 说明 |
| --- | --- | --- |
| `required` | 值不能为空 | 对 `checkbox` 表示必须勾选 |
| `type="email"` | 邮箱格式 | 只做基本格式检查，不验证域名是否存在 |
| `type="url"` | URL 格式 | 要求带协议，如 `https://` |
| `min` / `max` | 数值范围 | 作用于 `number`、`range`、日期类输入 |
| `step` | 步长 | `number` 默认步长是 1，小数要显式写 `step="0.01"` |
| `minlength` / `maxlength` | 字符长度 | 只限制用户输入，脚本赋值不受约束 |
| `pattern` | 正则 | 隐式整串匹配，不需要写 `^` 和 `$` |

一个最小可用的表单：

```html
<form id="signup">
  <label for="email">邮箱</label>
  <input id="email" name="email" type="email" required
         autocomplete="email" aria-describedby="email-hint">
  <p id="email-hint">我们只会用它发送订单通知。</p>

  <label for="age">年龄</label>
  <input id="age" name="age" type="number"
         min="18" max="120" step="1" required>

  <button>注册</button>
</form>
```

用户点击“注册”时，如果邮箱为空或年龄填了 12，浏览器会阻止提交、聚焦第一个不合格的字段，并弹出提示。整个过程不需要一行 JavaScript。

## 用 validity 读取校验状态

每个可校验控件都有一个 `validity` 对象，里面是一组布尔值：

```js
const form = document.querySelector('#signup');
const age = form.elements.age;

console.log(age.validity.valid);          // 是否全部通过
console.log(age.validity.valueMissing);   // 必填但为空
console.log(age.validity.rangeUnderflow); // 小于 min
console.log(age.validity.stepMismatch);   // 不符合步长
console.log(age.validationMessage);       // 浏览器生成的提示文案
```

常用字段还有 `typeMismatch`（类型不符）、`patternMismatch`（正则不匹配）、`tooLong` / `tooShort`、`badInput`（浏览器无法解析的输入，比如在数字框里输入了 `1,2`）和 `customError`（由 `setCustomValidity` 设置）。

表单本身也提供了三个方法：

```js
form.checkValidity();   // 只返回结果，并触发 invalid 事件
form.reportValidity();  // 返回结果，同时显示原生气泡
form.requestSubmit();   // 触发校验并走完整的提交流程
```

注意 `form.submit()` 会直接提交，既不做校验，也不触发 `submit` 事件。需要“像用户点击按钮那样提交”时，用 `requestSubmit()`。

## setCustomValidity 的陷阱

当内置规则不够用时，比如要检查“用户名是否已被占用”，可以用 `setCustomValidity()` 写入自定义错误：

```js
const username = form.elements.username;

username.addEventListener('input', () => {
  const taken = ['admin', 'root'].includes(username.value.toLowerCase());
  username.setCustomValidity(taken ? '该用户名已被占用' : '');
});
```

关键在最后那个空字符串。`setCustomValidity` 是“设置状态”，不是“显示一次提示”。一旦写入了非空字符串，这个字段就会一直处于 `customError` 状态，哪怕用户后来改成了合法值。所以每次输入都要重新计算，合法时显式传 `''` 清空。

另一个常见问题是跨字段校验，比如确认密码：

```js
const password = form.elements.password;
const confirm = form.elements.confirm;

function syncConfirm() {
  const mismatch = confirm.value && confirm.value !== password.value;
  confirm.setCustomValidity(mismatch ? '两次输入的密码不一致' : '');
}

password.addEventListener('input', syncConfirm);
confirm.addEventListener('input', syncConfirm);
```

两个输入框都要监听，否则用户回头修改第一个密码时，第二个字段的状态不会更新。

## submit 为什么没有触发

原生校验失败时，`submit` 事件根本不会触发。所以不要指望在 `submit` 处理器里提示“请检查表单”，那段代码只有在全部字段通过后才会执行。

如果确实需要异步校验，比如提交前请求接口检查用户名，可以给表单加 `novalidate` 关闭自动校验，然后手动调用 `reportValidity()`：

```html
<form id="signup" novalidate>
  <!-- 字段略 -->
</form>
```

```js
form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const name = form.elements.username.value;
  const res = await fetch(`/api/username?u=${encodeURIComponent(name)}`);
  const { available } = await res.json();

  form.elements.username.setCustomValidity(
    available ? '' : '该用户名已被占用'
  );

  if (!form.reportValidity()) return;

  await fetch('/api/signup', { method: 'POST', body: new FormData(form) });
});
```

`novalidate` 只关闭“提交时自动校验”，`required`、`type` 这些规则仍然保留，`reportValidity()` 会一次性检查全部字段并显示气泡。

## 别用 :invalid 直接标红

CSS 提供了 `:invalid`，但它有一个尴尬的行为：页面刚加载、用户还没输入时，空的必填字段就已经是 `:invalid`，整个表单一片红。

更好的选择是 `:user-invalid`，它只在用户交互过且值仍不合法时生效：

```css
input:user-invalid {
  border-color: #d33;
  outline-color: #d33;
}

input:user-invalid + .error {
  display: block;
}
```

`:user-invalid` 在现代浏览器中已经可用。如果需要兼容旧版本，可以在 `invalid` 事件里加类名。注意 `invalid` 事件不冒泡，必须用捕获阶段监听：

```js
form.addEventListener('invalid', (event) => {
  event.target.closest('label')?.classList.add('has-error');
}, true);
```

颜色之外，最好再给一段文字说明。只靠红色边框，对色觉障碍用户并不友好。

## 几个容易踩的坑

**隐藏的必填字段会让表单静默失败。** 一个 `display: none` 的 `required` 输入框依然参与校验。浏览器试图聚焦它来显示提示，却聚焦不了，控制台只留下一句 `An invalid form control with name='xxx' is not focusable`，页面看起来毫无反应。多步骤表单隐藏上一步字段时最容易遇到。正确做法是给隐藏字段加 `disabled`，或者提交前移除 `required`。

**`pattern` 是整串匹配。** 写 `[a-z]+` 就等价于 `^[a-z]+$`，不要再包一层锚点。现代浏览器用 `v` 标志编译 `pattern`，字符类里的 `-`、`(` 等符号需要转义，写完最好在控制台用 `new RegExp(pat, 'v')` 验证一下。

**`minlength` 不约束脚本赋值。** 它只检查用户输入。用 JS 直接设置 `input.value = 'a'`，不会触发 `tooShort`。服务端仍然要独立校验长度。

**`disabled` 和 `readonly` 的字段不参与校验。** 如果某个字段只是暂时不可编辑，用 `readonly`；如果它根本不该提交，用 `disabled`。两者语义不同，别混用。

**原生提示文案无法逐字定制。** `validationMessage` 由浏览器按语言环境生成，各家措辞略有差异。要完全控制文案，只能监听 `invalid` 事件、调用 `preventDefault()` 阻止原生气泡，再渲染自己的提示层。这会增加不少代码，通常不值得。

## 最后仍然要服务端校验

前端校验的目标是尽早给出反馈，减少无效请求，而不是安全边界。用户可以禁用 JavaScript、修改 DOM，也可以直接构造 HTTP 请求绕过整个页面。所有规则——必填、长度、范围、格式、唯一性——都必须在服务端再执行一遍。

把能交给 HTML 的部分交出去，JavaScript 只保留异步检查和跨字段逻辑，表单代码会短很多，行为也更接近用户对浏览器的预期。

---

> 原文链接：[别急着写 JS：用原生 HTML 完成表单校验](https://daily.xplanc.org/html/%E5%88%AB%E6%80%A5%E7%9D%80%E5%86%99-JS%EF%BC%9A%E7%94%A8%E5%8E%9F%E7%94%9F-HTML-%E5%AE%8C%E6%88%90%E8%A1%A8%E5%8D%95%E6%A0%A1%E9%AA%8C.md)
