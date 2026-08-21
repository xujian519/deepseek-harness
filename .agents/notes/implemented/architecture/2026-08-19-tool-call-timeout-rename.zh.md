# Agent Note: 工具调用超时插件改名为 `timeout-guard`

Status: implemented

[English](2026-08-19-tool-call-timeout-rename.md) | 中文

## Problem

[仓库命名契约](2026-08-11-repository-naming-contract-and-rename-ledger.zh.md) 将插件命名为 `@deepseek-ai/dsh-tool-call-timeout-policy`，目录为 `packages/guard/timeout-policy/`，Cordis 插件 id 为 `timeout-policy`。该名称宣称了一个插件并不拥有的角色。角色词表将 `Policy` 保留给"决定什么被允许、被选择、被限制或被观察"的对象，并明确将策略与执行该决定的机制分开。本插件执行的是机制：它装配 deadline、替换 `exec.signal`，并在自己的计时器胜出时替换为 `TOOL_TIMEOUT` 结果。它不做任何决定——每个工具自行声明自己的 `timeoutMs` 预算。

该名称还重新引发了一个 `packages/*/tool-*` 目录命名问题，而 `tool-call` 限定词正是为此加入的：插件不注册任何面向模型的工具，因此 `tool-*` 目录名会与 `gen-tool-catalog` 完整性 glob 冲突。源码携带了一个 release-blocking `FIXME`，点名的正是这次改名，记录 `timeout-guard` 是预期名称（"与它的 `guard/` 所在组对齐"），并说明决策推迟到解决时点。

## Decision

插件改名为 `@deepseek-ai/dsh-timeout-guard`，目录为 `packages/guard/timeout-guard/`，Cordis 插件名与 id 为 `timeout-guard`，invariant 伴生插件为 `timeout-guard-invariant`。`guard` 命名了真实存在的角色：它监视 deadline 并拦截迟到结果，而不会宣称对预算拥有策略权威。

本决策取代 [仓库命名契约](2026-08-11-repository-naming-contract-and-rename-ledger.zh.md) 中该包的改名表行（`@deepseek-ai/dsh-timeout-policy` → `@deepseek-ai/dsh-tool-call-timeout-policy`），以及 [工具调用超时策略](2026-07-07-tool-call-timeout-policy.zh.md) 中的包名理由——仅限名称。超时机制、`TOOL_TIMEOUT` 分类、`tools/execute` 包装语义、`guard/` 所在组以及 `@deepseek-ai/dsh-timeout` deadline 库均不变；2026-07-07 note 仍是机制的 owner。package-regrouping note 记录 `guard/` 组清单与旧 `timeout/` 组的合并作为历史。

所有当前引用均使用新名称：bundle `cordis.patch.yml`、示例与测试 fixture、生成目录（module graph、config catalog）、文档，以及 implemented Agent Notes 中的事实名称。不再保留别名、兼容包或回退 id，仓库拒绝旧名称。打包的桌面后端树在下次 `package:desktop:prepare` 时以新名称重建；`apps/desktop/resources/mac/backend/` 下改名前的树是 gitignored 构建产物。

## Alternatives considered

**保留 `dsh-tool-call-timeout-policy`。** `tool-call` 限定词已经回答了 tool-catalog glob 冲突，因此保留名称只会移除 `FIXME`。`-policy` 后缀仍会宣称插件并不拥有的决定角色，角色词契约（"保持策略与执行器名称分离"）仍会被违反。

**使用 `tool-*` 名称，如 `tool-timeout`。** tool-catalog 完整性 glob 要求每个 `packages/*/tool-*` 目录注册一个面向模型的工具；本插件不注册任何工具，因此该名称要么导致 `verify-tool-catalog` 失败，要么强制产生误导性的启动条目。2026-07-07 note 记录了同样的拒绝理由。

**去掉限定词，改为裸 `timeout`。** `@deepseek-ai/dsh-timeout` 已经拥有 deadline 与分类库，因此无修饰的 `timeout` 将与插件消费的原语无法区分，`guard/` 组名也不再与包名对齐。

## Consequences

- 收益：名称与真实角色一致——guard 执行策略决定的机制；release-blocking `FIXME` 移除；插件 id、包名与目录现在一致；`tool-*` 目录命名绕路从命名理由中消失。
- 代价：旧名称保留在 git 历史以及 ledger、regroup 和备选记录的历史性表述中；五个 implemented notes 携带更新后的事实并交叉链接到本决策。
- 已验证：`verify-translation-pairing`（988 对）、`verify-agent-note-format`（566 个 note）与 `verify-md-links` 全部通过；本次改名修复了[协作式工具取消](2026-07-19-cooperative-tool-cancellation.zh.md) note 中 `packages/guard/timeout-policy/...` 的断链。
