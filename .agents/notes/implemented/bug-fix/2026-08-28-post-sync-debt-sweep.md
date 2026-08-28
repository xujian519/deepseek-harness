# Agent Note: Post-sync debt sweep (v0.1.2-alpha.1)

Status: implemented

English | [中文](2026-08-28-post-sync-debt-sweep.zh.md)

## Problem

The upstream v0.1.2-alpha.1 sync (953e7d370d) left two classes of debt. First, the desktop packaging chain was broken twice over: `REQUIRED_BACKEND_PATHS` in `scripts/desktop-package.ts` still required the deleted `dsh-host-apiproxy` package, and v0.1.2's peer-declared seam packages are dropped by `pnpm deploy --prod` because `apps/cli` does not declare them — the exact boot-failure mode the packaging script documents. Second, fact sources drifted from their copies: the `vendor/README.md` manifest table (9 of 10 version cells stale), the root `AGENTS.md` layout section (23 unlisted groups, two renamed-or-deleted entries, the root `examples/` line lost in the merge), the generated `docs/event-producer-consumer` pair (still listing `apiproxy`), and fork CI (no documentation gate, so the drift was silent). Separately, several items in `docs/TECH_DEBT.md` were cheap to close, cheap to disprove, or ready for a recorded decision.

## Decision

1. **Desktop chain**: removed the apiproxy required path from `scripts/desktop-package.ts` and its spec mirror; bumped `apps/desktop` to 0.1.2-alpha.1; declared the nine dropped peer seam packages (`dsh-attachment`, `dsh-client-store`, `dsh-credentials`, `dsh-hook-protocol`, `dsh-invariants`, `dsh-jobs`, `dsh-sdk-protocol`, `dsh-session-persistence`, `dsh-util-workspace-path`) as `apps/cli` production dependencies — the remedy the packaging script's own comment prescribes. Verified end to end: `build:lib` → `build:web` → `package:desktop:prepare` passes, deploy carries all statically imported specifiers, and the stale pre-merge `resources/` tree is regenerated.
2. **Fact sources**: `vendor/README.md` manifest refreshed to the actual vendored versions, with Commit cells marked `not recorded` (bump 7bedce822f replaced sources without recording pins; recover them per sync-procedure step 1 at the next sync). Root `AGENTS.md` layout now points at `packages/README.md` as the single home for the group map and records `apps/desktop` and root `examples/`. `packages/client/AGENTS.md`'s rpcId rule cites Connection directly instead of the migration note whose target package is gone. `docs/event-producer-consumer` regenerated and the zh twin's table re-synced row-for-row.
3. **Fork CI**: `node-checks` now runs `pnpm run test:docs` so generated-doc drift fails the fork build; the coverage exclude registers the fork-local families the per-file gate cannot hold yet (`patent/*`, `web/synapse`, `self-evolve/*`, `client/ui-agent-preset`, with a `TODO(cov)` marker) and drops the dead `packages/self-modification` entry. This closes item 3 of the 2026-08-26 hygiene-gate note.
4. **Ledger items closed**: M5 — `writeFileAtomic` fsyncs the temp file before the rename and best-effort flushes the parent directory after it, with the platform split isolated in `src/fsync.ts`; M7 — both `describe.skip` blocks restored (the full spec runs under one second; the recorded "60s timeout" reason was wrong) and the stale service-method expectation updated for the new `kind` discriminant; L1/L2/L5 — the `AGENTS.md` layout, `lsp` `finalExtension` internalized into `src/extension.ts`, `workflow` `WorkflowEventName` unexported, and `desktop/shell` `bridge-client` settles the pending entry (and detaches the abort listener) when the synchronous write throws.
5. **Sync follow-up 3 closed**: the stream-chunk skip-hardening is ported into the upstream fold — `isBlockIndex`/`isDeltaText` guards per chunk variant in `ui-chat` `conversation-nodes/assistant.ts`, the same index rule for packed chunk rows, and `AssistantMarkdown` coerces block bodies through `textOf`. Both `it.skip` cases are restored and pass.
6. **Disproven / decided**: H1 is false — cordis `resolveConfig` validates config through schemastery's `~standard.validate`, which reports no issues for absent keys, so the documented env fallback was always reachable; a regression test now pins the env-selection behavior and the schema is unchanged. M9 stays: the legacy migration shims' consumers are on-disk session logs of shipped desktop builds (DSH Patent 0.1.1-rc.2), which cannot be proven absent, and the fail-loud-plus-migrate design is deliberate; revisit at the first tagged release. `docs/TECH_DEBT.md` carries the full status update.

## Alternatives considered

**Make the web seam schema `.optional()` for H1.** Rejected: the failure mechanism does not exist against schemastery 3.18.1; changing the schema would encode a wrong model.

**Delete the M9 legacy migrations.** Rejected: shipped desktop installs may replay session logs carrying the legacy shapes; deletion is only safe at a format-version boundary.

**Extract the H5 announcement primitive and the H7 `emitContained` primitive now.** Deferred: both are core-lifecycle refactors the ledger schedules as their own reviewable PRs; folding them into this sweep would couple unrelated risk to a wide diff.

**Exempt only the exact uncovered files from the coverage gate.** Rejected in favor of family-level registration with a `TODO(cov)` marker, matching the existing GUI-debt exemption style and the hygiene note's framing.

## Consequences

Desktop packaging works against v0.1.2 and the packaged backend now carries every package its code statically imports; the deploy tree no longer contains deleted packages and the packaged app version matches the workspace. The fact sources match the tree, and fork CI fails on generated-doc drift going forward. `writeFileAtomic` writes are crash-durable on POSIX. A malformed assistant chunk degrades to a skipped block instead of crashing the conversation tree. The open list in `docs/TECH_DEBT.md` shrinks to H4/H5/H7/M1/M2/M3/M4/M6-remainder/M8/L3/L4 plus sync follow-ups 1 and 2.

## Supersession

Partial supersession of [2026-08-28-upstream-v0.1.2-alpha.1-sync](../process/2026-08-28-upstream-v0.1.2-alpha.1-sync.md): its follow-up 3 is closed here; follow-ups 1 (readFileText Remote gateway) and 2 (synapse live-reply) remain open and keep that note active. Partial supersession of [2026-08-26-hygiene-gate-debt-and-conflict](../../proposed/bug-fix/2026-08-26-hygiene-gate-debt-and-conflict.md): its item 3 is implemented; the `bundle/im` knip items remain with their window.
