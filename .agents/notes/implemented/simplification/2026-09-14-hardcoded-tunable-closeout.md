# Agent Note: Close out the hardcoded-tunable audit (Issue #88)

Status: implemented

English | [中文](2026-09-14-hardcoded-tunable-closeout.zh.md)

## Problem

Issue #88 listed fifteen module-level constants across the tree and asked, for each, whether a missing `Config` field was the reason it was hardcoded. The governing rule splits that question in two: a deployment-varying choice belongs in a validated `Config` field changeable from `cordis.yml`, while protocol constants, external specs, security invariants, and internal cadences stay fixed. A `DEFAULT_*` constant is not itself configurability, so a constant is only a defect when a deployment could reasonably need a different value and has no way to supply one.

Answering the issue required classifying every listed constant against that rule, and then acting only on the ones the classification actually implicated.

## Decision

Exactly one of the fifteen is a candidate for `Config`, and it stays fixed. `SYMLINK_PROBE_CONCURRENCY` (`packages/client/better-sidebar/src/fs-tree.ts`) caps concurrent `stat` calls during one directory listing; a deployment on a network mount could plausibly want a different bound, but no current consumer has asked for one and the sidebar path is interactive. Per "Require evidence for public choices", it stays a constant and now carries the reason.

The other fourteen are already in their correct form and need no source change:

| Constant | Location | Why it stays fixed |
| --- | --- | --- |
| `SESSION_SEARCH_RESULT_LIMIT` | `packages/api/session-controller/src/types.ts` | Product-visible result count, already exported and documented |
| `SETTINGS_NAMESPACE` | `packages/preset/agent-presets/src/index.ts` | Persisted settings-document key; renaming it drops stored state |
| `SHELL_SETTINGS_NAMESPACE` | `packages/shell/shell/src/index.ts` | Same, with the ownership rationale already in its JSDoc |
| `FAIL_LOUD_RELEASE_TIMEOUT_MS` | `packages/boot/app-boot/src/index.ts` | Security invariant: a wedged disposer may delay the fatal exit, never cancel it |
| `ZSTD_DECODE_YIELD_INTERVAL_MS` | `packages/session/session-persistence-jsonl/src/index.ts` | Internal scheduling; already states it is not deployment configuration |
| `ELU_POLL_INTERVAL_MS` | `packages/code-runtime/code-runtime-worker-thread/src/index.ts` | Internal cadence; already states it is not config |
| `DEFAULT_STREAM_IDLE_TIMEOUT_MS` | `packages/llm/llm-deepseek/src/index.ts`, `packages/llm/llm-pi-ai/src/config.ts` | Already configurable: each package pairs a `streamIdleTimeoutMs` schema default with a `?? DEFAULT_*` fallback in its explicit `resolveAdapterOptions`/`resolve` step over an all-optional `Config` interface |

The remaining five constants were genuinely fixed but said so nowhere, so each now carries the reason it is not a `Config` field: `STDERR_TAIL_LIMIT` and `STREAM_SETTLE_MS` (`packages/sdk/client/src/client.ts`), `MAX_MISSED_HEARTBEATS` (`packages/api/gateway/src/stream-server.ts`), `SEARCH_PROVIDER_CALL_LIMIT` (`packages/api/session-controller/src/list.ts`), and `SCROLLBACK_PAGE_LINES` with `POLL_INTERVAL_MS` (`packages/shell/tool-bash-persistent/src/index.ts`, `packages/shell/tool-pwsh-persistent/src/index.ts`).

One real defect surfaced that the issue had not named. Both persistent tools wrote their `backendType`, `timeoutMs`, and `maxOutputChars` defaults as bare literals twice — once in the schema and once in the `apply()` resolve step — while `DEFAULT_DESCRIPTION` in the same object literal was already extracted. Extracting `DEFAULT_BACKEND_TYPE`, `DEFAULT_TIMEOUT_MS`, and `DEFAULT_MAX_OUTPUT_CHARS` in both packages restores the symmetry the surrounding code already demonstrated, and neither the schema defaults nor the resolved values change.

## Foreground timeout defaults are not one knob

The two foreground command defaults are `120_000` for the local executors (`bash-local`, `pwsh-local`) and `300_000` for the persistent tools (`tool-bash-persistent`, `tool-pwsh-persistent`). The difference is structural rather than an oversight:

- `tool-bash` and `tool-pwsh` keep no default of their own. They forward `timeoutMs` only when the model supplies it (`...args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}`) and otherwise fall through to the executor's `resolve()`, which fills `config.timeoutMs` and clamps it to `config.maxTimeoutMs` (`clampTimeout(request.timeoutMs, config.timeoutMs, config.maxTimeoutMs)`). The executor's value is an infrastructure fallback plus a cap.
- `tool-bash-persistent` and `tool-pwsh-persistent` drive a long-lived PTY shell through `ctx.terminals` rather than the executor's `run()` path, so no executor `resolve()` sits under them. Each tool must hold its own deadline (`deadline(upstream, config.timeoutMs, TIMEOUT_CODE)`), and its value is the wall-clock limit the tool applies to every command.

Both values are `Config` fields on their own package and remain changeable from `cordis.yml`; the asymmetry reflects a fallback under a cap versus a self-held limit, which are different contracts rather than one duplicated choice.

## Alternatives considered

- **Promote `SYMLINK_PROBE_CONCURRENCY` to a `Config` field.** Rejected: no current consumer needs a different bound, and the rule requires evidence before widening a public configuration surface. Recorded as a fixed constant with its rationale instead.
- **Unify the local and persistent foreground timeouts.** Rejected: they resolve through different mechanisms and apply to different contracts, so a shared numeric value would not make them one choice.
- **Add `Config` fields for the remaining fixed constants.** Rejected: an internal cadence exposed as configuration only moves a fixed choice into deployment files without giving any deployment a better value.
- **Leave the fixed constants undocumented because they are correct.** Rejected: the classification is exactly the deliverable Issue #88 asked for, and a future reader cannot distinguish a deliberate fixed value from an unexamined one without it.

## Consequences

- Both persistent tools resolve their three defaults from one constant each, so the schema and the `apply()` step cannot drift apart.
- Sixteen constants now state why they are not `Config` fields, which is what makes the classification auditable rather than asserted.
- No behavior changes: every constant keeps its value, and every `Config` field keeps its default.

## Related

- `.agents/audits/2026-09-11-tech-debt-issue-manifest.md` Issue #88
- `docs/TECH_DEBT.md`
- `packages/shell/tool-bash-persistent/src/index.ts`, `packages/shell/tool-pwsh-persistent/src/index.ts`
- `packages/shell/bash-local/src/index.ts` (`resolve`, `maxTimeoutMs`)
- `packages/client/better-sidebar/src/fs-tree.ts`
- `packages/api/gateway/src/stream-server.ts`, `packages/api/session-controller/src/list.ts`
- `packages/sdk/client/src/client.ts`
