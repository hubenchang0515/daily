> 原文链接：[给异步操作装一个取消键：AbortController - 码日新 · 每日文章](https://daily.xplanc.org/zh/js/给异步操作装一个取消键：AbortController.md)

---

# 给异步操作装一个取消键：AbortController

前端页面发起了搜索请求，用户又输入了新关键词；组件已经卸载，旧请求却还在后台解析响应；接口迟迟不返回，页面只能一直等待。很多异步操作默认只有“等它结束”这一条路，而 `AbortController` 提供了一套标准的取消协议，让你可以主动告诉操作：不用继续了。

## AbortController 的基本模型

`AbortController` 本身很小，核心只有两个东西：`controller.signal` 和 `controller.abort()`。`signal` 是一张“取消通知单”，传给支持它的 API；`abort()` 负责发出取消信号。

```js
const controller = new AbortController();
const { signal } = controller;

console.log(signal.aborted); // false

signal.addEventListener('abort', () => {
  console.log('已取消');
  console.log(signal.reason.name); // AbortError
});

controller.abort();
```

几个关键属性和行为：

| 成员 | 说明 |
| --- | --- |
| `controller.signal` | `AbortSignal` 对象，用来传递取消状态 |
| `controller.abort(reason)` | 触发取消，可选地传入取消原因 |
| `signal.aborted` | 是否已经被取消 |
| `signal.reason` | 取消原因；不传 `reason` 时默认为 `AbortError` 类型的 `DOMException` |
| `signal.throwIfAborted()` | 如果已取消，直接抛出 `signal.reason` |

`reason` 最好写清楚。调试时，“用户切换了筛选条件”和“请求超时”是完全不同的问题，不要都混成同一个默认错误。

## 取消 fetch 请求

`fetch` 原生支持 `signal`。请求被取消后，Promise 会以 `AbortError` 拒绝。

```js
async function loadUser(id, signal) {
  const response = await fetch(
    `https://jsonplaceholder.typicode.com/users/${id}`,
    { signal }
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

const controller = new AbortController();

loadUser(1, controller.signal)
  .then((user) => {
    console.log('用户名:', user.name);
  })
  .catch((err) => {
    if (err.name === 'AbortError') {
      console.log('请求已取消，不需要更新界面');
      return;
    }
    console.error('请求失败:', err);
  });

// 模拟用户触发了新的操作
controller.abort();
```

这里有两个容易忽略的细节：

- 取消的是浏览器端的等待和后续处理。服务器如果已经收到请求，仍可能继续执行。
- `AbortError` 通常是预期内的控制流，不应该和网络故障、HTTP 500 一样弹出错误提示。捕获时先判断 `err.name`，再决定怎么处理。

## 一个信号解绑多个事件监听

`addEventListener` 的第三个参数可以传入 `signal`。当信号被取消时，监听器会自动移除。这比手动保存每个处理函数再逐个 `removeEventListener` 干净得多。

```html
<button id="panel" type="button">点击面板</button>
<p id="status">等待操作</p>

<script>
  const controller = new AbortController();
  const { signal } = controller;
  const panel = document.getElementById('panel');
  const status = document.getElementById('status');

  panel.addEventListener('click', () => {
    status.textContent = '面板被点击';
  }, { signal });

  window.addEventListener('keydown', (event) => {
    status.textContent = `按下了 ${event.key}`;
  }, { signal });

  window.addEventListener('resize', () => {
    status.textContent = `窗口宽度: ${window.innerWidth}`;
  }, { signal });

  setTimeout(() => {
    controller.abort();
    status.textContent = '监听器已全部移除';
  }, 10000);
</script>
```

这个模式特别适合“有明确生命周期”的界面：弹窗打开时注册监听，弹窗关闭时调用一次 `abort()`，不用担心漏掉某个监听器。

## 把取消能力传进自己的异步函数

第三方 API 支持 `signal` 固然方便，但自己的函数也应该学会接收它。约定很简单：接受 `signal`，在开始前检查一次，在等待过程中监听取消。

```js
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason);
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function poll(task, signal) {
  for (let i = 1; i <= 5; i++) {
    signal?.throwIfAborted();
    console.log(`第 ${i} 次执行`);
    await task();
    await wait(1000, signal);
  }
}

