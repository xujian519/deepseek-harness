# Agent Note: 目录请求契约包装器在协议覆盖后保留

Status: implemented

[English](2026-09-28-catalog-request-contract-wrappers.md) | 中文

## Problem

pi-ai 的目录提供方拥有的不只是模型列表和 API 实现。OpenCode 网关拒绝任何缺少按会话区分的 `x-opencode-session` 的请求，因此 pi-ai 包装该提供方的每个实现，从请求的 `sessionId` 派生该标头；Cloudflare 提供方从自身认证解析所提供的环境值解析模型端点中的账户与网关占位符，因此 pi-ai 也包装它们的实现。

`dsh-llm-pi-ai` 以两种方式构建路由：profile 保持目录协议时复用目录提供方，否则基于自己的协议表重建提供方。重建会以裸实现替换被包装的实现，因此一条以 OpenCode 网关命名、同时显式声明 `api:` 的路由不发送会话标头，每个请求都在模型运行前被拒绝。这正是部署补充已安装目录尚未收录的模型时会走到的形态：OpenCode 目录是混合协议的，因此路由解析没有可继承的单一目录协议，并要求路由级 `api:`。

## Decision

`src/provider.ts` 维护一张按目录提供方 id 索引的请求契约包装器表——`opencode` 与 `opencode-go` 映射到 pi-ai 的 `withOpenCodeSessionHeader`，`cloudflare-ai-gateway` 与 `cloudflare-workers-ai` 映射到其 `cloudflareStreams`——并在 profile 覆盖路由协议时，把该提供方的包装器应用到替换后的协议实现上。包装器从 pi-ai 已发布的 `providers/*` 子路径导入而非在此复述，因此标头名与占位符名及其派生仍由上游拥有；OpenCode 包装器会跳过调用方已设置该标头的请求，因此部署在 `headers` 中固定的值得以保留。

该表按目录提供方 id 索引，且仅当路由命名了目录提供方时才被查询。pi-ai 未收录的路由没有可继承契约的目录提供方，因此不获得包装器；[包 README](../../../../packages/llm/llm-pi-ai/README.zh.md#known-limitations-and-deferred-work) 记录了该缺口与两条出路。

## Alternatives considered

**按端点主机匹配。** 只要路由的 `baseURL` 解析到 `opencode.ai` 就注入该标头，可以补上手写路由的缺口，但它把网关私有的请求约定写进 harness，重复了 pi-ai 已拥有的知识，也无法区分想要该标头的部署与不想要的部署。

**把标头名暴露为路由配置字段。** 一个 `sessionHeader` 字段能让任何部署声明任何标头，但它把提供方拥有的义务变成 harness 维护的兼容面，而目录路由已经携带正确答案。

**在适配器中复述这些义务。** 原生 `dsh-llm-deepseek` 适配器已经发送官方 DeepSeek 路由自己的会话标头，但那是另一个网关的约定。把 OpenCode 的写在旁边会重复一份上游契约，并随上游变更而失效。

**不支持覆盖路径。** 目录路由上的显式 `api:` 是补充已安装目录尚未收录模型的支持路径。任其损坏会让一条有文档记载的配置路径拒绝每个请求。

## Consequences

目录路由在协议覆盖后仍保留其提供方的请求义务，且义务的来源仍是 pi-ai。手写路由的缺口保持开放并有文档记载，因为补上它需要端点知识或新的配置面。

[`tests/catalog-stream-wrappers.spec.ts`](../../../../packages/llm/llm-pi-ai/tests/catalog-stream-wrappers.spec.ts) 钉住目录路径、覆盖路径、按会话派生、部署固定的标头、手写路由，以及未要求会话 id 的提供方不会收到它，并按同样的目录与手写之分钉住两个 Cloudflare 提供方 id 上的占位符解析。webworker 宿主的 pi-ai 桩把两个包装器都导出为拒绝，与其其他请求路径符号一致，因此真正到达它们的 worker 会大声失败，而不是静默丢弃该义务。
