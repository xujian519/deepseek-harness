# Agent Note: 移除 legacy agent-busy shim（M9）

Status: implemented

[English](2026-09-14-legacy-agent-busy-shim-removed.md) | 中文

## Problem

2026-08-17 技术债务审计将 M9 列为 `packages/api/remotes` 的 `src/agent-lookup.ts:83` 的遗留 shim——一个返回旧 `agent-busy` RPC 形状的 subagent ownership fence。当时 `SESSION_FORMAT_VERSION` 仍为 0，且项目没有兼容承诺，因此审计要求验证是否仍有真实生产消费者需要该迁移。临时决策是保留该 shim，并在首个 tagged release 或下一次 `SESSION_FORMAT_VERSION` bump 时复审。

到 2026-09-11，`SESSION_FORMAT_VERSION` 已升至 2，审计将 M9 作为 Issue #98 重新打开，要求重新验证消费者并给出明确结论：删除 shim，或在台账中记录明确的复审条件。

## Decision

该 legacy shim 已经不存在。上游 `dsh-v0.1.2-alpha.1` 的 Session Controller 重构（2026-08-22，"refactor(session): move APIs into Session Controller"）完整删除了 `packages/api/remotes` 的 `src/agent-lookup.ts`，并将其 subagent ownership 检查在新的 Session Controller 中用当前 RemoteError 词汇（`session/agent-busy`）重新实现。当前代码树中没有任何消费者引用旧的 `agent-busy` 错误码、旧的 `ApiRemote*` 类型或已被删除的文件。

因此 M9 已收敛：原 legacy fence 已不存在，当前的 `session/agent-busy` 行为是已文档化的当前设计，而非 shim。

## Verification

- `git log --all -- '*agent-lookup.ts'` 显示该模块由同一次上游重构删除（删除 211 行），之后无提交记录。
- 全仓搜索旧错误字符串 `'agent-busy'`（不带 `session/` 前缀）以及旧符号 `ApiRemoteLookupError`、`ApiRemoteAgentResult`、`ApiRemoteAgentOptions`、`ApiRemoteSessionNotFound`、`ApiRemoteSubagentSessionOwnership`、`hasApiRemoteSubagentOwner`、`apiRemoteSubagentOwnershipError`、`createApiRemoteAgentResolver`、`inspectApiRemoteSession`，除 git 历史外均无匹配。
- `SESSION_FORMAT_VERSION` 当前为 `3`（`packages/core/session/src/types.ts:88`）。
- 当前 subagent ownership fence 位于 `packages/api/session-controller/src/agent.ts`（`hasApiSessionSubagentOwner`、`apiSessionSubagentOwnershipError`），返回 `RemoteError<'session/agent-busy'>`，属于 `docs/api-gateway.md` 与 `docs/subsystems/session.md` 中记录的 resolver 契约。
- 历史会话格式由相邻迁移 codec（`session-format-v0-to-v1`、`session-format-v1-to-v2`）及 `packages/session/session-persistence/src/storage-contract.ts` 的 fail-closed 契约处理；它们均未保留旧的 `agent-busy` fence。

## Alternatives considered

- **在台账中保留复审条件。** 已拒绝：原 shim 已被删除，无物可复审；添加未来条件只会让已关闭事项长期挂账。
- **一并删除所有剩余 subagent ownership 检查。** 已拒绝：当前 `session/agent-busy` fence 不是 legacy；它保护的是 refactor 刻意保留的普通会话 / subagent routing 边界。

## Consequences

- `docs/TECH_DEBT.md` 不再将 M9 列为开放项。
- Issue #98 对应的技术债务清单条目关闭。
- 无需源码改动，因为删除已随之前的提交发布。

## Related

- `docs/TECH_DEBT.md` M9
- `.agents/audits/2026-09-11-tech-debt-issue-manifest.md` Issue 21
- `packages/api/session-controller/src/agent.ts`
- `packages/core/session/src/types.ts`
- `packages/session/session-persistence/src/storage-contract.ts`
- `docs/api-gateway.md`
- `docs/subsystems/session.md`
