# Agent Note: closed-union switches end in `assertNever`, and what the exhaustiveness lint option decides

Status: implemented

English | [中文](2026-09-13-switch-exhaustiveness-guards.zh.md)

## Problem

Issue #89 reported 26 exhaustive switches with neither `default` nor `assertNever`, and asked whether oxlint's `considerDefaultExhaustiveForUnions: true` conflicts with the AGENTS.md rule that closed unions end in `assertNever`. A parser-level recount with the type checker — every `switch` under `packages/*/*/src` and `apps/*/src` with no `default` clause whose case labels are all literals, then the switch expression's type — finds **69**: 61 literal unions, and 8 whose discriminant is a plain `string` (a `method` or `topic` name, an untyped migration `event.type`, `value.toLowerCase()`), where `assertNever` cannot apply at all.

Two of the audit's six prioritized silent surfaces needed the opposite treatment from the one it asked for:

- `packages/experimental/inspector/src/worker/inspection/network-store.ts` never reaches its switch with an unknown topic. `NetworkStore.append` drops every record outside the store's `topics` set (`FETCH_TOPICS`) before `ingest` runs, so the missing guard was documentation at that filter, not a `default` clause.
- The `session-format-*` migration switches read untyped input typed as `string`.

## Decision

**The lint option stays `true`.** Flipping it to `false` in a copy of the lint config makes **90** switches fail `switch-exhaustiveness-check` across the repository, every one a deliberate subset handler with a `default` — Session projections over the merge-extensible `SessionEventMap` and their kin. The option is precisely what leaves room for a documented default on a union a build cannot enumerate for other builds. The `assertNever` contract does not depend on it: `assertNever(value: never)` accepts only `never`, so a member added to a closed union fails `pnpm run typecheck` at the call site, in every consumer build rather than only in this repository's lint lane.

**A closed union gets `assertNever`; an open discriminant gets a documented boundary.** This batch guards the nine protocol switches where an unrecognized member would otherwise pass silently — five in `api/session-controller` (the Host assistant-stream accumulator, the Client accumulator, the list-mutation fold, the journal-change apply, and the journal-change translation), plus `client/ui-conversation`'s conversation-window fold, the two `experimental/webworker-runtime` shell switches (argument segments and redirection subtypes), and `experimental/inspector`'s `validateRemoteObject`. Each default carries `/* v8 ignore next -- closed-union backstop; ... */` because it is unreachable by construction: the value's type is closed, and in the inspector case `parseRemoteObject` admits only `REMOTE_TYPES` before the cast.

**Three extensible unions now say so where they fall through.** `compaction/compaction/src/tool-pairing.ts` (the event delta), `interaction/permission-presets` (the projection's unchanged-reference change gate) and `compaction/compaction-basic/src/summarizer.ts` (a finish kind that is not one of the three failures — `FinishReasonMap`'s own type doc mandates falling through an unknown kind) each state why an unknown member lands in the default rather than in a case.

## Alternatives considered

- **Flip `considerDefaultExhaustiveForUnions` to `false`.** Rejected on the measurement above: 90 deliberate subset-with-default handlers would have to enumerate every member, which is what an extensible map cannot promise across builds, and the closed-union half of the rule does not need it.
- **Add `assertNever` to the `NetworkStore` switch as well.** Rejected: the append filter makes that default unreachable, so the clause would restate a boundary that belongs at the filter, where this batch put it.
- **Guard every candidate in one batch.** Rejected on blast radius: 52 remaining literal unions pull a manifest line for each of 20 packages plus a lockfile refresh, and every site needs its closed-versus-extensible call read individually. The classification is recorded instead, which makes the remainder mechanical.
- **Re-export `assertNever` from `@deepseek-ai/dsh-value`**, which 182 packages already declare and which re-exports `deepFreeze` from the values package (134 declarers). Not rejected on its merits — it would delete most of the manifest work — but it widens a widely used package's public surface, so it needs its own decision instead of riding along here.

## Consequences

Nine protocol switches now throw a named error instead of silently ignoring an unrecognized variant, and the compiler refuses a new member at each of them before any build ships. The remaining 60 candidates are recorded with their types and package/dependency status: 52 literal unions (16 sites in 10 packages that already declare `@deepseek-ai/dsh-util-values`, 36 sites in 20 packages that do not) and 8 open discriminants that each need their own ruling. Until those land, a new member added to one of them is still caught by oxlint's exhaustiveness rule at lint time; what this batch strengthens is the runtime guarantee for values crossing a protocol boundary and the compiler guarantee for consumers.

## Testing

The scan is reproducible from the note's description: parser plus type checker over `packages/*/*/src` and `apps/*/src`, which reported 69 candidates before the change and 60 after, with all nine guarded switches gone from the list. `npx vitest run` over the seven touched packages: 2409 passed. Per-file coverage stays at 100% for all thirteen changed files under targeted `--coverage --coverage.include` runs — including the new `default` branches behind their ignore comments — and the new `network-store.ts` case pins the topic boundary with a record from a hypothetical newer worker. `pnpm run lint` (0 warnings / 0 errors over 4489 files), `pnpm run typecheck`, `pnpm run duplication` (0 clones), `pnpm run verify-package-dependencies` (66 packages), `pnpm run verify-suppression-reasons` (400 suppressions, no findings), and the flipped-config measurement above (`npx oxlint --config <flipped> .` → 90 `switch-exhaustiveness-check` errors).

## Related

- [Tech-debt tracking in same-repository Issues](../process/2026-09-11-tech-debt-issue-tracking.md) — where Issue #89 is registered.
- [Type-aware lint cleanup](../process/2026-08-29-type-aware-lint-cleanup.md) — the earlier ruling that suppression and defense comments are load-bearing documentation; the same "state the reason at the site" rule.
- [Lint suppressions state their reason](../process/2026-09-13-lint-suppression-reasons.md) — the gate added alongside this batch.