const controller = new AbortController();

poll(() => Promise.resolve('ok'), controller.signal).catch((err) => {
  if (err.name === 'AbortError') {
    console.log('轮询已停止');
  }
});

setTimeout(() => controller.abort(), 2500);
```

这段代码可以直接在浏览器控制台或 Node.js 中运行。它展示了两个实用技巧：

- 用 `throwIfAborted()` 在循环、阶段切换、耗时计算前插入检查点。
- 等待类逻辑要同时处理“已经取消”和“等待途中被取消”两种情况，否则取消信号会漏掉。

## 超时和组合信号

实际业务里，取消原因往往不止一个：用户可能手动取消，请求也可能超时。现代 JavaScript 提供了两个静态方法来简化这类场景。

```js
async function loadWithTimeout(url) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(3000),
    });
    return await response.json();
  } catch (err) {
    if (err.name === 'TimeoutError') {
      console.log('请求超过 3 秒，已超时');
      return null;
    }
    throw err;
  }
}
```

`AbortSignal.timeout(ms)` 会在指定毫秒后自动取消，原因是 `TimeoutError`。如果还要支持“用户手动取消 + 超时取消”，可以用 `AbortSignal.any()` 把多个信号合成一个：

```js
async function search(keyword, userSignal) {
  const signal = AbortSignal.any([
    userSignal,
    AbortSignal.timeout(5000),
  ]);

  const response = await fetch(
    `https://jsonplaceholder.typicode.com/users?name=${encodeURIComponent(keyword)}`,
    { signal }
  );

  return response.json();
}

const controller = new AbortController();

search('Leanne', controller.signal)
  .then(console.log)
  .catch((err) => {
    if (err.name === 'AbortError') {
      console.log('用户取消了搜索');
    } else if (err.name === 'TimeoutError') {
      console.log('搜索超时');
    } else {
      console.error(err);
    }
  });
```

兼容性上，`AbortController` 和 `fetch` 的 `signal` 已经很普遍；`AbortSignal.timeout()`、`AbortSignal.any()`、`AbortSignal.abort()` 是较新的 API，在旧环境中可能缺失。需要兼容旧运行时时，可以自己用 `setTimeout` + `abort()` 实现超时。

## 容易踩的坑

- **取消不等于撤销副作用**：`fetch` 被取消后，前端不再等待，但服务器可能已经写入数据。真正需要“可撤销”的业务，要靠后端事务、幂等设计或补偿操作。
- **不要无脑吞掉取消错误**：如果用户主动取消是正常行为，可以安静处理；如果是意外取消，至少要记录日志，否则问题会被隐藏。
- **一个 signal 可以被复用**：把同一个 `signal` 传给多个 `fetch` 或监听器，一次 `abort()` 会全部取消。这是优点，也是风险，复用前先确认作用范围。
- **取消后再调用 `abort()` 不会重复触发新状态**：`signal` 一旦取消就保持取消，`reason` 也不会变。需要新的生命周期时，创建新的 `AbortController`。
- **把 reason 当作诊断信息**：`controller.abort(new DOMException('切换页面', 'AbortError'))` 比空参数更容易排查。调用方可以根据 `name` 分类，根据 `message` 记录上下文。

`AbortController` 的价值不只是“取消 fetch”。它把“停止”这件事变成了可传递、可组合、可监听的标准接口。异步逻辑一旦有了明确的取消边界，请求竞争、监听器泄漏和超时处理都会简单很多。

## 相关文章

- [setTimeout(fn, 0) 从来不是立即执行：读懂事件循环](https://daily.xplanc.org/zh/js/setTimeout%28fn,-0%29-从来不是立即执行：读懂事件循环.md)
- [ESM 循环依赖：为什么 import 进来的是 undefined](https://daily.xplanc.org/zh/js/ESM-循环依赖：为什么-import-进来的是-undefined.md)
- [structuredClone 复制不了什么](https://daily.xplanc.org/zh/js/structuredClone-复制不了什么.md)

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
