---
description: "面向模型的插件目录发现：列出已注册的目录源、搜索某个目录、安装前预览包。只读——安装仍走 `dsh plugin` CLI。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-plugin-market

[English](README.md) | 中文

## 概述

`dsh-tool-plugin-market` 给模型提供三个作用于宿主组合挂载的 `ctx.pluginMarket` 间隔的只读工具：列出当前会话可用的目录源、在某个目录里搜索插件、以及在安装前针对 npm 仓库预检一个包引用。每个动词都只读——本包不安装任何包、不改配置、不编辑任何 profile；安装仍由操作者驱动的 `dsh plugin` CLI 负责。它还注册一个教发现工作流的系统提示词章节，并读取由 `@deepseek-ai/dsh-host-plugin-market/provider` 以 DISCOVERY 模式提供的宿主 `pluginMarket` 服务。

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

把本插件挂载到「应当让模型能发现并评估插件」的 agent 预设上。它属于 agent 平面：把三个工具 schema 与 `tool:plugin-market` 提示词章节注册进预设的 scoped 工具层，并解析宿主组合已经提供的 `pluginMarket` 服务。`package/preset/agent-presets/presets/standard/agent.cordis.yml` 预设默认挂载它。

### 最小组合

```yaml
- name: '@deepseek-ai/dsh-host-plugin-market/provider'
  config:
    sourceFile: !!js dshHomePath('plugin-market/sources.json')
- name: '@deepseek-ai/dsh-tool-plugin-market'
```

宿主行必须先于 agent 预设运行，这样注入时 `pluginMarket` 已存在。standard 预设携带工具行；宿主 provider 属于 base 组合。

### 工具能做什么

三个工具都只读，并把 JSON 渲染成文本。

- `market_source_list`——列出插件市场上已注册的每个目录源，包括宿主自带的离线 DeepSeek 目录与任何用户注册的 HTTPS 目录，每个都给出稳定的 source id、provider id、显示名、是否内置标志与可接受的查询参数。
- `market_plugin_search`——搜索某个目录。省略 `sourceId` 时查内置目录；从 `market_source_list` 传入显式 source id 可搜索已注册的在线目录。用 `q`、`category`、`capability` 过滤，用 `limit` 限定页大小。
- `market_plugin_preview`——针对 npm 仓库预检一个包引用（`name@version`），报告它是否解析成功、任何拒绝原因、声明的生命周期脚本，以及其 engines 是否接受当前运行的 Node。

### 典型工作流

当用户要一个插件时，先调用 `market_source_list` 获取合法的 source id，用 `market_plugin_search` 找到候选，再在推荐安装前对命中项里精确的 `name@version` 调用 `market_plugin_preview`。把返回的包名与钉死的版本当作权威——原样引用它们。

### 需要规划的边界

搜索与预检都只读、绝不写入。不要声称某个包已安装、已加入 profile 或以其他方式落地：安装是 `dsh plugin` CLI 上的操作者动作。搜索命中只是发现信号，不是兼容性或安全保证——如实呈现预检的 verified/rejected 状态，而不是暗示该包可安全安装。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释工具背后的设计；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

工具集是 `pluginMarket` 服务上方薄薄的一层模型面向面。它只叠加模型面向的判断：显式的源解析（未知 source id 会大声失败，而不是悄悄搜错目录）、内置目录默认值让发现开箱即用，以及 require-agent 守卫防止工具调用跑出真实会话。三个动词在构造上就只读——它们从不触及安装路径。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`market_source_list` / `market_plugin_search` / `market_plugin_preview`、源解析，以及 `tool:plugin-market` 提示词章节 |
| [`src/prompt.ts`](src/prompt.ts) | `tool:plugin-market` 系统提示词章节 |
| — | 不发布运行时不变式伴生；此模型面向适配器不持有独立生命周期流，所有权关系继承自它读取的 pluginMarket 能力间隔。 |

### 一次调用的流程

每个工具的 `execute` 先断言一个 Agent-backed 会话，再读取源列表、解析目标源（显式 id → 内置目录 → 第一个注册源 → 大声失败），并把读取委托给 `ctx.pluginMarket.listSources` / `ctx.pluginMarket.search` / `ctx.pluginMarket.preview`。内置目录从不抓取它的 endpoint——`searchBuiltinCatalog` 是纯内存过滤；而用户注册的 HTTPS 源走市场的受限 fetch。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。

- [插件市场](../../host/plugin-market/README.zh.md)——工具读取所经过的 `ctx.pluginMarket` 服务间隔、wire schema、受限 fetch 与 npm 预检。
- [内置目录](../../../packages/host/plugin-market/src/builtin-catalog.ts)——搜索默认命中的始终可用的离线目录快照。
- [工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-plugin-market)——模型收到的确切工具 schema。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到的内容

该插件可见时，会话模型会看到 [`market_source_list`、`market_plugin_search` 和 `market_plugin_preview` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-plugin-market)。三个都声明 `{ type: 'json' }` 输出 schema，并渲染为文本。

#### Token 影响

该工具视图中的每次请求承担固定 schema 成本。

#### KV Cache 影响

只要该工具视图不变，前缀就保持稳定。隐藏这些定义的 scope 或插件生命周期变更，可能使从第一个变化的 schema token 起的复用失效。

### 系统提示词章节

#### 模型看到的内容

本包注册一个系统提示词章节（`tool:plugin-market`，order 2520），教模型何时以及如何使用插件发现工作流、推荐的工具顺序与只读边界；完整文本在 [`src/prompt.ts`](src/prompt.ts) 中。章节开头如下：

##### 章节开头

```markdown
# Plugin Catalog Discovery

The plugin market exposes read-only catalog discovery so you can find and evaluate DeepSeek Harness plugins from the model.
```

#### Token 影响

该插件可见时，章节渲染出的文本会在每次请求中重复。

#### KV Cache 影响

只要章节文本与顺序不变，前缀就保持稳定；编辑提示词或改变其顺序可能使从第一个变化 token 起的复用失效。

### 工具调用历史与结果

#### 模型看到的内容

源列表、搜索页与预检结果是渲染成文本的 JSON。每次拒绝都是携带可行动消息的工具错误——未知 source id 会点名缺失的源并指向 `market_source_list`；无 Agent 的会话会报告 require-agent 边界。

#### Token 影响

搜索与预检输出取决于数据，并在压缩（compaction）前重复发送。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明工具集何时不合适或需要特别小心。它们是当前包约束，不是任务积压。

- **只做发现，不做安装**——这些工具在构造上只读。安装、版本钉定、receipt 与回滚都在 `dsh plugin` CLI 上；模型无法落地一个包。
- **内置目录是发布快照**——默认的 `builtin-deepseek` 源是只在发布时刷新的离线目录。实时公开目录源需要已注册的 HTTPS 源（或未来的在线源），这是当前最大的缺口。
- **搜索命中不是保证**——发现并不验证兼容性、安全性或某包可安全安装；预检的顶层状态是最接近的信号，并以 verified 或 rejected 呈现，而非背书。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

按覆盖策略，`packages/extensions/*/src/**` 不在逐文件 100% 门禁内；正确性由 `tests/discovery.spec.ts` 与模型可见的 snapshot 路径钉住。

</details>
