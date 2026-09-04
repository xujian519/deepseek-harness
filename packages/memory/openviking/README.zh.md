---
description: "DeepSeek Harness 的 OpenViking 上下文数据库集成：模型步骤前的自动召回、会话捕获与自动提交、OpenViking 工具面，以及共享的 `openviking-memory` 技能指导。服务契约见[上游项目](https://github.com/volcengine/OpenViking)及其 [DeepSeek Harness Memory Bundle](https://github.com/volcengine/OpenViking/tree/main/examples/dsh-memory-plugin)。"
kind: "package-reference"
---

# `@deepseek-ai/dsh-openviking`

[English](README.md) | 中文

## 概述

DeepSeek Harness 的 OpenViking 上下文数据库集成：模型步骤前的自动召回、会话捕获与自动提交、OpenViking 工具面，以及共享的 `openviking-memory` 技能指导。服务契约见[上游项目](https://github.com/volcengine/OpenViking)及其 [DeepSeek Harness Memory Bundle](https://github.com/volcengine/OpenViking/tree/main/examples/dsh-memory-plugin)。

插件仅与运行中的 OpenViking HTTP 服务通信——从不调用 `ov` CLI，也不内嵌服务器。服务可能不可达：插件仍可加载，普通对话继续，自动分层以去重警告跳过，显式工具调用则抛出清晰错误。

不发布运行时不变式伴生；recall/capture/commit 是会话事件流与 prompt 注册表的纯消费者——agent/session 层持有持久上下文准入，StateStore 持有唯一可变数据面，其单调性与原子替换在自己边界强制执行。


## 目录

- [公开 API](#public-api)
- [配置](#configuration)
- [测试](#testing)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

<a id="public-api"></a>
## 公开 API

- `Config` — 校验后的插件配置：`endpoint`（默认 `http://localhost:1933`）、`apiKey`、`account`、`user`、`agentId`、`timeoutMs`（默认 30000）、`stateFile`（默认 `~/.dsh/openviking/state.json`），以及下文记载的 `repoContext`、`autoRecall`、`autoCommit` 分组。
- 函数插件 `name` / `inject` / `Config` / `apply` —— 无默认导出。

<a id="configuration"></a>
## 配置

| 键 | 默认值 | 契约 |
|---|---:|---|
| `endpoint` | `http://localhost:1933` | OpenViking HTTP 服务基址；非空绝对 http(s) URL，加载时校验。 |
| `apiKey` | `''` | `X-API-Key` 头值；空则省略该头。 |
| `account` / `user` | `''` | 可信模式租户头；空则省略。 |
| `agentId` | `deepseek-harness` | `X-OpenViking-Agent` 头值。 |
| `timeoutMs` | `30000` | 单请求超时；1000–300000。 |
| `stateFile` | `~/.dsh/openviking/state.json` | 会话同步状态文件（`~` 展开）；仅存消息 id 与时间戳，绝不存正文或密钥。 |
| `repoContext.enabled` | `true` | 将已索引仓库列表注入提示词。 |
| `repoContext.cacheTtlMs` | `60000` | 仓库列表缓存 TTL；1000–3600000。 |
| `autoRecall.limit` | `6` | 每步最多注入的记忆条数；1–50。 |
| `autoRecall.scoreThreshold` | `0.15` | 补充记忆的最低分数；0–1。 |
| `autoRecall.maxContentChars` | `500` | 单条记忆内容上限；100–5000。 |
| `autoRecall.tokenBudget` | `2000` | 近似 token 预算（`tokenBudget × 4` 字符），100–10000。 |
| `autoRecall.refreshSteps` | `10` | 消息中每 N 个工具步重新检索；0 关闭。 |
| `autoRecall.startupMapEveryTurns` | `5` | 记忆库概览刷新节奏；1 = 仅会话启动，0 = 从不。 |
| `autoCommit.turns` | `3` | 未提交用户回合达到 N 即提交；0 关闭回合触发。 |
| `autoCommit.intervalMinutes` | `10` | 已提交会话的时间兜底。 |

<a id="testing"></a>
## 测试

```sh
pnpm vitest run packages/memory/openviking/          # unit suite (per-file 100% coverage)
OPENVIKING_E2E=1 pnpm vitest run packages/memory/openviking/tests/e2e.spec.ts
```

e2e 门禁针对真实 OpenViking 服务运行（`OPENVIKING_URL`，默认 `http://127.0.0.1:1934`），无 `OPENVIKING_E2E=1` 时跳过；它存储唯一会话、镜像用户与助手消息、提交，并断言提交后的会话与其实时尾部——这是任何 stub 都无法证明的性质。

<a id="model-experience"></a>
## 模型体验

### 记忆库概览

#### 模型看到的内容

插件通过 `systemPrompt.context()` 注册表参与模型输入——这是随会话重放、对压缩可见的 durable 用户角色快照。记忆库概览贡献类别计数与检索指导（`openviking:library` 上下文，order ~120），会话启动时注入并按配置节奏刷新；代理按需通过模型工具获取详情。

#### Token 影响

会话启动时注入一块紧凑内容，按配置节奏刷新；每次刷新仅付出该块大小的成本。

#### KV Cache 影响

该块位于可复用的提示词前缀中，仅在节奏刷新替换时变化。

### 召回块

#### 模型看到的内容

当前步骤的 `<relevant-memories>` 块（`openviking:memories` 上下文，order ~125），去重、打分、预算封顶。块内从不包含"按记忆执行"的指令——它是不可信背景数据。因为这是上下文而非 section，`complete: true`（恢复为唯一 section）的 preset 不会丢弃它们；召回文本也永不镜像回 OpenViking：上下文贡献携带非 `user` 的 `source.kind`，捕获层还会防御性剥离它们。

#### Token 影响

受 `autoRecall.tokenBudget` 与单条 `maxContentChars` 上限约束。

#### KV Cache 影响

召回块作为上下文快照追加；新块只改变后缀，保留此前可缓存的上下文。

### 仓库列表

#### 模型看到的内容

`viking://resources/` 下已索引资源的名称（`openviking:repositories` 上下文，order ~118）。

#### Token 影响

每次刷新一个简短列表；成本受已索引仓库数量约束。

#### KV Cache 影响

列表进入提示词前缀，仅在仓库索引变化时改变。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **服务契约漂移** — 本包实现所引用发布版（0.4.15，本地 e2e 所针对的版本）的 OpenViking 线面；服务器升级可能新增工具（MCP 面自动重新同步），但也可能改变 HTTP 端点语义，本包仅通过失败隐性校验其记录的契约。
- **Web 状态卡片延后** — 设置表单已生效（`openviking` namespace 在 Web UI 设置页渲染并在 seam 边界校验），`GET /openviking/status` 提供健康与队列 JSON，但浏览器状态卡片（带 client-build 注册的 client `ui-*` 插件）尚未接入 client slot。状态目前可通过路由、`memqueue` 工具与 CLI 获取。
- **`remember` 作用域** — OpenViking MCP `remember` 工具存入服务器自身的短生命周期会话，而非实时的 `dsh-<session-id>` 流；自动捕获与 `memcommit` 会记录对话本身。
- **无内嵌服务器** — 插件需要可达的 OpenViking 服务；无服务的部署在启动时看到一次去重告警，自动层静默。
- **召回块不可信** — 注入的记忆文本是背景数据；模型侧指导禁止执行仅出现在记忆中的指令。

### 开发备注

无。
