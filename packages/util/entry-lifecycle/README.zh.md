---
description: "单个注册表条目的发布状态：一次创建公告、让它保持存活的监听器派发，以及延迟到最后一个派发才执行的移除"
kind: "package-library"
---

# @deepseek-ai/dsh-entry-lifecycle

[English](README.md) | 中文

## 概述

注册表分两步发布一个条目：先把它插入为存活状态，再公告它的创建。这个确切的条目必须在公告派发结束之前保持可见，因为创建监听器可能在它仍被调用时就移除它。`dsh-entry-lifecycle` 把这份状态集中一处——`announce` 认领唯一的创建边，`beginDispatch`/`endDispatch` 括起任何仍需观察该条目的后续派发，`detachCapability` 把移除变成一次性请求，在最后一个打开的派发结束时执行。本包只持有这份状态：存储成员关系、事件载体与销毁通知仍归注册表所有。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

条目的所有者保留条目本身、它的存储成员关系与销毁通知；本包负责发布顺序。所有者把条目插入为存活状态、交出移除能力，最后关闭公告派发：

```ts
import { EntryLifecycle } from '@deepseek-ai/dsh-entry-lifecycle'

interface Entry {
  readonly id: string
  readonly lifecycle: EntryLifecycle
}

declare const store: Map<string, Entry>
declare function detachEntered(entry: Entry): void
declare function dispatchCreated(entry: Entry): void

function enter(id: string): () => void {
  const entry: Entry = { id, lifecycle: new EntryLifecycle() }
  store.set(id, entry)
  return entry.lifecycle.detachCapability(() => { detachEntered(entry) })
}

function announce(entry: Entry): void {
  entry.lifecycle.announce(`session "${entry.id}"`)
  try {
    dispatchCreated(entry)
  } finally {
    // A listener that removed the entry mid-dispatch left a request; removal
    // runs here, after that dispatch unwound.
    if (entry.lifecycle.endAnnouncement()) detachEntered(entry)
  }
}
```

自身派发不得重入的发布方，在开启派发前先读 `hasOpenDispatch`，用 `beginDispatch`/`endDispatch` 括起它，并在 `endDispatch` 返回 true 时移除条目。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `EntryLifecycle`——公告认领、派发窗口与延迟移除请求 |
| — | 不发布运行时不变式伴生；此纯状态机不持有事件流或可变运行时数据，其顺序规则由单元测试覆盖。 |

### 两条边，一种顺序

移除跟随监听器可能已经看到的创建：`announce` 在所有者派发之前就认领创建边，因此在派发中间移除条目的监听器不可能产生早于该创建的销毁——请求只在派发结束之后才被兑现。认领本身也是唯一的：第二次 `announce` 会被拒绝，包括来自创建监听器的重入调用。

### 一次请求，一次移除

`detachCapability` 是一次性的，因此重复调用同一个 disposer 不可能移除第二个条目。兑现延迟请求的转换在返回 true 的同时消费该请求，从而保持一次请求等于一次移除。打开中的派发计数是延迟移除的唯一依据，因此嵌套在别的派发内部的派发会让条目保持存活，直到最外层派发结束。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [防御模式](../../../docs/defensive-patterns.zh.md)——本状态机实现的发布与销毁顺序规则。
- [受控派发](../contained-emit/README.zh.md)——`util/` 中同族的原语，让每个监听器都运行、不因一次失败饿死其余监听器。

-----

<a id="model-experience"></a>
## 模型体验

无，因为这个进程内发布状态不注册任何面向模型的内容。

#### KV Cache 影响

这里的内容不会进入模型请求，因此不影响提供方缓存复用。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明本包刻意不做什么。它们是当前包约束，不是任务积压。

- **只支持同步派发**——窗口在对应的同步派发返回时关闭，返回 promise 的监听器会立即释放条目，与 Cordis 自身的 `emit` 完全一致。在带移除的监听器前等待其完成，在本包中无法表达。
- **条目本身归所有者**——本包不跟踪存储、载体或主体；移除、销毁与重新注册同一个 id 都仍是所有者的决定。
- **每个 `beginDispatch` 都需要对应的 `endDispatch`**——打开计数是延迟移除的依据，未配对的打开会让条目无限期保持存活。
- **不设重入策略**——`hasOpenDispatch` 只报告存在打开中的派发；不得重入的发布方自行执行该规则。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
