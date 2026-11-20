> 原文链接：[setTimeout(fn, 0) 从来不是立即执行：读懂事件循环 - 码日新 · 每日文章](https://daily.xplanc.org/js/setTimeout(fn,-0)-从来不是立即执行：读懂事件循环.md)

---

# setTimeout(fn, 0) 从来不是立即执行：读懂事件循环

很多人第一次写 `setTimeout(fn, 0)` 时，都以为把延迟填成 0 就等于“立即执行”。可真正跑起来你会发现，它总是乖乖排在一堆同步代码、甚至 Promise 回调的后面。这不是浏览器在偷懒，而是 JavaScript 的事件循环在背后调度。本文从一段反直觉的输出顺序出发，拆开调用栈、宏任务队列和微任务队列，看清楚一轮循环到底发生了什么，再用这些知识解释 async/await、页面卡死和框架里的批量更新。

## 一段让人怀疑人生的输出

先看这段代码，先在心里猜一下打印顺序：

```js
console.log('script start');

setTimeout(() => {
    console.log('setTimeout');
}, 0);

Promise.resolve()
    .then(() => console.log('promise1'))
    .then(() => console.log('promise2'));

console.log('script end');
```

很多人的第一直觉是：`script start`、`setTimeout`、`script end`、`promise1`、`promise2`。但真实输出是：

```text
script start
script end
promise1
promise2
setTimeout
```

`setTimeout` 明明写在前头，延迟又是 0，却最后一个才打印。要理解这件事，得先认识三个角色。

## 调用栈、任务队列与微任务队列

JavaScript 是单线程的，同一时刻只能做一件事。它有一个**调用栈（call stack）**，同步代码按顺序入栈、出栈。函数里调用函数，就把新函数压到栈顶，执行完再弹出来。

遇到异步任务时，JS 不会傻等，而是把任务“挂起”，交给宿主环境（浏览器或 Node）去计时或监听。等条件满足了，宿主把对应的回调放进队列里排队。关键之处在于，队列还不止一个：

| 类型 | 常见来源 | 调度方式 |
|------|----------|----------|
| 宏任务（task） | 整段 script、`setTimeout`、`setInterval`、I/O、`postMessage` | 每轮取一个执行 |
| 微任务（microtask） | `Promise.then/catch/finally`、`MutationObserver`、`queueMicrotask`、Node 的 `process.nextTick` | 每轮一次性清空 |

注意两个细节：第一，整段 `<script>` 本身就算一个宏任务，所以一上来先执行的是它；第二，`setTimeout(fn, 0)` 里的 0 说的是“最快多久之后把回调放进队列”，而不是“立刻执行”。而且规范还规定，嵌套层级过深时最小延迟会被抬到 4ms，Node 里更是直接按 1ms 处理。

## 一轮事件循环到底做了什么

把上面的概念串起来，一轮事件循环（tick）大致是这样走的：

1. 从宏任务队列里取**一个**任务执行（初始就是整段 script）。
2. 执行过程中产生的微任务，全部放进微任务队列。
3. 当前宏任务结束后，**清空微任务队列**——不仅执行已有的，连执行过程中新产生的微任务也一并跑完。
4. 浏览器择机渲染页面。
5. 回到第 1 步，取下一个宏任务。

用这个流程回头看开头的例子：整段 script 入栈执行，先打印 `script start`；遇到 `setTimeout`，把回调丢进宏任务队列；遇到 Promise，把 `.then` 丢进微任务队列；继续往下打印 `script end`。此时调用栈空了，于是清空微任务队列，依次打印 `promise1`、`promise2`；微任务清空后才轮到下一个宏任务，打印 `setTimeout`。顺序就这么定下来了。

这里有个特别容易踩的点：**微任务优先级高于下一个宏任务**。哪怕宏任务已经等了很久，只要微任务队列没清空，它就永远排不上号。

## async/await 不过是 Promise 的语法糖

`async/await` 写起来像同步代码，本质仍是 Promise 和微任务。`await` 后面的那一行，相当于被塞进了 `.then` 里：

```js
async function foo() {
    console.log('A');
    await 0;
    console.log('B'); // 这一行是微任务
}

foo();
console.log('C');

// A
// C
// B
```

`await 0` 会立即把后续代码包装成微任务排队，所以同步的 `C` 先打印，`B` 随后。理解这一点，很多“await 之后变量怎么变了”的疑问就迎刃而解了。

## 微任务清不空，页面就永远卡住

既然每轮都要把微任务队列清空，那如果微任务自己不断产生微任务会怎样？

```js
function loop() {
    Promise.resolve().then(loop);
}
loop(); // 页面直接卡死
```

微任务队列永远清不空，事件循环卡在第二步出不来，浏览器没机会渲染，也取不到下一个宏任务——点击、输入全都失效。换成 `setTimeout(loop, 0)` 就不会把页面锁死，因为宏任务每轮只取一个，中间留出了渲染和响应用户输入的空隙。这也是为什么做大量计算时要主动“让出”主线程，而不是一股脑堆在微任务里。

## 那些藏在框架里的事件循环

Vue 的 `nextTick`、React 的状态批量更新，背后都是这套机制。框架把你的多次数据修改收集起来，等同步代码跑完、微任务阶段再统一更新 DOM，既避免了反复渲染，又保证你在 `nextTick` 回调里能读到最新的 DOM：

```js
// 在同一个同步流程里改三次，DOM 只更新一次
state.a = 1;
state.b = 2;
state.c = 3;
await nextTick(); // 此时 DOM 已经更新完毕
```

如果你在 `setTimeout` 里改状态，因为它属于下一个宏任务，批量更新的时机就变了，行为自然和预期不同。搞懂宏任务与微任务的边界，排查这类“更新时机”问题会轻松很多。

## 浏览器和 Node 不完全一样

在浏览器里，渲染发生在微任务清空之后、下一个宏任务之前；而 `requestAnimationFrame` 的回调紧贴渲染执行，既不算宏任务也不算微任务。

Node 的事件循环则按阶段（phase）推进，timer、I/O、check 等各有队列。另外 `process.nextTick` 的优先级比 Promise 微任务还高——它会插队到当前操作结束后立刻执行，甚至早于 Promise：

```js
process.nextTick(() => console.log('nextTick'));
Promise.resolve().then(() => console.log('promise'));
// nextTick
// promise
```

写跨端代码时，这个差异值得记在心里。

## 小结

记住三句话就够了：同步代码先跑完；微任务在每轮末尾被一次性清空；宏任务一轮只取一个。`setTimeout(fn, 0)` 从来不是“立即执行”，它只是“尽快排进宏任务队列”。把事件循环的运行节奏装进脑子里，那些看似玄学的输出顺序、卡死的页面和诡异的更新时机，都会变得顺理成章。

## 相关文章

- [ESM 循环依赖：为什么 import 进来的是 undefined](https://daily.xplanc.org/js/ESM-循环依赖：为什么-import-进来的是-undefined.md)
- [structuredClone 复制不了什么](https://daily.xplanc.org/js/structuredClone-复制不了什么.md)

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
