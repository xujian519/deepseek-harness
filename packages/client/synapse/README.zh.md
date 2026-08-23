# @deepseek-ai/dsh-client-synapse

[English](README.md) | 中文

Synapse 会话地图的浏览器半侧：**对话/会话地图** 视图切换与 `/synapse/` 全屏 iframe，通过客户端会话/工作区服务桥接。在画布中可浏览、分支、追问、新建会话；原生对话与当前会话双向跟随。

宿主半侧（`@deepseek-ai/dsh-host-synapse`）拥有画布页面与投影；本包只渲染宿主壳并转发桥接消息。

## 注册

Web 组合以 `dsh.client` 行 `synapse-client` 挂载本包（节点半侧为空 Loader 入口）。宿主行 `synapse` 同时挂载时，聊天界面出现地图切换；缺少它时 iframe 无内容。

## 模型影响

无：浏览器半侧从不触及模型请求；只读取客户端会话/工作区快照与已提交后的实时 partial。

#### KV Cache 影响

无：不发模型请求，不改动请求头。

## 已知限制与后续

- 地图运行在 iframe 内、使用自带 DOM/Markdown 栈；不属于 React 插槽系统，宿主主题令牌与无障碍约定在画布内不适用。
- 暴露的桥接面（create/fork/send/open/activate）是与画布约定的最小 RPC 契约；增加动词需同时扩展 `src/client/index.ts` 与画布 app。
