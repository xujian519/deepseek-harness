# Agent Note: 加固 stream-chunk 折叠以抵御畸形 delta

Status: implemented

[English](2026-08-27-hardening-stream-chunk-folding.md) | 中文

## 问题

一条 assistant 流若携带畸形 chunk，会把整棵会话树打崩而不是优雅降级。三类情况会到达渲染器：chunk 的 block 索引为负、小数或超大；`text-delta`/`reasoning-delta`/`tool-call-delta` 的载荷不是字符串；`block-end` 的 `block` 不是对象。partial 累加器（`packages/client/runtime/src/client/sessions/partial.ts`）把该索引直接写进稀疏 `blocks` 数组，projector（`packages/client/ui-conversation/src/client/conversation-nodes/assistant.ts`）在会话节点侧也这么做，而 `AssistantMarkdown` 原样把 `block.text` 喂给 markdown 渲染器。`block-end` 载荷为 null 会在 `toAssistantBlock` 抛错；非字符串 text 之后会到达 `MarkdownText`。在长时团队任务里，这表现为打开会话面板时白屏。

## 决策

`PartialAccumulator` 与会话节点 `updateChunk` 现在都在写入 block 前校验索引与载荷：

- `block-start`/`text-delta`/`reasoning-delta`/`tool-call-delta`/`block-end` 需要整数索引 `>= 0`（`isBlockIndex`）；delta 额外要求字符串载荷。
- `block-end` 要求非空对象（`isBlockPayload`），使 `toAssistantBlock` 只见到真正的 `ContentBlock`。
- `AssistantMarkdown` 经 `textOf` 把 block 体强转为安全字符串，非字符串映射为 `''`，markdown 渲染器不再收到非字符串。

畸形 chunk 被跳过：已累积的 blocks 原样保留，而不是写入越界槽位或抛错。`isVisibleAssistantChunk` 与 push 契约不变，被跳过的 chunk 不算可见变化。新增 client spec（`stream-chunk-resilience.client.spec.tsx`）投影畸形与极端 chunk 并渲染其 blocks 而不抛错。

## 备选方案

**只在渲染时给渲染器喂字符串。** 否决，因为越界/稀疏槽位与 `toAssistantBlock` 的抛错仍在——崩溃在 projector，不止渲染器。

**只校验索引，不校验载荷。** 否决，因为非字符串 delta 或 `block-end` 为 null 仍会到达 `toAssistantBlock`/`MarkdownText`。

## 影响

畸形 assistant chunk 现在降级为被跳过的 block，而不是打崩会话树；打开团队任务会话面板的白屏不再复现。由于防御校验同时跑在累加器与 projector 上，无论 chunk 走哪条路径投影都能存活。代价是每个 chunk 一次索引/载荷检查，相比渲染工作可忽略。
