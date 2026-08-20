# Agent Note: 任务专属界面的对话内渲染节点

Status: proposed

[English](2026-08-20-inline-rendered-conversation-nodes.md) | 中文

## 问题

对话流只能渲染预设节点：`packages/client/runtime` 里的 `ConversationNodeDefinition` + keyed renderer，工具的 UI 渲染意图只有 `generic`/`terminal`/`diff` 三种。图表、面板、表单这类任务专属界面需要"工具产出结构化数据 + 前端渲染器展示"，但当前既没有工具声明结构化输出的路径，也没有前端按数据渲染的路径。BitFun 的 Mini Apps（模型写 HTML/JS 在沙箱 iframe 中运行）提供了完整形态，但执行模型生成的代码改变了安全语义与成本量级——那是产品决策，不是当前阶段的 harness 能力。

## 提案

形态 A：对话内渲染节点，以 `packages/experimental/` 原型验证。不变量：界面永远是会话日志的投影——渲染器只消费已记录的数据，模型从不"读界面"，"Model-visible ⟺ logged"按构造成立。

- 工具声明结构化数据输出：工具契约增加数据形态（文档化的数据契约），渲染意图从预设三种（`packages/core/tools/src/presentation.ts` 的 `generic`/`terminal`/`diff`）扩展为"结构化数据 + 渲染器键"。内容块映射是 merge-extensible 的（`packages/llm/llm/src/types.ts` 的 `ContentBlockMap`），新增 data 块类型是自然落点。
- 前端按渲染器键注册 keyed renderer，从会话日志事件渲染节点，复用 `ConversationNodeDefinition` 的 `start`/`update` 角色与 turn/step 锚点。
- 新数据事件走会话事件契约：渲染视图与模型可见视图都从日志重建。
- 演示工具（如 chart 数据）产出结构化数据渲染为图表；keyless snapshot 覆盖该路径。

明确不做：iframe 沙箱、模型生成可执行代码、小程序市场。

## 曾考虑的替代方案

- **完整 Mini App 平台（BitFun 形态）**：模型写代码 + 沙箱 + 市场改变安全语义与工程量级；产品决策，延后。
- **扩展现有三种渲染意图的样式面**：无结构性进步，无法表达任务专属界面。
- **直接渲染模型产出的 HTML 片段**：执行不可信代码，不可接受。

## 验收标准

- experimental 包内演示工具产出结构化数据，前端 keyed renderer 渲染为图表或面板。
- 渲染器消费的每个字节都能从会话日志重建；无模型可见输入绕过日志。
- keyless snapshot 覆盖演示路径。

## 风险

- **渲染器碎片化**：每个工具一个渲染器，需要数据契约 + 渲染器注册约定；文档化渲染意图扩展。
- **与现有 tool presentation 体系的边界**：渲染意图从三种键扩展为任意键，需明确归属与兼容。
- **原型可能被废弃**：验收标准明确，未达即止。
