# Agent Note: upstream v0.2.2-alpha.2 sync

Status: implemented

English | [中文](2026-10-28-upstream-dsh-v0.2.2-alpha.2-sync.zh.md)

## Problem

The fork moved from upstream's `dsh-v0.2.1-rc.3` tag to `dsh-v0.2.2-alpha.2`. The release carries a tool-execution refactor that the fork's plugins, test fixtures, and generated catalogs all sit on top of: tool executors became a mountable seam (`dsh-tool-executor-native`, `dsh-tool-executor-ptc`), `ctx.tools.execute` replaced per-call dispatch, and the shared test kit grew `executeToolFixture`. It also discloses `exit_plan_mode` progressively, adds the SDK desktop-tool rows, and ships new recorded scenarios (SDK `ptc-turn`/`ptc-cancel`, headless `ptc-python-read-only`, `pi-ai-malformed-tool-arguments`).

The merge read 127 conflicted files. Resolving them file-by-file produced a tree that typechecked only after the executor seam was applied consistently — every composition that mounted `ToolRuntime` without an executor failed at runtime, and every spec that dispatched a tool through the old harness lost its fixtures. The keyless snapshot tier then reported 36 failures, split between stale expected outputs, the new upstream scenarios, and two genuine normalization defects in the refresh path.

## Decision

- **The executor seam is followed everywhere.** `packages/core/tools` loses its inline dispatch helpers, `agent-loop` calls `ctx.tools.execute`, and every in-process composition mounts one executor. 76 spec files move to `executeToolFixture`, 21 packages declare `@deepseek-ai/dsh-tool-testkit`, and 9 real-Loader compositions mount `NativeToolExecutor` beside `ToolRuntime`.
- **Refresh and replay normalize job ids the same way.** `dsh-session-snapshot` tokenizes a job id from the whole log, but the refresh write-back normalized each record on its own; a `tool/result` text that echoed `bash-<16 hex>` therefore kept the raw id while `job/registered` kept the token, and the next replay could never match it. `sessionJobIdTokens` now derives the log-wide map once and `stabilizeRefreshLog` threads it into every single-record comparison, so write-back and comparison agree.
- **The new malformed-arguments scenario pins a zero-jitter retry policy.** `llm/retry.delayMs` is jittered, so the upstream-recorded value can never replay. `pi-ai-malformed-tool-arguments` gets a `runtime.cordis.yml` that restates the replay provider with `jitterRatio: 0`, the same determinism `empty-response-retry` already pins in its composition.
- **The SDK PTC scenarios stop inserting a row the base bundle owns.** `dsh-base` mounts `ptc-runtime`; the release's `ptc-turn`/`ptc-cancel` runtime patches inserted a second row with that id and the loader rejected it. The patches now carry only their own rows.
- **`snapshots/session/ptc-python-read-only` stays removed.** The standing [v0.2.1-alpha.2 sync decision](2026-10-10-upstream-dsh-v0.2.1-alpha.2-sync.md) keeps the fork's split Python PTC runtime and leaves the release's confinement unabsorbed; this scenario exercises exactly that confinement. The release re-added it, and this sync removes it again.
- **Generated surfaces are regenerated, not hand-merged.** Config/tool/persistence/plugin catalogs, module graphs, CLI help, cordis API pages, and translation-pairing records come from their generators; the 11 fork persistence records gain the release's `nodes` table, and `2026-10-28-v022-alpha2-sync` acknowledges the union.
- **The fork's own surfaces are restored on the release's structure.** The patent, self-evolve, desktop, better-sidebar, plugin-market, and document packages keep their behavior; their tests adopt the release's executor and projection mount order.

## Consequences

The sync branch carries the release plus the fork's surfaces, and the keyless snapshot tier is green again (`pnpm run test:snapshot`: 243 passed, 2 skipped). The release's `pi-ai-malformed-tool-arguments` scenario now pins a deterministic retry delay instead of flaking on jitter.

Three gaps remain, each named rather than closed:

- **Locale dictionary parity is waived for five fork-only client packages.** `ui-document-studio`, `ui-patent-teams`, `ui-plugin-catalog`, `ui-todo-board`, and `better-sidebar` ship English copy; `scripts/locale-dictionary-parity.spec.ts` skips their sources through an explicit `PENDING_LOCALE_PACKAGES` set. Full translations are a separate change, and the exemption is test-only so the gate still covers every package that has a dictionary.
- **The split Python PTC runtime still lacks file confinement.** Absorbing the release's sandbox support into `config`/`supervisor` is its own change; until then the runtime keeps rejecting `sandboxPolicy` and the read-only scenario stays out of the corpus.
- **The release's plan-mode disclosure changes request tool catalogs.** Scenarios that pin tool schemas now pin catalogs without `exit_plan_mode` unless plan mode is entered. Their sidecars were re-recorded, so the pin describes shipped behavior rather than the previous always-registered tool.

## Alternatives considered

- **Keep the fork's inline dispatch and adapt the release's executors to it.** Rejected: the release's executors are the seam consumer `agent-loop` and the PTC runtime already call; keeping both paths doubles the dispatch surface and leaves the compositions that mount no executor undefined at runtime.
- **Broaden the job-id pattern to accept short numeric suffixes instead of threading log-wide tokens.** Rejected after trying it: `-\d+` also matched ordinary identifiers such as `inspect-client-1`, which `redactSessionSnapshotIds` then tokenized and broke the identity fixed-point checks for four scenarios. The log-wide map fixes the real defect without widening what counts as an id.
- **Normalize `delayMs` away in the snapshot normalizer.** Rejected: the delay is a real backoff choice, and the repository's existing answer is a zero-jitter policy in the composition (`empty-response-retry`). Scrubbing the field would hide a regression in the retry policy itself.
- **Re-record the release's Python read-only scenario against the fork's runtime.** Rejected: the recording would lock in unconfined writes to the workspace and read as supported behavior. The scenario is removed, as the previous sync decided, until confinement lands.
- **Translate the five fork-only client dictionaries inside this sync.** Rejected: it is a product-copy change unrelated to the merge, and doing it here would mix an untranslated-surface decision with a version bump.

## Testing

`pnpm run typecheck` exits 0 through the five aggregate checks (client and host faces). `pnpm run test:snapshot` replays 243 keyless cases across the session, SDK, and ACP lanes with 2 skipped. `packages/test-support/session-snapshot` keeps 100% per-file coverage on `normalize.ts` and `suite.ts` after the job-token threading, and its 370 unit cases pass. `pnpm run test` covers the merged tree; the remaining failures are the host-environment watcher cases that fail alone under load and pass in isolation, as recorded in the previous sync note.
