# Agent Note：OpenViking 记忆插件

Status: implemented

[English](2026-08-23-dsh-openviking-memory-plugin.md) | 中文

## Problem

harness 需要一个跨会话长期记忆插件：会话中的用户偏好、项目知识、经验教训要能被后续会话语义检索，且上下文注入要省 token、可重放、不干扰现有组合。本仓库此前只有会话内上下文（`context/`）与本地会话检索（`session-query/`），没有外部上下文数据库集成。

## Decision

**新组 `packages/memory/` 承载 `@deepseek-ai/dsh-openviking`（单一包，函数插件）。** 集成对象是 [OpenViking](https://github.com/volcengine/OpenViking)（上下文数据库：`viking://` 虚拟文件系统、L0/L1/L2 分层、观察者队列）。对接方式是**混合双通道**：

- **直连 HTTP（召回/捕获/提交/管理）**：自研 `OpenVikingClient`（REST 面 `/api/v1/{search,content,fs,sessions,skills,stats,observer}`），可控、可测、不依赖子进程；凭据走 `X-API-Key` + account/user/agent 头。
- **MCP streamable-http 直连**：用 `@deepseek-ai/dsh-mcp-client` 的 `streamable-http` 传输直接指向服务器 `/mcp` 端点——**不写 stdio 代理**。官方 bundle 的 stdio 代理是因为旧版 `stateless_http` 下 `GET /mcp` 返回 idle SSE 流会把 SDK 卡住；实测 OpenViking 0.4.15 的 `/mcp` 正确处理 streamable HTTP（POST initialize/tools/list 正常），代理方案弃用。服务器升级新增工具自动同步。
- **3 个 HTTP 工具**（`memcommit`/`memqueue`/`memlearn`）：MCP `remember` 是服务器短生命周期会话，无法提交当前 DSH 会话；观察者队列无 MCP 面；主动沉淀（脱敏/查重/技能铸造）无 MCP 语义。

**召回注入走 `systemPrompt.context()` 通道，而非 pre-step 消息或 system-prompt section。** 关键证据：`complete: true` 的 persona 只把装配后的 `sections` 恢复为单一 section，**dynamic context 独立存活**（只有显式 `runtimeContextSuppressed` 才清空）；且该通道是"durable user-role snapshot"，满足 Model-visible ⟺ logged。pre-step 只负责 staging（查询来自已接受的批次），装配时渲染块。

**默认装载但 fail-soft。** 服务不可达时：插件照常激活、boot 探测一次告警（去重）、自动层静默跳过、显式工具调用给出明确错误、状态路由返回 `healthy: false`。

**本地配置与状态**：配置经 `installSettingsSection` 暴露 `openviking` namespace（Web UI 设置页自动渲染、校验在 seam 边界）；状态文件只存消息 seq/提交时间（原子写、corrupt/identity 变更隔离），传输 at-least-once，服务器靠 `source_message_ids` 去重。

**桌面发布版以 cli 生产依赖携带该插件，而非 profile 行。** 根 `pnpm-workspace.yaml` 的 `link:vendor/cosmokit`/`link:vendor/schemastery` override 仅对仓库内开发成立；打包 app 经 `scripts/desktop-package.ts` 的 `materializeExternalLinks` 拿到 schemastery 真实拷贝，部署门禁（`findUnresolvableBackendImports` + `verifyBackendDeploy`）在 openviking 或其运行时 import 缺失时令打包失败。

## Alternatives considered

- **stdio 代理桥（官方 bundle 模式）**——多一个常驻子进程、凭据要经 env 传入子进程；当前服务器 streamable HTTP 可用，否决。
- **11 个 mem* 全量工具（Rxiain 风格）**——与 MCP 工具面重复，双份维护面；只保留语义无法替代的 3 个。
- **系统提示 section 注入**——`complete: true` persona 下会被丢弃，否决（官方 bundle 同理改用 pre-step 消息；本包用 context 通道获得同一持久性且不污染消息流）。
- **desktop profile cordis.yml 默认装载**——改变所有桌面用户的出厂默认；patch-layer 按需启用保持默认不变，代价仅一条 cli 依赖 + 一条白名单条目。

## Consequences

- 新组 README 与 [packages/README.md](../../../../packages/README.zh.md) 组表已更新；`packages/memory/` 持有外部服务契约链接。
- Web 面：设置页自动获得 `openviking` 配置段；`GET /openviking/status`（host webServer 精确路由）提供健康+队列 JSON。
- 浏览器状态卡片（client ui-* 插件，含 client-build 注册）**未随本包落地**：client 侧 slot 集成与 client-build 注册面是独立大块，记录为包 README 的 Known Limitation。
- e2e 采用 opt-in 标记（`OPENVIKING_E2E=1` + 可达服务器），CI 无密钥自动跳过。
- `dsh-openviking` 条目同时存在于 `REQUIRED_BACKEND_PATHS` 与其 spec 镜像清单；两份清单必须同改（单侧改动即挂 `verifyBackendDeploy` 测试），日后移除携带须同步移除两条。
