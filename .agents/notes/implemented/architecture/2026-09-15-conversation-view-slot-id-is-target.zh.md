# Agent Note：conversation.view slot 的 id 就是壳所激活的视图 target

Status: implemented

[English](2026-09-15-conversation-view-slot-id-is-target.md) | 中文

## Problem

ui-conversation 壳通过 slot 注册 id 选择一个固定 conversation 视图。[`activateView`](../../../../packages/client/ui-conversation/src/client/apply.ts) 把选中的 tab 解析为一个 slot id（`viewTabs` 发布 `{ id: entry.options.id }`，`resolveActiveView` 按该 id 匹配），并调用 `binding(sessionId).activate(active.id)`，最终到达 [`assembler.activateTarget(slotId)`](../../../../packages/client/ui-conversation/src/client/conversation/assembler.ts)。视图快照按 `ConversationViewDefinition.target` 索引：`resetViewBuilders` 把每个 builder 存在 `definition.target` 下，`activateTarget(target)` 只为它加入 `activeTargets` 的那个 target 构建快照，`flush()` 只重建处于激活态的 target。因此，一个组件按 target 读取快照的视图——`useConversation(state => state.views.get(TARGET))`——只有在其 slot id 等于其 target 时才会渲染。

有两个视图注册的 slot id 与它们读取的 target 不一致。[`ui-patent-teams`](../../../../packages/client/ui-patent-teams/src/client/index.ts) 用 id `teams` 配 target `patentTeams`；[`ui-document-studio`](../../../../packages/client/ui-document-studio/src/client/index.ts) 用 id `document` 配 target `documentDeliverables`。选中任一 tab 都会激活一个没有注册视图定义的 target，于是真正的 target 从未进入 `activeTargets`，其快照保持 `undefined`，组件回落到空态。document-studio 的 preset 自动切换带有同样的错位：`setActiveView(sessionId, 'document')` 传的是 slot id，所以 document-preset 会话也无法跳到 studio。

chat 和 trajectory 视图从未触发这个问题。它们的 slot id 已经等于各自的 target，并且通过 `binding.target(TARGET)` 读取——其订阅会直接激活 target，与 slot id 无关。没有测试发现这两个异常者：document-studio 的 `client-bundle` spec 断言 slot id 是 `document`，记录了这一错位却没有渲染视图，而 studio 视图没有 web e2e。

## Decision

一个 `conversation.view` slot 的注册 id 等于其组件读取的 `ConversationViewDefinition.target`。ui-patent-teams 注册 id `PATENT_TEAMS_TARGET`（`patentTeams`）；ui-document-studio 注册 id `DOCUMENT_DELIVERABLES_TARGET`（`documentDeliverables`），其自动切换调用 `setActiveView(sessionId, DOCUMENT_DELIVERABLES_TARGET)`。壳保持不变：按 slot id 激活是正确的，因为 slot id 就是视图在 `viewTabs`、`resolveActiveView`、`setView` 中的身份。本次修复把这两处注册对齐到壳早已假定的身份。

## Alternatives considered

- **按组件的 target 而非 slot id 激活。** 拒绝：slot id 是视图贯穿整个 tab 管线的身份，因此一个基于 target 的壳需要一张它并不拥有的 slot-id 到 target 的映射，而且会重新改动那两个因 id 等于 target 而已正常工作的视图。对齐这两个异常者比改动共享的激活路径更小。
- **从注册的组件或 builder 推导 target。** 拒绝：slot 注册与 `ConversationViewDefinition` 是插件各自独立做出的两项贡献；壳没有一个能在插件不声明的情况下读取组件 target 的接缝，而插件已经做出的声明就是 slot id。
- **保留错位并把空态写进文档。** 拒绝：一个在每次选择时都静默渲染空态的视图是面向用户的缺陷，不是有文档记录的局限。

## Consequences

两个视图都渲染出各自的折叠结果。新的 `conversation.view` 插件必须把其 slot id 设为组件读取的 target；chat 和 trajectory 视图不受影响，因为它们已经满足这一点并通过 `binding.target` 读取。document-studio 的 `client-bundle` spec 现在断言 slot id 与 `setActiveView` 的 target 都是 `documentDeliverables`。

## Testing

[`apps/web/tests/document-studio-panel.e2e.ts`](../../../../apps/web/tests/document-studio-panel.e2e.ts) 种入一个原生 v3 会话，携带一次 `document_deliver` 登记，选中 Deliverables tab，并把折叠出的文件列表录制为 golden：两个 chip 带各自的格式与质量门徽章，外加交付文件计数。该场景经过负向验证——把 slot id 还原为 `document` 后，列表锚点永不出现，渲染用例在空态上超时。[`apps/web/tests/patent-teams-panel.e2e.ts`](../../../../apps/web/tests/patent-teams-panel.e2e.ts) 为 Teams 视图守护同一契约。
