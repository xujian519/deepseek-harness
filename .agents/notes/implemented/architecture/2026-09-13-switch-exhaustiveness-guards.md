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

**A second pass guards the other 52 literal unions.** Every one of them now ends in `default: assertNever(...)` with the same ignore comment: 16 sites in ten packages that already declared `@deepseek-ai/dsh-util-values`, and 36 in twenty that did not — the seven Client-side packages among those twenty by `pnpm run verify-package-dependencies --fix` (runtime value importers under `dependencies`, browser-bundled packages under `devDependencies`), the other thirteen by hand, plus the matching `tsconfig` project references. The argument passed is the switched value, not its discriminant property: TypeScript narrows the switched object to `never` inside the default clause, so `chunk.type` is an error-typed expression there, which both `tsc` and the type-aware lint (`typescript/no-unsafe-argument`) reject.

**The eight open discriminants are ruled, not guarded.** `apps/desktop/src/bridge-server.ts` was the one worth tightening: its allow-list is now a literal-typed `Set` behind a `method is DesktopBridgeMethod` predicate, so `dispatch` is total over a closed union and ends in `assertNever`. The other seven keep a no-default switch with the boundary written at the site: the seed-envelope switch in `core/session` (six types carry the LLM envelope it asserts; every other type is a merge-extensible plugin event), four `session-format-*` migration switches (an earlier disposition-table lookup or content filter drops everything they do not handle), `skill-filesystem`'s frontmatter boolean spellings (any other string falls through to the `TypeError` below), and `workflow-worker-thread`'s `typeof` switch, whose eight results the language fixes and whose `unknown` operand never narrows to `never`. `network-store`'s filter boundary, ruled in the first pass, keeps its comment.

## Alternatives considered

- **Flip `considerDefaultExhaustiveForUnions` to `false`.** Rejected on the measurement above: 90 deliberate subset-with-default handlers would have to enumerate every member, which is what an extensible map cannot promise across builds, and the closed-union half of the rule does not need it.
- **Add `assertNever` to the `NetworkStore` switch as well.** Rejected: the append filter makes that default unreachable, so the clause would restate a boundary that belongs at the filter, where this batch put it.
- **Guard every candidate in one batch.** Taken in two: the first pass guarded the nine protocol switches and recorded the remaining classification, and the second pass landed the 52 literal unions from it. Splitting kept the protocol review (where an unrecognized variant crossed a process boundary) separate from a mechanical sweep over thirty packages' manifests.
- **Pass the discriminant property to `assertNever`.** Rejected by the compiler: the switched object narrows to `never`, so the property access is error-typed in the default clause, and both `tsc` and tsgolint reject it. Passing the object also gives the error message the whole variant, which is the more useful diagnostic.
- **Guard `workflow-worker-thread`'s `typeof` switch with `assertNever`.** Rejected: `typeof` has exactly eight results fixed by the language, and the `unknown` operand does not narrow to `never`, so the guard could not be written without a cast.
- **Cast `request.method` at the `dispatch` call site.** Rejected in favor of the predicate: the cast would sit on the hot path and hide the allow-list relationship, while the predicate states it once and makes an allow-list entry without a `dispatch` case fail compilation.
- **Re-export `assertNever` from `@deepseek-ai/dsh-value`**, which 182 packages already declare and which re-exports `deepFreeze` from the values package (134 declarers). Not rejected on its merits — it would delete most of the manifest work — but it widens a widely used package's public surface, so it needs its own decision instead of riding along here.

## Consequences

Sixty-one switches now throw a named error instead of silently ignoring an unrecognized variant — the nine protocol switches of the first pass and the 52 literal unions of the second — and the compiler refuses a new member at each before any build ships. Eight open discriminants keep a documented boundary instead: one tightened into a closed union, seven documented where they fall through. A local `assertNever` copy in `patent-teams` was deleted in favor of the shared helper, and the `docs/module-graph` pair was regenerated, which also caught the `token-meter` → `attachment` peer edge a previous change had left stale. A scan of `packages/*/*/src` and `apps/*/src` now reports eight candidates, every one of them a ruled site.

## Testing

The scan is reproducible from the note's description: parser plus type checker over `packages/*/*/src` and `apps/*/src`, which reported 69 candidates before the first pass and 60 after it, and 8 after the second. `npx vitest run` over the seven touched packages: 2409 passed. Per-file coverage stays at 100% for all thirteen changed files under targeted `--coverage --coverage.include` runs — including the new `default` branches behind their ignore comments — and the new `network-store.ts` case pins the topic boundary with a record from a hypothetical newer worker. `pnpm run lint` (0 warnings / 0 errors over 4489 files), `pnpm run typecheck`, `pnpm run duplication` (0 clones), `pnpm run verify-package-dependencies` (66 packages), `pnpm run verify-suppression-reasons` (400 suppressions, no findings), and the flipped-config measurement above (`npx oxlint --config <flipped> .` → 90 `switch-exhaustiveness-check` errors).

The second pass re-ran the same scan (8 candidates), `npx vitest run` over the 36 touched packages' suites (9,989 passed), and per-file coverage for the 49 changed `packages/*/*/src` files under `--coverage --coverage.include` (each at 100%, so every added `default` is fully covered by its ignore comment). Also green: `pnpm run typecheck` (after the added project references), `pnpm run lint` (0/0 over 4489 files), `pnpm run duplication` (0 clones), `pnpm run verify-package-dependencies` (66 packages) and `pnpm run verify-client-packages` (57 client packages), plus `pnpm run verify-module-graph` after regenerating the pair.

## Related

- [Tech-debt tracking in same-repository Issues](../process/2026-09-11-tech-debt-issue-tracking.md) — where Issue #89 is registered.
- [Type-aware lint cleanup](../process/2026-08-29-type-aware-lint-cleanup.md) — the earlier ruling that suppression and defense comments are load-bearing documentation; the same "state the reason at the site" rule.
- [Lint suppressions state their reason](../process/2026-09-13-lint-suppression-reasons.md) — the gate added alongside this batch.
