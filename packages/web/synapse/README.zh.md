---
description: "Synapse 会话地图的宿主半侧：`/synapse` 画布页面、静态资源与 `/synapse/api` JSON API，挂载在 DSH 现有 Web Server 上；外加投影存储——把已提交的 DSH 会话事件变成画布卡片（工作区、节点、分支锚点、折叠的工具过程）。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-synapse

[English](README.md) | 中文

## 概述

Synapse 会话地图的宿主半侧：`/synapse` 画布页面、静态资源与 `/synapse/api` JSON API，挂载在 DSH 现有 Web Server 上；外加投影存储——把已提交的 DSH 会话事件变成画布卡片（工作区、节点、分支锚点、折叠的工具过程）。

画布是派生、可重建的 UI 状态：DSH SessionStore 仍是会话事实来源。本包只读取**已提交**的会话日志，不向任何模型请求添加内容。

不发布运行时不变式伴生；canvas 图是派生的、可重建的 UI 状态，其真值存放于 DSH SessionStore，该存储在变更时执行其唯一持有的关系，投影重放已提交日志而非发布独立原始事件流。


## 目录

- [注册](#registration)
- [配置](#configuration)
- [画布数据](#canvas-data)
- [模型影响](#model-experience)
- [已知限制与后续](#known-limitations-and-deferred-work)

<a id="registration"></a>
## 注册

Web 组合以行 `synapse` 挂载本包，以行 `synapse-client` 挂载 `@deepseek-ai/dsh-client-synapse`（对话/会话地图切换）。profile 可按 id 单独禁用任一行。

<a id="configuration"></a>
## 配置

| 键 | 默认值 | 说明 |
|---|---|---|
| `dataFile` | `$DSH_HOME/synapse/workspaces.json` | 画布元数据持久化路径 |
| `autoProjection` | `true` | 自动把已提交的 DSH 会话事件投影为画布卡片 |
| `projectionWorkspaceTitle` | `DSH 任务` | 无 cwd 会话的投影工作区标题 |
| `trustedHosts` | `[]` | `/synapse` Host 检查额外放行的权威；loopback 始终允许 |

<a id="canvas-data"></a>
## 画布数据

- 画布基线从 `SessionPersistence` 重放冷态恢复会话（按 revision 去重，重复便宜），叠加 live `session/created`/`session/event` 流与浏览器会话同步；fork 子会话跳过其继承的种子前缀，根会话从 seq 0 回放（此处的 `session/end-seed` 只是持久化快照边界，不是谱系裁剪）。
- 只有人类提问成为问题卡：user-role 注入（工作区指令、技能目录、运行时上下文快照）按 `source.kind` 识别并留在画布之外；空白会话（无人类提问）被跳过。
- `GET /synapse/api/sessions/<id>/history` 分页返回详情消息列表（`?limit`/`?beforeSeq`；默认先展示最近的消息，按需加载更早的段落），数据源为 `SessionPersistence.inspect`。不截断、工具过程折叠、注入上下文标记为 `context`。
- 地图文档以严格的 `Content-Security-Policy`（同源 script/style、`frame-ancestors 'self'`）返回，每个 `/synapse` 响应都带 `X-Content-Type-Options: nosniff`。
- 第二个 `dsh web` 实例写同一 `workspaces.json` 时不再被静默覆盖：自上次读取后文件 mtime 变化即重载磁盘状态并丢弃本地增量，同时大声告警（投影可从会话日志重建；手动布局是损失）。

<a id="model-experience"></a>
## 模型影响

无，宿主半侧仅把已提交的会话事件渲染到画布，不向任何模型请求添加提示文本、工具 schema 或请求上下文。

#### KV Cache 影响

无。本包从不改变请求头、系统提示或工具注册表，可复用的 KV 前缀保持可复用。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续

- 地图 UI 是 iframe 内的静态浏览器脚本（`assets/app.js`）：使用自带的迷你 markdown 渲染器，而非仓库的 React 栈，不受客户端快照门禁覆盖。
- history 端点分页返回会话日志（`?limit`/`?beforeSeq`）：详情视图先展示最近的消息，按需加载更早的段落，超长对话不再一次性全量加载。
- 两个 `dsh web` 实例共享同一 profile 在同一瞬间仍会竞争；mtime 冲突检查与锁窗口串行化，失败一方的本地增量被丢弃并告警，而不是合并。
- 旧版（v3）数据迁移时工具卡片按顺序配对；实时事件按 `callId` 配对。

### 开发备注

无。
