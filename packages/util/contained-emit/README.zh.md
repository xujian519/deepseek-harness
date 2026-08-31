---
description: "基于 Cordis 的受控只读事件派发：运行每一个监听器、记录每一次失败，把否决语义留给调用方。"
kind: "package-library"
---

# @deepseek-ai/dsh-contained-emit

[English](README.md) | 中文

## 概述

Cordis 的 `emit` 通过 `Array.map` 遍历监听器：一次同步抛出会让后续所有监听器失去执行机会，而返回的 promise 稍后拒绝时会以未处理 rejection 的形式浮现。不允许否决已提交状态变更的通知需要相反的行为——每个监听器都运行，每次失败都变成一行日志。`dsh-contained-emit` 把这个循环提供一次：`emitContained` 派发一个 `emit` 模式事件并逐个监听器受控；`invokeContained` 受控一个已解析的回调快照（例如来自非事件总线的注册表）。调用方注入自己的日志标签与错误渲染器，因此这个零依赖包保持格式中立，适配任何消费方词汇。

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

在原本会调用 `ctx.emit` 发出非否决通知的地方使用 `emitContained`；当回调集合来自 `ctx.events.dispatch` 之外——私有监听器注册表，或必须在状态转换前解析的快照——使用 `invokeContained`。

### 派发受控通知

```ts
import { emitContained } from '@deepseek-ai/dsh-contained-emit'
import { errorMessage } from '@deepseek-ai/dsh-value'
import type { Context } from '@deepseek-ai/cordis'

declare const ctx: Context
declare const session: { id: string }

emitContained(ctx, `session "${session.id}": session/event`, ['session/event', { session }], errorMessage)
```

日志标签在两种失败形态中都逐字出现：同步抛出对应 `… listener threw: …`，返回的 promise 拒绝对应 `… listener rejected: …`。渲染器负责渲染捕获的值；需要短格式消息时注入 `errorMessage`，需要 cause 链时注入 `errorChain`，需要不同格式时注入包内自有渲染器。

### 受控来自私有注册表的快照

```ts
import { invokeContained } from '@deepseek-ai/dsh-contained-emit'
import { errorMessage } from '@deepseek-ai/dsh-value'
import type { Context } from '@deepseek-ai/cordis'

declare const ctx: Context
declare const listeners: Array<(owner: unknown) => unknown>
declare const owner: unknown

invokeContained(ctx, 'jobs: onJobsChanged', listeners, [owner], errorMessage)
```

`invokeContained` 是 `emitContained` 委托的那个循环；它完全不触碰事件总线。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

一个循环、两个入口，以及 Cordis 的参数形态契约。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `invokeContained`、`emitContained` 与 `ContainedListener` 回调类型 |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴生插件（无运行时不变式；受控行为由单元测试覆盖） |

### 派发参数契约

`ctx.events.dispatch('emit', args)` 会变异 `args`：它移走可选的前置 scoped carrier 与事件名，剩下的正是声明的监听器 payload，并返回绑定到该 carrier 的匹配回调。因此 `emitContained` 接受与 `ctx.emit` 相同形态的 `args`，用剩余 payload 调用每个回调，自己不需要任何参数重组。

### 受控形态

每个回调都在自己的 `try` 块内调用，`Promise.resolve(returned).catch(…)` 观察返回的 promise，因此同步抛出与异步拒绝各产生恰好一行 `ctx.logger.warn`。后续监听器总是运行；没有任何东西逃出这个函数。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [防御模式](../../../docs/defensive-patterns.zh.md)——本循环实现的受控要求。
- [Agent Note：abort-race 原语](../../../.agents/notes/implemented/architecture/2026-08-30-abortable-abort-race-sink.zh.md)——`dsh-timeout` 中相关的 promise 对信号原语。

-----

<a id="model-experience"></a>
## 模型体验

间接影响：通过拥有受控事件任何模型侧渲染的通知消费方间接影响。

#### KV Cache 影响

不会直接导致失效；派发的通知只产出日志，没有任何失败行到达模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明本包刻意不做什么。它们是当前包约束，不是任务积压。

- **只观察，绝不否决**——同步的监听器抛出会被记录，而不是传播。某通知的同步失败必须回滚状态转换（发布否决）时不适用本包；直接派发它，只受控返回的 promise。
- **仅 `emit` 模式派发**——`serial`、`waterfall` 与 `bail` 语义各有带否决或聚合契约的 Cordis 入口。
- **调用方拥有日志格式**——本包自身不渲染任何东西；两个消费方可以注入不同渲染器，以不同格式记录同一次失败。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
