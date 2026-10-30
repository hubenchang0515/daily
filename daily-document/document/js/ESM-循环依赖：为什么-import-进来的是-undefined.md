# ESM 循环依赖：为什么 import 进来的是 undefined

把一个大文件拆成两个模块，结果页面白屏，控制台只留下一句：

```text
ReferenceError: Cannot access 'a' before initialization
```

或者更隐蔽一点：不报错，但 `import` 进来的值是 `undefined`，函数一调用就崩。循环依赖不是“打包工具的小毛病”，而是 ES Module 的求值顺序和绑定机制共同作用的结果。理解它，比记住“不要循环依赖”更有用。

## 先跑一个最小复现

建三个 `.mjs` 文件，不需要 `package.json`：

```js
// a.mjs
import { b } from './b.mjs';

export const a = 'A';

console.log('a.mjs 执行完毕');
```

```js
// b.mjs
import { a } from './a.mjs';

export const b = 'B';

console.log(`b.mjs 在顶层读取 a：${a}`);
```

```js
// main.mjs
import './a.mjs';
```

执行：

```bash
node main.mjs
```

输出不是 `A`，而是：

```text
ReferenceError: Cannot access 'a' before initialization
```

原因不是 `a` 没导出，而是 `b.mjs` 执行时，`a.mjs` 的 `const a` 还没轮到赋值。

## 模块求值：先连线，再执行

ESM 分两个阶段：

1. **实例化（instantiation）**：加载整张依赖图，为每个模块建立环境，创建所有导出绑定的“位置”。这一步不执行模块代码。
2. **求值（evaluation）**：按深度优先后序执行模块体。遇到依赖，先执行依赖；依赖执行完，再执行自己。

上面的例子里，入口是 `a.mjs`：

```text
a.mjs 开始
  -> 发现依赖 b.mjs
       b.mjs 开始
         -> 发现依赖 a.mjs（但 a.mjs 正在求值，不再重复执行）
         -> 执行 b.mjs 模块体
              console.log(a)  // a 的 const 还没初始化
```

`a.mjs` 已经进入求值栈，但它的模块体还没跑到 `export const a = 'A'`。所以 `b.mjs` 拿到的是一个已经建立、但尚未初始化的绑定。访问它就会触发暂时性死区（TDZ），抛 `ReferenceError`。

## import 不是拷贝，是活绑定

另一个常见误解是：`import { count }` 相当于把值复制进来。实际上，ESM 的导入是**指向导出绑定的只读引用**。

```js
// counter.mjs
export let count = 0;

export function increment() {
  count += 1;
}
```

```js
// main.mjs
import { count, increment } from './counter.mjs';

console.log(count); // 0
increment();
console.log(count); // 1
```

`count` 没有重新导入，也没有重新赋值，但读到的值变了，因为每次访问都回到 `counter.mjs` 的那个绑定上。反过来，导入方不能改它：

```js
import { count } from './counter.mjs';
count = 10; // TypeError: Assignment to constant variable.
```

如果想保存快照，必须显式复制：

```js
const snapshot = count; // 此刻的值，之后不再跟随
```

这也解释了为什么循环依赖里有时拿到的是“最新值”，有时却是 `undefined` 或直接报错：取决于你访问绑定的**时机**，以及这个绑定是用什么声明的。

## 为什么有时是 undefined，有时直接报错

同样是“还没初始化”，不同声明方式的表现并不一样：

| 导出形式 | 在依赖模块顶层提前访问时 |
| --- | --- |
| `export function foo() {}` | 可以调用，函数声明在实例化阶段已初始化 |
| `export var x = 1` | 得到 `undefined`，因为 `var` 被提升并初始化为 `undefined` |
| `export let x = 1` | 抛 `ReferenceError`，处于 TDZ |
| `export const x = 1` | 抛 `ReferenceError`，处于 TDZ |
| `export class A {}` | 抛 `ReferenceError`，类同样有 TDZ |
| `export default 42` | 模块求值前访问会抛 `ReferenceError` |

所以最危险的情况不是报错，而是用 `var` 或“先声明后赋值”的写法，让程序带着 `undefined` 继续跑，直到某个深层调用才炸。

函数声明之所以能提前用，是因为它在实例化阶段就完成了初始化。下面这样改，`b.mjs` 在顶层调用就不会崩：

