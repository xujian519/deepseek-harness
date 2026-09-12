# Agent Note: naming the swallowed failure in the remaining catch sites

Status: implemented

English | [中文](2026-09-12-cross-package-catch-sites.zh.md)

## Problem

`AGENTS.md` requires an empty catch to name what it swallows and why nothing else can reach it. The first batch covered `core/agent-loop` and `subprocess/subprocess-local` and left 47 `catch(() => {})` sites across 20 packages, naming `subagent/subagent-codex`, `memory/openviking`, and `lsp/lsp-stdio` as the next three to judge.

Reading those fifteen sites showed `lsp/lsp-stdio` was already converged: all five carry an adjacent reason (`connection.ts` states that `write()` records the failure and rejects every pending request; `instance.ts` states that the handshake rejection must not surface before the first query awaits it). Ten of the fifteen were described and five were not. Applying the same rule to the rest of the scan — a reason adjacent to the swallowing statement — left nine more sites in eight packages, all in shapes this batch already contained.

## Decision

Twenty-one sites in 17 files across 13 packages now name their dropped failure at the site. Every site in the scan's `src` population is judged, and none needed a behavior change: each dropped rejection is one no caller can act on. The sites fall into six shapes.

- **Unhandled-rejection guards on a promise that keeps its own consumers** (`subprocess-e2b`'s `readyState`, `done`, and `completion`; `subprocess-e2b`'s terminal `completion`; `llm-deepseek`'s and `attachment-local`'s in-flight removal; `subagent-claude-code`'s `childProcessFailure`): the failure still reaches whoever awaits the original or derived promise, so the guard only covers the window before those consumers attach — or the startup path that throws before they do.
- **Best-effort work with no observer** (`openviking`'s quarantine rename, whose parse issue is the defect reported to the caller; its cadence refresh, whose failure keeps the previous map; `synapse`'s browser session sync, whose next debounced pass posts the full list; `synapse`'s stale-lock unlink, whose outcome `tryAcquire()` reports): the absence of the effect is already covered by another mechanism.
- **Cleanup that must not replace the primary error** (`better-sidebar`'s temp file, `patent-document`'s tmp file, `patent-tools`' temp PDF, `plugin-market`'s stream cancel): the failing steps' error is the one the caller receives.
- **An abandoned request or response** (`subagent-codex`'s pre-aborted `raceAbort` branch, where the caller receives its own abort; its `interrupt()`, which no caller awaits): the terminal turn or process outcome is the authority.
- **Teardown's join on the process it is killing** (`subagent-codex`'s and `subagent-claude-code`'s `dispose*Child`): `waitForExit()` is the teardown's evidence, and the handle's own failure already has its consumers.
- **A dispose with no reporting surface** (`better-sidebar`'s tab close): the tab is gone and the Session stays persisted.

The scan's count is 62 `src` sites, not the 63 the issue records; the difference is a measurement artifact of the first batch, which reported the same 62.

## Alternatives considered

- **Extract a named helper such as `settleQuietly(handle)`.** Rejected again, now with a sharper reason: the guard shape keeps the promise's consumers while the abandoned-request shape has none, so one helper would have to guess which promise it holds. The reason is also only readable where the drop happens.
- **Log each dropped rejection.** Rejected on the same grounds as the first batch: it duplicates failures the caller already sees, and for the guards the rejection still reaches its waiter.
- **Leave the nine unadjacent sites for a third batch.** Rejected: they are the same shapes as this batch's sites, judging them took the same reading, and a third batch would keep the issue open over prose alone.
- **Change the sites instead of commenting on them.** Rejected: propagating a failed temp cleanup or stream cancel would replace the error the caller receives, and the surfaces that drop these rejections have no place to report one.

## Consequences

Issue #85 closes with every `catch(() => {})` site in `src` self-describing, and the six shapes are the vocabulary a new site is judged against. No behavior changes: comments only, so nothing observable depends on this batch. The cost remains that the reason is prose the compiler cannot check — a refactor that moves one of these calls must carry its comment, and a genuinely lost failure added in a known shape will look pre-approved unless the reviewer reads the named owner.

## Testing

`pnpm exec vitest run` over the thirteen touched packages, plus `pnpm run typecheck`, `pnpm run lint`, and `pnpm run duplication`. Comments cannot alter runtime behavior, so no snapshot is owed.

## Related

- [naming the swallowed failure in lifecycle catch sites](2026-09-12-lifecycle-catch-sites.md) — the first batch and the shape vocabulary this one extends.
- [tech-debt tracking in same-repository Issues](../process/2026-09-11-tech-debt-issue-tracking.md) — the scan that produced the finding, which Issue #85 records.
