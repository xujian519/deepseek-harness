# Agent Note: One numeric-range vocabulary for specification validation and novelty analysis

Status: proposed

English | [中文](2026-09-21-patent-numeric-range-shared-vocabulary.zh.md)

## Problem

"Numerical range" is a vocabulary the patent domain needs in two places, and it was written twice. `packages/patent/patent-core/src/novelty/numeric-range.ts:85` matches a range whose unit is optional and reads the unit from the text after the match, accepting the connectors `- – — ~ ～ 至 到`. `packages/patent/patent-tools/src/tool/validate-specification.ts:129` builds its pattern from a `UNITS` alternation and requires a trailing unit, accepting only `~ ～ 至 - —`. Their unit normalization also differs: `numeric-range.ts:119` normalizes `℃ / °c / °`, while `normalizeUnit` at `validate-specification.ts:159` normalizes `℃ / °C / °` and has no `°c`.

The two implementations disagree on concrete text, and each disagreement sends the two production consumers to opposite conclusions. `patent-core/src/graph/domains/novelty.ts:86` consumes the novelty-side extraction to build graph evidence for the novelty stage; `validate-specification.ts:207` consumes the tool-side extraction to report on a specification draft.

- `温度为20℃至90℃`: the unit sits between the digits and the connector, so the novelty pattern does not match and the text degrades to the weak plain-number path, yielding two strong numeric points instead of one range. The specification side recognizes one range.
- `重量比50-80`: the specification pattern requires a trailing unit and therefore does not recognize the range at all. The novelty side recognizes it.
- `25°c`: normalized on the novelty side, not normalized (and not matched as a unit) on the specification side.

The severity follows from which consumer is wrong, not from the size of the divergence: the novelty side feeds an examination conclusion. A range that becomes two points changes which comparisons the novelty node can make.

## Proposal

Extract the range syntax into one module owned by `packages/patent/patent-core`, for example `src/novelty/numeric-vocabulary.ts`, exporting the connector set, the unit table with its normalization map, and the range pattern as a single piece of syntax. `numeric-range.ts` consumes it as-is. `validate-specification.ts` imports it and layers its own stricter requirement — a range must carry a trailing unit — on top of the shared syntax, so the two sites differ only by the constraint each genuinely needs.

The unit normalization map (`℃ / °C / °c / °`) becomes one shared value rather than two nearly-equal sets.

Add a cross-parser agreement test covering the four shapes above (`20℃至90℃`, `50-80`, `20到90℃`, `25°c`), asserting both parsers see the same range boundaries and the same unit after normalization, with the specification-side trailing-unit requirement expressed as an explicit expectation rather than as an accident of its pattern.

## Alternatives considered

**Make the specification parser import the novelty parser directly.** Rejected: the two sites need different acceptance — the specification side genuinely requires a unit, because a unitless comparison in a draft is a drafting defect worth reporting, while the novelty side must stay permissive so it does not lose evidence. Sharing the syntax while keeping each site's constraint is the smaller change than sharing one parser and parameterizing its strictness at every call.

**Leave both patterns and add a test that pins their current difference.** Rejected: the difference is not a contract anyone chose. Pinning it documents a defect and makes the next divergence look intentional.

**Have the novelty side adopt the specification pattern.** Rejected: requiring a trailing unit on the novelty side would drop unitless ranges from novelty evidence — a silent loss of evidence in the consumer whose output carries examination weight.

## Acceptance criteria

- One module owns the connector set, the unit table, and the unit normalization map; both consumers import it.
- The four shapes above produce identical range boundaries and units from both entry points, with the specification side's trailing-unit requirement stated explicitly.
- The cross-parser agreement test fails if either side's connector set or unit table drifts.
- `pnpm exec vitest run packages/patent/patent-core/tests/novelty/numeric-range.spec.ts packages/patent/patent-tools/tests/validate-specification.spec.ts` passes.

## Risks

Any change to what the novelty side extracts changes novelty evidence, so this can move an examination conclusion for text that previously produced two points — the intended effect, but it must be reviewed as a behavior change and not as a refactor. If the two sides cannot share a single file for dependency-direction reasons, the fallback is a shared module in `patent-core` with `validate-specification.ts` keeping its own pattern but importing the connector and unit tables; that variant leaves one pattern per site and therefore needs the agreement test to carry the whole guarantee.
