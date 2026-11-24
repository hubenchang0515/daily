> 原文链接：[Qt 的 deleteLater：调用了删除，对象却还活着 - 码日新 · 每日文章](https://daily.xplanc.org/zh/qt/Qt-的-deleteLater：调用了删除，对象却还活着.md)

---

# Qt 的 deleteLater：调用了删除，对象却还活着

在 Qt 程序里，你大概写过这样的代码：窗口关闭时想销毁自己，于是调用 `deleteLater()`，然后以为这一行执行完对象就没了。可下一行代码还在用它的成员，程序也没崩——因为 `deleteLater()` 从来不是“立即删除”，它只是往事件循环里投了一张“稍后销毁”的工单。搞不清这张工单什么时候兑现，正是很多 Qt 内存问题、悬空指针和“对象怎么还没析构”谜题的源头。

## 为什么不能直接 delete

要理解 `deleteLater()`，得先明白 Qt 为什么不让你在某些情况下直接 `delete`。

信号槽是最典型的场景。一个信号被发射时，Qt 会依次调用所有连接到它的槽，而发射信号的那段代码往往还没走完，后续可能还要访问 sender。如果某个槽里把 sender 直接删了，发射方持有的指针就悬空了。

```cpp
// 危险：dialog 的 accepted 信号还在发射过程中
connect(dialog, &QDialog::accepted, this, [=]() {
    delete dialog;
    // emit accepted() 的代码后续仍可能访问 dialog
});

// 安全：把销毁推迟到事件循环
connect(dialog, &QDialog::accepted, this, [=]() {
    dialog->deleteLater();
});
```

还有一种常见情况是对象在成员函数里“自杀”：`delete this` 之后函数栈帧还没退，下一行继续访问成员变量就是 use-after-free。`deleteLater()` 把销毁推迟到函数返回之后，恰好避开了这个窗口。

## deleteLater 到底做了什么

`QObject::deleteLater()` 并不碰对象的内存，它只做一件事：往对象所属线程的事件队列投递一个 `QEvent::DeferredDelete` 事件。等事件循环处理到这个事件时，才真正执行 `delete`。

```cpp
auto* obj = new QObject(this);
obj->deleteLater();
qDebug() << obj;   // 此时 obj 仍然有效
// 当前函数返回、控制权回到事件循环后，obj 才被销毁
```

这个设计带来几个重要性质：

- **不会打断当前事件**：对象只会在控制权回到事件循环后才被删，正在执行的代码可以安全用完它。
- **可跨线程调用**：哪怕你在别的线程里对某个对象调用 `deleteLater()`，事件也会被投递到对象所属的线程，在那里完成销毁，避免跨线程 `delete` 的竞态。
- **重复调用安全**：同一个对象连续调用多次 `deleteLater()`，只会投递一次删除事件，不会重复析构。

## 删除发生的真实时机

“回到事件循环”这句话有几个容易被忽略的细节。

**没有事件循环，就永远不删。** 如果你在一个没有运行事件循环的线程里调用 `deleteLater()`，对象不会被销毁（Qt 会在该线程结束时才清理）。控制台程序里 `QCoreApplication::exec()` 之前就调用的 `deleteLater()`，往往就掉进了这个坑。

**嵌套事件循环不算数。** Qt 文档明确说：进入并离开一个新的事件循环（例如弹出一个模态对话框）不会触发延迟删除；对象必须等控制权回到**调用 `deleteLater()` 时所在的那个事件循环**才会被删。

```cpp
void MyWidget::onClose()
{
    auto* dlg = new QDialog(this);
    dlg->deleteLater();
    dlg->exec();       // 嵌套事件循环：dlg 不会在这里被删
    // exec() 返回后，控制权回到外层事件循环，dlg 才真正销毁
}
```

**DeferredDelete 事件有优先级。** Qt 会把延迟删除事件排在普通事件之后处理，确保同一批投递的事件（比如多个信号）都处理完，再统一清理，避免中途把还在用的对象抽走。

## 几个常见误区

**误区一：调用完就当对象没了。** `deleteLater()` 之后对象依然活着，继续发信号、被别的槽访问都可能发生。如果需要立刻逻辑上“失效”，应配合标志位或先 `disconnect`。

```cpp
obj->disconnect();      // 先断开所有连接
obj->hide();            // 立刻从界面上消失
obj->deleteLater();     // 再安排物理销毁
```

**误区二：把 deleteLater 当成取消删除。** 一旦投递了删除事件，除非对象在这之前被别的方式销毁（Qt 会在析构时自动移除尚未处理的 DeferredDelete 事件），否则它一定会被删。想“反悔”是不可能的。

**误区三：和对象树混为一谈。** Qt 的父子机制会在父对象销毁时自动删除所有子对象，这是另一条独立的路径。`deleteLater()` 只推迟“谁来删”，不改变父子关系；一个设了 parent 的对象，父对象先被删时它照样跟着走，轮不到自己的 DeferredDelete 事件。

## 和父子对象树怎么配合

理解这两条路径，能解释很多“ mystery ”：

| 场景 | 谁负责销毁 |
| --- | --- |
| `new QObject(parent)`，从不手动删 | parent 销毁时自动删除 |
| 子对象自己 `deleteLater()` | 事件循环兑现时删除，同时从 parent 的 children 里摘除 |
| parent `deleteLater()` | parent 被删时，整棵子树一起递归销毁 |
| 栈上 QObject + `deleteLater()` | 危险：栈对象会自动析构，随后事件循环再删一次导致 double free |

最后一行值得单独说：对栈上对象调用 `deleteLater()` 是典型的 double free 源头。栈对象离开作用域时自动析构，而事件队列里还留着对它的删除事件，兑现时就会二次释放。

## 实践建议

把下面几条当作日常规矩，能避开绝大多数坑：

- 在槽函数、事件处理器里需要删除对象时，一律用 `deleteLater()`，不要直接 `delete`。
- 调用后立刻停止使用它：先 `disconnect`、`hide`，再安排销毁，不要指望“马上就没了”。
- 确认销毁发生的线程有运行中的事件循环；工作线程里的对象尤其要检查。
- 永远不要对栈上的 QObject 调用 `deleteLater()`。
- 调试析构时机时，在类的析构函数里打日志，对比 `deleteLater()` 调用点与日志时间点，差异就是事件循环的排队延迟。

`deleteLater()` 的本质，是把“销毁”这件危险的事交给事件循环在安全点统一处理。它换来的安全性，代价就是你不能再假设删除是同步发生的。接受这点，那些“对象怎么还活着”的困惑就迎刃而解了。

## 相关文章

- [Qt 链接报 vtable 未定义，问题常常不在你的代码里](https://daily.xplanc.org/zh/qt/Qt-链接报-vtable-未定义，问题常常不在你的代码里.md)
- [QSettings 写了，重启怎么又没了](https://daily.xplanc.org/zh/qt/QSettings-写了，重启怎么又没了.md)
- [Qt 隐式共享：一次赋值，内存到底拷没拷](https://daily.xplanc.org/zh/qt/Qt-隐式共享：一次赋值，内存到底拷没拷.md)
- [Qt 信号槽：槽函数到底在哪个线程执行](https://daily.xplanc.org/zh/qt/Qt-信号槽：槽函数到底在哪个线程执行.md)

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
