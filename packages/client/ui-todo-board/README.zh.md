---
description: "Web GUI 的跨会话任务看板：会话视图环中的一个 tab，把当前工作区每个会话的最新待办列表聚合成三列状态看板；供看板体验的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-todo-board

[English](README.md) | 中文

## 概述

本包在 Web GUI 中渲染跨会话任务看板：会话视图环里与 Chat、Trajectory 并列的 `Board` tab。它把每个工作区会话的最新整张待办列表（由 `todo/write` 事件写入的 `todosLatest` 会话投影）折叠为三列状态——待开始、进行中、已完成——让当前工作区所有会话的工作在一处可见。每张卡片带一个会话徽标；激活徽标会在会话区打开所属会话。空看板渲染三列的虚线幽灵预览，让首次使用者看到真实待办将落入的形状。

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

与 `ui-conversation` 一起挂载本插件；tab 会出现在每个打开会话的视图环中。看板把范围定为当前会话所属的工作区——与侧边栏浏览器分组使用的成员关系一致。当当前会话不属于任何工作区时，看板改为显示所有工作区之外的会话。卡片实时更新：`todosLatest` 值随会话列表的投影列及其控制帧更新送达，因此范围内任何会话（包括后台运行的会话）的写入都会直接落到看板上，无需刷新。

### 列与卡片

每个列头显示本地化标签与卡片数。卡片逐字显示待办的 content 行，待办带有模型写入的标签时显示标签角标，并带一个会话徽标（会话的显示标题），其可访问名称包含卡片内容；激活徽标打开该会话。没有卡片的列显示一个破折号。

### 标签筛选

当任一可见卡片带标签时，列上方出现筛选条：一个「全部」选项加每个去重标签一个选项（按字母排序）。激活某选项只保留携带该标签的卡片（逐列）；「全部」或再次点击激活中的选项清除筛选；筛选中的标签从所有卡片消失（所属清单被重写）时，看板恢复为未筛选视图，直到选择改变。标签是待办条目上由模型写入的数据（见 `dsh-tool-todo`）——看板只渲染与筛选，不拥有标签。

### 空状态

在范围内任一会话写入待办之前，看板渲染标题、一句提示与幽灵预览：三个列头各配一张虚线占位卡片，并带 `预览` 角标。幽灵不含导航，也不含真实数据。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

视图是对框架标准钩子的纯投影：`useSessions` 提供列表行（含每行的 `projectionValues.todosLatest`），`useWorkspaces` 提供工作区成员关系；`board-model.ts` 在 `useMemo` 中把两者纯函数地折叠为三列。本插件不拥有 store、订阅机制或事件监听器——会话列表既有的投影管道（列表行加 `projection` 控制帧）是唯一的数据通道。tab 通过 `ctx.slots.inject` 注册进 `conversation.view` 插槽，其移除跟随声明方；inject 面只携带 `openSession`，它委托给会话控制器的 `open`。`todosLatest` 投影本身（整日志最后写入胜出、永不清空）由 `tool-todo` 与当前回合的 `todos` 单元并排注册和拥有。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当看板不够用时阅读这些页面。它们从浏览器 tab 走向 todo 领域与其填充的插槽。

- [dsh-tool-todo](../../todo/tool-todo/README.zh.md) — `todo_write` 工具以及看板读取的 `todos` / `todosLatest` 投影单元。
- [ui-conversation](../ui-conversation/README.zh.md) — 声明 `conversation.view` 插槽环并拥有视图 tab。
- [Client 包地图](../README.zh.md) — 相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

无——看板是对既有会话投影的只读视图；它不注册任何工具、提示词小节或会话事件。

#### KV Cache 效应

无；本包既不组装也不发送任何 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定当前的看板表面。它们是本包的现状约束，不是与 todo 领域的对比，也不是任务清单。

- **工作区范围，而非全局** — 看板显示当前会话的工作区（或游离会话）。其他工作区的待办按设计在此不可见。
- **仅卡片级交互** — 卡片提供到所属会话的导航；编辑或移动待办仍由模型的 `todo_write` 整表替换完成，看板渲染最新一次写入携带的内容。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随插件。本插件不拥有 store（数据经会话列表的投影列到达），不发出 cordis 事件，不持有跨插件可变状态；`conversation.view` 注册及其字典随插件 fiber 卸载（HMR 安全测试见 `tests/apply.client.spec.ts`）。
