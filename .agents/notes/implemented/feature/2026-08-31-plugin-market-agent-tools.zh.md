# Agent Note: 面向模型的插件目录发现工具

Status: implemented

[English](2026-08-31-plugin-market-agent-tools.md) | 中文

## 问题

插件市场能力间隔（[`@deepseek-ai/dsh-host-plugin-market`](../../../../packages/host/plugin-market/README.zh.md)）是一条完整的安装通道：目录源、受限 HTTPS 抓取、npm 预检，以及快照/回滚的安装 receipt。但它只能通过操作者驱动的 `dsh plugin` CLI 触达。运行在会话内部的模型看不到其中任何一部分：它无法枚举该部署注册了哪些目录源，无法在其中搜索某个包，也无法在推荐安装前针对 `name@version` 做校验。于是当用户让会话「加一个能做 X 的插件」时，模型只能靠猜包名和版本，或者发明一个并不存在的包——这正是独立项目 `deepseek-harness-studio` 通过其 `/find-plugins` 流程所凸显的既有缺口。

服务侧动作其实已经齐备；缺的是面向模型的那一层。补上它意味着把已有的只读动词包装成工具，让模型能回答发现流程所需要的三个问题：*有哪些源*、*什么能匹配这个查询*、*这个精确钉定是否存在且安装是否合理*。

## 决策

交付 [`@deepseek-ai/dsh-tool-plugin-market`](../../../../packages/extensions/tool-plugin-market/README.zh.md)：在宿主组合挂载的实时 `ctx.pluginMarket` 间隔之上提供三个只读工具，外加一段教流程的系统提示词章节。

| 工具 | 契约 |
|---|---|
| `market_source_list` | 列出每个已注册目录源：稳定 source id、provider id、显示名、内置标志，以及它接受哪些查询参数。 |
| `market_plugin_search` | 查询某个源。省略 `sourceId` 时命中内置目录；用 `q` / `category` / `capability` 过滤，用 `limit` 限定页大小。返回一页带来源标记的条目。 |
| `market_plugin_preview` | 针对 npm 仓库预检一个 `name@version`：是否解析成功、任何拒绝原因、声明的生命周期脚本，以及其 engines 是否接受当前运行的 Node。 |

每个动词从构造上就只读。它们不会安装包、不会编辑 profile、不会改 `cordis.yml`。安装仍由操作者驱动的 `dsh plugin` CLI 负责，因此 Agent 绝不在没有操作者明确决策的情况下落地一个包。

### 源解析

显式 source id → 内置目录 → 第一个已注册源 → 大声失败。未知 source id 会点名缺失的源并把模型指向 `market_source_list`，而不是悄悄搜错目录；没有任何已注册源的会话会得到带可行动信息的失败。每个 `execute` 先断言一个 Agent-backed 会话（require-agent 守卫），因此工具调用不会跑出真实会话。

### 内置源短路

内置目录是宿主提供的发布快照（`builtin-deepseek`），它从不抓取自己的 `builtin://` endpoint：`searchBuiltinCatalog` 是纯内存过滤，发现默认因此离线可用。实时公开目录源是走市场受限 fetch 的已注册 HTTPS 源，这是有待补齐的缺口（见包 README 的 Known Limitations）。

### 组合

它属 agent 平面并作用域到 preset 的工具层。standard agent preset 挂载 `@deepseek-ai/dsh-tool-plugin-market`；宿主 provider 行属于 base 组合。这是注册成 function plugin 的 cordis 配置（named-export `name` / `inject` / `apply`，无默认导出），其装载物即 CLI 所触及的同样的三个工具。

## 被否决的选项

- **不提供模型侧安装/卸载。** 写入 profile 需要审批与持久 receipt；它留在 CLI。模型的工作是发现并推荐精确钉定，而不是落地它。
- **不重复声明契约。** 工具复用 `plugin-market` 服务类型来表达 `CatalogPage` / `CatalogItem` / `InstallPreview`，而不是重新声明一遍，因此 wire schema 的改动不会漂移出一份镜像。
- **不并入浏览器 UI。** 发现面板留待独立面；本包只是面向模型的那一半。

## 生成的目录

三个工具 schema 被渲染进[生成的工具目录](../../../../docs/tool-catalog.zh.md)下的 `#deepseek-aidsh-tool-plugin-market`，与每个生成产物一样由同一新鲜度检查把关。
