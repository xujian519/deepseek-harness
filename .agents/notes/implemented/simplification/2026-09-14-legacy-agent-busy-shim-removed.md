# Agent Note: Remove legacy agent-busy shim (M9)

Status: implemented

English | [中文](2026-09-14-legacy-agent-busy-shim-removed.zh.md)

## Problem

The 2026-08-17 tech-debt audit listed M9 as a legacy shim at `packages/api/remotes`'s `src/agent-lookup.ts:83` — a subagent-ownership fence that returned the old `agent-busy` RPC shape. At the time `SESSION_FORMAT_VERSION` was still 0 and the project had no compatibility promise, so the audit asked whether any real production consumer still needed the migration. The interim decision was to keep the shim and review it at the first tagged release or at the next `SESSION_FORMAT_VERSION` bump.

By 2026-09-11 `SESSION_FORMAT_VERSION` had reached 2 and the audit reopened M9 as Issue #98, requiring a fresh verification of consumers and a concrete decision: delete the shim, or record an explicit re-review condition.

## Decision

The legacy shim is already gone. The `dsh-v0.1.2-alpha.1` upstream Session Controller refactor (2026-08-22, "refactor(session): move APIs into Session Controller") deleted `packages/api/remotes`'s `src/agent-lookup.ts` entirely and reimplemented its subagent-ownership check inside the new Session Controller using the current RemoteError vocabulary (`session/agent-busy`). No consumer in the current tree references the old `agent-busy` code, the old `ApiRemote*` types, or the deleted file.

M9 is therefore resolved: the original legacy fence no longer exists, and the current `session/agent-busy` behavior is the documented, current design rather than a shim.

## Verification

- `git log --all -- '*agent-lookup.ts'` shows the module was removed by that same upstream refactor (211 lines deleted) and has no later commits.
- A repository-wide search for the old error string `'agent-busy'` (without the `session/` prefix) and for the old symbols `ApiRemoteLookupError`, `ApiRemoteAgentResult`, `ApiRemoteAgentOptions`, `ApiRemoteSessionNotFound`, `ApiRemoteSubagentSessionOwnership`, `hasApiRemoteSubagentOwner`, `apiRemoteSubagentOwnershipError`, `createApiRemoteAgentResolver`, and `inspectApiRemoteSession` returns no matches outside git history.
- `SESSION_FORMAT_VERSION` is currently `3` (`packages/core/session/src/types.ts:88`).
- The current subagent-ownership fence lives in `packages/api/session-controller/src/agent.ts` (`hasApiSessionSubagentOwner`, `apiSessionSubagentOwnershipError`) and returns `RemoteError<'session/agent-busy'>`, which is part of the documented resolver contract in `docs/api-gateway.md` and `docs/subsystems/session.md`.
- Historical session formats are handled by the adjacent migration codecs (`session-format-v0-to-v1`, `session-format-v1-to-v2`) and by the fail-closed storage contract in `packages/session/session-persistence/src/storage-contract.ts`; none of them retain the old `agent-busy` fence.

## Alternatives considered

- **Keep a re-review condition in the ledger.** Rejected: the original shim has already been deleted, so there is nothing left to review. Adding a future condition would perpetuate a closed item.
- **Purge any remaining subagent-ownership checks.** Rejected: the current `session/agent-busy` fence is not legacy; it protects the ordinary-session/subagent routing boundary that the refactor deliberately preserved.

## Consequences

- `docs/TECH_DEBT.md` no longer lists M9 as open.
- The tech-debt manifest entry for Issue #98 is closed.
- No source changes are required because the deletion already shipped.

## Related

- `docs/TECH_DEBT.md` M9
- `.agents/audits/2026-09-11-tech-debt-issue-manifest.md` Issue 21
- `packages/api/session-controller/src/agent.ts`
- `packages/core/session/src/types.ts`
- `packages/session/session-persistence/src/storage-contract.ts`
- `docs/api-gateway.md`
- `docs/subsystems/session.md`