```js
// a.mjs
import { b, readA } from './b.mjs';

export function getA() {
  return 'A';
}

export const a = 'A';

console.log(readA());
```

```js
// b.mjs
import { getA } from './a.mjs';

export const b = 'B';

export function readA() {
  return `b 通过函数读取：${getA()}`;
}
```

注意，真正被提前访问的是 `getA`，它在 `a.mjs` 求值前就已经可用。如果 `getA` 内部又读取了尚未初始化的 `const a`，错误只会被推迟到调用时发生，并没有消失。

## 循环依赖通常长什么样

最常见的不是两个文件互相 `import` 得那么明显，而是“桶文件”造成的隐形环：

```js
// index.js
export * from './user.js';
export * from './order.js';
```

```js
// order.js
import { formatUser } from './index.js'; // 看起来没问题，实际上绕回了 index
```

`order.js` 本可以直接从 `./user.js` 导入，却通过 `index.js` 中转，于是形成 `index -> order -> index`。打包工具、测试环境和 Node 的加载顺序稍有差异，问题就可能只在某个入口出现。

另一类高发场景是“常量模块依赖工具模块，工具模块又依赖常量模块”。比如 `config.js` 引入 `logger.js`，`logger.js` 为了读取日志级别又引入 `config.js`。两边都在顶层执行初始化，谁先谁后完全取决于入口。

## 四种可行的修法

**1. 把共享部分下沉到第三个模块**

这是最彻底的方案。`a` 和 `b` 都需要的东西，放到 `shared.js`，让两边都依赖 `shared`，而不是互相依赖。依赖图从环变成树，求值顺序就不再敏感。

**2. 把顶层访问改成运行时访问**

不要在模块顶层读取对方的值，把读取放进函数、方法或事件回调里：

```js
// 不要这样
import { config } from './config.js';
const url = config.apiUrl;

// 改成这样
import { config } from './config.js';
export function getUrl() {
  return config.apiUrl;
}
```

只要调用发生在所有模块求值完成之后，活绑定就能拿到正确的值。

**3. 用函数声明暴露“早到也能用”的能力**

如果某个模块确实需要在对方初始化前被调用，把入口写成函数声明，而不是 `const fn = () => {}`。但要注意：函数内部不要再碰对方的 TDZ 绑定。

**4. 用动态 import 打断静态求值链**

```js
// 把静态依赖改成运行时加载
export async function loadFormatter() {
  const { format } = await import('./formatter.js');
  return format;
}
```

动态 `import()` 会把加载推迟到调用时，能避开“模块体执行顺序”引起的报错。但它只是推迟了问题，没有消除架构上的双向依赖；如果两边仍在运行时互相等待，复杂度只会更高。

## 让问题在 CI 里暴露

循环依赖靠人眼很难盯住，建议直接加检查。以 JavaScript/TypeScript 项目为例：

```bash
npx madge --circular --extensions js,jsx,ts,tsx src
```

有环时它会列出完整路径。也可以配合 ESLint：

```json
{
  "rules": {
    "import/no-cycle": ["error", { "maxDepth": 3 }]
  }
}
```

另外，TypeScript 的 `import type` 在编译后会被擦除，不会产生运行时依赖；如果只是类型层面的互相引用，通常不需要为了“消环”去改结构。

## 记住这三句话

- ESM 先建绑定，再按依赖顺序求值；依赖先执行，自己后执行。
- `import` 拿到的是活绑定，不是值拷贝；但绑定可能尚未初始化。
- 循环依赖里的 `undefined` 和 `ReferenceError`，本质都是“在错误的时机访问了绑定”。

真正的修复不是把 `const` 改成 `var` 让它“不报错”，而是调整依赖方向，或者把访问推迟到模块求值完成之后。前者消除问题，后者只是把爆炸时间往后挪。

---

> 原文链接：[ESM 循环依赖：为什么 import 进来的是 undefined](https://daily.xplanc.org/js/ESM-%E5%BE%AA%E7%8E%AF%E4%BE%9D%E8%B5%96%EF%BC%9A%E4%B8%BA%E4%BB%80%E4%B9%88-import-%E8%BF%9B%E6%9D%A5%E7%9A%84%E6%98%AF-undefined.md)
