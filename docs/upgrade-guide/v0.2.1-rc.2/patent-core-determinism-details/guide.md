---
kind: upgrade-guide
description: "`mergeWithSchema` sorts node names by code unit, `FactBlackboard.getFact` hides discarded facts, manifests reject non-integer retry counts, and IPC context separates key points from tips."
---

# Patent-core fixes merge ordering, discarded facts, manifest checks, and IPC context

English | [中文](guide.zh.md)

## Change

`mergeWithSchema` now orders nodes by UTF-16 code unit instead of `localeCompare`. The graph contract requires the same log to produce the same state on every host; `localeCompare` follows the runtime locale, so node names that differ in case could merge in a different order. The reducer semantics are unchanged.

`FactBlackboard.getFact(id)` no longer returns a fact after `discardFact(id)`. A discarded fact could still satisfy `ruleAssertion`, letting a backtracked fact support a syllogism. Read history with `getFact(id, { includeDiscarded: true })`; `allFacts()` still returns every fact.

`validateWorkflowManifest` rejects a `retry.maxRetries` or `validation.maxRetries` that is not a non-negative integer. Manifests arrive from YAML or JSON, where `NaN`, a fraction, or a quoted number can pass the declared TypeScript type; the earlier check only rejected negative values. Valid manifests keep working.

`formatStandardsAsContext` puts each key point and each tip on its own line. It previously concatenated the two blocks without a separator, so the last key point and the first tip shared a line.

The `SPEC-ABSTRACT` rule description no longer cites 专利法实施细则第23条. That article addresses independent-claim necessary technical features, and the abstract provisions do not require keywords, so the citation was wrong.

External code that relied on `getFact` returning a discarded fact, on locale-sensitive merge order, on fractional retry counts, or on the joined IPC lines observes the new behavior.

## Migration

1. Replace `getFact(id)` with `getFact(id, { includeDiscarded: true })` where the caller intentionally reads a discarded fact; otherwise keep the call and handle `undefined`.
2. Do not depend on node ordering beyond the documented code-unit order. Node names that only differ by case may now reduce in the opposite order.
3. Pass an integer `maxRetries` and `validation.maxRetries` in every manifest, or omit them.
4. Re-read rendered IPC context if you parse it; key points and tips now occupy separate lines.
5. Confirm: `pnpm exec vitest run packages/patent/patent-core packages/patent/patent-rule packages/patent/patent-workflow` passes, and a manifest with `maxRetries: 1.5` throws `必须为非负整数`.
