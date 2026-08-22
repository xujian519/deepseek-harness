# @deepseek-ai/dsh-host-synapse

[English](README.md) | 中文

Synapse 会话地图的宿主半侧：`/synapse` 画布页面、静态资源与 `/synapse/api` JSON API，挂载在 DSH 现有 Web Server 上；外加投影存储——把已提交的 DSH 会话事件变成画布卡片（工作区、节点、分支锚点、折叠的工具过程）。

画布是派生、可重建的 UI 状态：DSH SessionStore 仍是会话事实来源。本包只读取**已提交**的会话日志，不向任何模型请求添加内容。

## 注册

Web 组合以行 `synapse` 挂载本包，以行 `synapse-client` 挂载 `@deepseek-ai/dsh-client-synapse`（对话/会话地图切换）。profile 可按 id 单独禁用任一行。

## 配置

| 键 | 默认值 | 说明 |
|---|---|---|
| `dataFile` | `$DSH_HOME/synapse/workspaces.json` | 画布元数据持久化路径 |
| `autoProjection` | `true` | 自动把已提交的 DSH 会话事件投影为画布卡片 |
| `projectionWorkspaceTitle` | `DSH 任务` | 无 cwd 会话的投影工作区标题 |
| `trustedHosts` | `[]` | `/synapse` Host 检查额外放行的权威；loopback 始终允许 |

## 模型影响

无：本包只读取已提交的会话事件并渲染；不添加系统提示文本、工具 schema 或请求上下文。

### KV Cache 影响

无：本包从不改变请求头、系统提示或工具注册表，可复用的 KV 前缀保持可复用。

## 已知限制与后续

- 地图 UI 是 iframe 内的静态浏览器脚本（`assets/app.js`）：使用自带的迷你 markdown 渲染器，而非仓库的 React 栈，不受客户端快照门禁覆盖。
- 画布元数据与会话日志分离：删除 `workspaces.json` 丢失布局与分支锚点，但不丢会话。
- 两个 `dsh web` 实例共享同一 profile 时写同一个 `workspaces.json`：有跨进程写锁与外部修改警告，但最后写入者覆盖仍可能发生——请只运行单实例。
- 旧版（v3）数据迁移时工具卡片按顺序配对；实时事件按 `callId` 配对。
