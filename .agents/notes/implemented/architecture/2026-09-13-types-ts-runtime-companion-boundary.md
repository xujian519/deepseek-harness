# Agent Note: the `src/types.ts` runtime-companion boundary

Status: implemented

English | [中文](2026-09-13-types-ts-runtime-companion-boundary.zh.md)

## Problem

`packages/AGENTS.md` required `src/types.ts` to contain "only types — no runtime code", and 19 of those files across 15 packages contradicted it. Seventeen declared a runtime value beside the declaration it belongs to: a brand constructor (`SessionId`, `SessionSeq`, `SessionLogOffset`, `FsTargetKey`, `FsVersion`, `SpillLocator`, `SubagentRunId`, `ApprovalRequestId`, `TeamId`, `TeamTaskId`, `TeamMessageId`, `WorkflowRunId`), the package's own error class (`FsError`, `WebError`, `TerminalBackendCleanupError`, `GraphInterruptError`, `GraphEngineError`, `WorkflowError`), a constant the same file's declarations fix (`SESSION_FORMAT_VERSION`, `SESSION_SEARCH_RESULT_LIMIT`, `SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS`, `DSH_ENV_PREFIX`, `GRAPH_END`, `EVIDENCE_TYPES`, `LevelMust`/`LevelShould`/`LevelQuality`, `DRAFT_NOTICE`, `TERMINAL_TASK_STATUSES`), or the predicate over one (`isGraphInterruptError`). Two more forwarded another module's runtime value: `shell/types.ts` re-exported `DSH_ENV_PREFIX` from `dsh-subprocess`, and `jobs/types.ts` re-exported `JobId` from its own `./brand.ts`.

A rule that 19 files contradict cannot be enforced, and reviewers learn to read past it. It also carried the coverage configuration with it: `vitest.config.ts` excludes `packages/*/*/src/types.ts` from the per-file gate on the grounds that those files carry no runtime coverage, which is sound only while the rule holds. Issue #99 records the mismatch as ledger item L3.

## Decision

- **The rule records the boundary.** [packages/AGENTS.md](../../../../packages/AGENTS.md) now reads: `src/types.ts` declares the package's seam vocabulary — its types plus the runtime values that vocabulary defines (brand constructors, the package's own error class, constants, member tables, predicates) — and never forwards another module's runtime value. The allowance is bounded by a question a reviewer can answer from the file itself: do the file's own declarations name this value?
- **Forwarding moved to the entries.** `shell/src/index.ts` re-exports `DSH_ENV_PREFIX` from `@deepseek-ai/dsh-subprocess`, and `jobs/src/index.ts` re-exports `JobId` from `./brand.ts`. Both `types.ts` files keep what their vocabulary needs — a type import, or `export type` — so the package roots that bash and job consumers import are unchanged and no consumer moved.
- **The coverage comment states the same fact.** The `types.ts` exclusion in [vitest.config.ts](../../../../vitest.config.ts) now says declaration files have no executable code and that the runtime companions the packages rule names travel with them, replacing the "types-only files" claim the mismatch had falsified.

## Alternatives considered

- **Move every runtime value into its own module.** Rejected on three counts. Brands would move to a `./brand.ts` leaf, the shape ten packages already use — but that leaf exists for a compiler face, not for purity: [jobs/brand.ts](../../../../packages/jobs/jobs/src/brand.ts) names its reason (the package root and `./types` reach `dsh-agent` through owner signatures a Client program cannot resolve). The other 13 packages would need the same split for no behavioral gain, and an id's type and its one-line constructor are one concept that a split puts in two files. Third, the moved values land in coverage-gated files, so the per-file 100% gate would newly demand direct tests for every brand constructor and for `FsError`'s constructor.
- **Keep the rule as written and register the 19 files as debt.** Rejected: the practice is uniform and reasoned — a brand sits next to the id it brands, a seam's error class next to the seam — so the ledger entry would be a permanent lie rather than a fix list.
- **Permit forwarding too.** Rejected: a `types.ts` that forwards another module's value carries no declaration of its own, and it publishes a second import path for a symbol whose owner already exports it. `shell/types.ts`'s module comment claimed the re-export gave bash consumers "one import root", which the entry provides without the detour.
- **Bring the companions under the per-file coverage gate.** Rejected: the exclusion is a file glob, so removing it would gate 19 files whose runtime code is type-adjacent one-liners already exercised through their consumers, and the gate would demand direct tests for each.

## Consequences

`types.ts` keeps a narrow allowance and gains a stated check. A file that grows past it — a service, a parser, a state table — is a review finding, and the boundary no longer depends on where the error class or brand helper happened to be written first. No `types.ts` remains an import path for another package's runtime value. The per-file gate still does not measure the companions, which the coverage comment now states instead of denying it.

## Testing

`pnpm run typecheck` (both compiler faces) and `pnpm run lint` pass. The moved re-exports are exercised through the consumers that already import them from the package roots — `packages/shell/shell-env`, `packages/shell/tool-bash`, `packages/jobs/jobs-local`, `packages/jobs/tool-jobs` — whose suites pass, and the declaration-only files keep emitting the same `lib/types` exports, which `tsc -b` re-checks for both faces. `pnpm run verify-module-graph` reports all three artifacts up to date: the shell→subprocess and jobs→brand edges exist either way, since both pairs are also imported at runtime.

## Related

- [Tech-debt tracking in same-repository Issues](../process/2026-09-11-tech-debt-issue-tracking.md) — the scan that produced ledger item L3, which Issue #99 records.
- [Coverage exemptions name the file's own reason](../testing/2026-09-13-coverage-exemption-reasons.md) — the same change's other half: the exemptions this rule's falsified claim had justified.
