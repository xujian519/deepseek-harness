# Agent Note: lint suppressions state their reason, and a block heading may carry it

Status: implemented

English | [中文](2026-09-13-lint-suppression-reasons.zh.md)

## Problem

Issue #94 reported that a few `oxlint-disable` / `eslint-disable` / `@ts-expect-error` directives in the repository state no reason, and asked for a ruling on how far one comment may cover. Its evidence had gone stale in both directions:

- Of the three named sites, `packages/compaction/compaction-basic/src/region.ts:130` and `packages/core/tools/src/testing.ts:30` indeed had no reason in their block; `packages/session-query/session-query/tests/observation.spec.ts:115` had one, 28 lines above it in the same function body.
- The Issue also reported that region.ts's other ten directives were mostly reason-less and that the reasons on `:102` and `:547` explained only `no-deprecated`. Neither holds: those ten carry a comment, and each of the two dual-rule directives carries one line per rule.

A parser-level recount over the linted corpus finds 400 directives, so the residue was small. Nothing kept it small: `reportUnusedDisableDirectives` asks the opposite question (is this directive needed?), and a directive with no reason passed every gate.

## Decision

**Every directive states why it is safe, in one of three forms.** Inline (`// oxlint-disable-next-line <rule> -- why`), the trailing text TypeScript itself parses for `@ts-expect-error <why>`, or a comment heading the directive's blank-line-delimited block. The heading form is deliberate: `defineTool`'s seven `unbound-method` extractions share one property of `options`, `patent-teams`' three saved originals share one dispose fact, and repeating the sentence per line would add noise rather than information. A JSDoc doc-block documents the declaration it precedes, so it never counts. A directive that switches off several rules needs a reason for each of them; that stays a review rule, because the reasons are prose.

**The three reason-less sites now name their facts.**

- `region.ts:130` — the empty-surface return and the length check above leave index 0 in range.
- `core/tools/src/testing.ts:30` — object-literal fixture bodies never read `this`, and the extracted reference is called with explicit arguments.
- `observation.spec.ts:115` — the stub forwards the injected failure unchanged, and a test injects a non-Error value to exercise containment.

**A new gate holds the line.** `scripts/verify-suppression-reasons.ts` reports every directive that states no reason, registered as `suppression-reasons` in `ciSharedStaticGates`. Discovery is syntax-aware, as `scripts/AGENTS.md` requires: `scripts/oxlint-contract.spec.ts` writes directive text inside string literals on purpose, and a line-wise regex reports those as unexplained. The scan guards its corpus (empty file list, zero directives found) and skips parsing files that mention none of the three directive families. The leaf sits in the static aggregate alone: the static and hygiene lists duplicate most of their entries, and a second registration lengthened one shared run past jscpd's clone threshold, which `duplication` reported as a clone.

## Alternatives considered

- **Require the reason on the directive or the line directly above it.** Rejected: 75 of the 400 directives rely on a block heading today, and a strict-adjacency rule would rewrite them all while a reader's lookup stays a few lines.
- **Check that a multi-rule directive names a reason per rule.** Rejected: the reasons are prose, so the gate cannot tell which sentence covers which rule; it would pass a two-rule directive whose one sentence covers one rule.
- **Leave the residue to review.** Rejected: the audit raised region.ts's missing reason once already, under P2-3, and it was still missing at the 2026-09-11 recount.
- **Ban `@ts-ignore` and `@ts-nocheck` in the same gate.** Out of scope — the repository has zero of both, and the gate admits only the three families in use.
- **Add the gate to the quick documentation aggregate so this fork's CI runs it.** Rejected: it is a source gate, not a documentation one, and the spec's repository-wide case already runs in every lane that executes the unit suite.

## Consequences

The repository has one rule for suppression documentation, and a reason-less directive now fails a gate instead of passing review. The accepted heading form is bounded by the blank-line block rather than by adjacency, so a long function body can still satisfy the gate with a heading far from the directive it explains — `observation.spec.ts`'s stub is the live example. Closing that would mean the strict-adjacency rule rejected above; the block boundary is the deliberate trade.

## Testing

`pnpm run verify-suppression-reasons` (400 suppressions, no findings). `npx vitest run scripts/verify-suppression-reasons.spec.ts` — 15 cases covering each admitted and excluded form: inline reason, `@ts-expect-error` trailing text, bare `@ts-expect-error`, the line above, a heading across statements, a heading separated by a blank line, a JSDoc block, a multi-line block directive, the `-line` form, directive text in string and template literals, directive prose, `oxlint-enable`, and the repository-wide scan. Negative control: a probe spec containing one bare directive made the gate exit 1 naming `file:line`; the probe was deleted afterwards. `pnpm run lint`, `pnpm run typecheck`, `npx vitest run scripts/run-gates.spec.ts`.

## Related

- [Type-aware lint cleanup](2026-08-29-type-aware-lint-cleanup.md) — calls suppression comments load-bearing documentation and pairs each jsdom defense with the directive it justifies.
- [Tech-debt tracking in same-repository Issues](2026-09-11-tech-debt-issue-tracking.md) — where Issue #94 is registered.
