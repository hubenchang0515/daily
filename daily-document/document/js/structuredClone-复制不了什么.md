# structuredClone 复制不了什么

`structuredClone` 已经是现代浏览器和 Node.js 17+ 的全局函数。很多人把它当成 `JSON.parse(JSON.stringify(obj))` 的替代品，甚至当成通用的深拷贝。大多数时候它确实更好用，但它的本质是“结构化克隆算法”：目标是把**数据**从一个执行环境搬到另一个执行环境，而不是把 JavaScript 对象原样复印一份。

理解这一点，很多看起来奇怪的行为就说得通了。

## 一次看起来成功的克隆

```js
class User {
  #token = "secret";

  constructor(name) {
    this.name = name;
  }

  greet() {
    return `hi, ${this.name}`;
  }
}

const user = new User("Ada");
const copy = structuredClone(user);

console.log(copy);                 // { name: 'Ada' }
console.log(copy instanceof User); // false
console.log(copy.greet);           // undefined
```

`copy` 里只剩 `name`。方法定义在原型上，没有被复制；`#token` 是私有字段，也不是可枚举的自有属性，同样没有出现。`structuredClone` 复制的是数据，不是行为。

## 它的复制规则

| 数据 | 克隆结果 |
| --- | --- |
| 普通对象、数组 | 复制自有、可枚举的字符串键 |
| `Date`、`Map`、`Set`、`RegExp`、TypedArray、`ArrayBuffer` | 按类型正确复制 |
| 循环引用、同一对象的多次引用 | 保留引用关系 |
| 类实例 | 原型丢失，变成普通对象 |
| getter | 求值后变成普通数据属性 |
| 不可枚举属性、Symbol 键 | 丢弃 |
| 函数、Symbol 值、Promise、WeakMap、Proxy | 抛出 `DataCloneError` |

这张表里最容易被忽略的是“自有、可枚举的字符串键”。换句话说，原型链上的东西不算，不可枚举的东西不算，用 Symbol 当键的也不算。

## getter 会被执行，描述符会被抹平

```js
const source = {
  firstName: "Ada",
  lastName: "Lovelace",
  get fullName() {
    console.log("getter 被执行");
    return `${this.firstName} ${this.lastName}`;
  },
};

const clone = structuredClone(source);
// getter 被执行

console.log(clone.fullName); // Ada Lovelace
console.log(Object.getOwnPropertyDescriptor(clone, "fullName"));
// { value: 'Ada Lovelace', writable: true, enumerable: true, configurable: true }
```

克隆时 getter 被调用了一次，返回值被写成普通数据属性。之后修改 `clone.firstName`，`clone.fullName` 不会跟着变。如果 getter 里有副作用，比如发请求、写日志、改计数器，克隆也会触发它。

不可枚举属性和 Symbol 键则会被直接丢弃：

```js
const source = { visible: 1 };

Object.defineProperty(source, "hidden", {
  value: 2,
  enumerable: false,
});

source[Symbol("id")] = 3;

console.log(structuredClone(source)); // { visible: 1 }
```

## 函数和 Proxy 会让整个克隆失败

和 JSON 方案不同，`structuredClone` 遇到不能克隆的值时不会静默跳过，而是直接报错：

```js
try {
  structuredClone({ onClick: () => {} });
} catch (err) {
  console.log(err.name); // DataCloneError
}
```

只要对象图里有一个函数，整个克隆就会失败，不会出现“其他字段复制成功、函数字段被忽略”的结果。Symbol 作为**值**时也一样：

```js
structuredClone({ id: Symbol("id") });
// DOMException [DataCloneError]
```

注意区分：Symbol 作为**键**时被忽略，作为**值**时抛错。

同样不能克隆的还有 Promise、WeakMap、WeakSet、Proxy，以及浏览器里的 DOM 节点。Proxy 尤其容易让人意外：它看起来像个普通对象，但结构化克隆算法无法安全地读取它的内部结构，只能拒绝。

## 它做对的两件事：循环引用和共享引用

```js
const shared = { n: 1 };
const source = { left: shared, right: shared };

const copy = structuredClone(source);

console.log(copy.left === copy.right); // true
console.log(copy.left === shared);     // false
```

克隆结果内部仍然共享同一个对象，但和原对象完全断开。循环引用也能保留：

```js
const node = { name: "root" };
node.self = node;

const copy = structuredClone(node);

console.log(copy.self === copy); // true
```

这是它比 `JSON.stringify` 更适合处理复杂数据的原因之一。JSON 方案遇到循环引用会直接抛 `TypeError`。

## transfer：从复制变成搬家

`structuredClone` 的第二个参数可以指定要转移的对象：

```js
const buffer = new ArrayBuffer(8);
const view = new Uint8Array(buffer);
view[0] = 42;

const moved = structuredClone(view, { transfer: [buffer] });

console.log(buffer.byteLength); // 0
console.log(view.byteLength);   // 0
console.log(moved[0]);          // 42
```

转移之后，原 `buffer` 被分离（detached），不能再读写；数据的所有权交给了克隆结果。对于大块二进制数据，这比复制一份更省内存，也更适合在主线程和 Worker 之间传递。

不是所有对象都能转移。常见的是 `ArrayBuffer`、`MessagePort`，浏览器里还有部分流对象。具体支持范围要看运行环境。

## 和 JSON 方案比，怎么选

| 行为 | JSON 方案 | `structuredClone` |
| --- | --- | --- |
| `Date` | 变成字符串 | 仍是 `Date` |
| `undefined` 属性 | 丢失 | 保留 |
| `NaN`、`Infinity` | 变成 `null` | 保留 |
| 循环引用 | 抛错 | 保留 |
| 函数属性 | 静默丢失 | 抛 `DataCloneError` |
| 类实例 | 变成普通对象 | 变成普通对象 |

如果数据本来就来自 JSON、IndexedDB 或 `postMessage`，`structuredClone` 基本是更安全的选择。它不会像 JSON 那样把 `Date` 悄悄变成字符串，也不会把 `NaN` 变成 `null`。

但它仍然不是“对象深拷贝”的完整答案。

## 什么时候不该用它

- **需要保留原型和方法**：不要指望克隆后还能调用实例方法。用构造函数重建，或者实现一个显式的 `clone()`：

  ```js
  const data = structuredClone(user);
  const copy = new User(data.name);
  ```

- **需要保留属性描述符**：getter、不可枚举属性、只读属性都不会原样保留。需要自己遍历 `Object.getOwnPropertyDescriptors()`，再用 `Object.create()` 重建。

- **需要复制函数**：函数是行为，不是可搬运的数据。把函数留在原对象上，或者把配置数据传过去，在目标端重新绑定。

- **只是浅拷贝**：对象展开、`Object.assign()` 更直接，也更便宜。

- **处理超大二进制数据**：优先考虑 `transfer`，避免无谓的整块复制。

`structuredClone` 仍然是 O(n) 的深拷贝，不会因为它是原生实现就免费。它最适合的场景是纯数据对象：配置、状态快照、跨线程消息、缓存条目。把这些数据交给它，通常比手写递归或 JSON 往返更可靠。

把它当成跨环境传递数据的工具，而不是对象复印机，选择就清楚了。

---

> 原文链接：[structuredClone 复制不了什么](https://daily.xplanc.org/js/structuredClone-%E5%A4%8D%E5%88%B6%E4%B8%8D%E4%BA%86%E4%BB%80%E4%B9%88.md)
