---
kind: upgrade-guide
description: "Claim-reference derivation no longer misses dependent claims with long preambles, and resolves catch-all references to all earlier claims."
---

# Claim references cover long preambles and catch-all forms

English | [中文](guide.zh.md)

## Change

`deriveClaimRefs` (and every claim chart built by the `claim-chart` atom) now reads references differently:

- The reference search is no longer limited to the first 40 characters of a claim. A prefixed reference (`根据权利要求1`, `如权利要求2`, `按照权利要求1-3`) counts anywhere in the claim, including the characterizing part, so a dependent claim with a long preamble is no longer reported as independent.
- A bare `权利要求1所述` without a prefix still counts only in the preamble — before `其特征在于` (or the first sentence when the claim has no characterizing part). Mid-claim cross-references such as `装配权利要求1所述的装置` do not create a dependency.
- Catch-all references (`前述权利要求中任一项`, `上述权利要求之一`, `权利要求中任一项`) expand to every earlier claim instead of being ignored.

The effect on dependent claims is legal, not cosmetic: coverage and novelty checks include the referenced claims' features through `referencedClosure`, so a claim that was silently treated as independent now inherits its parent's limitations.

## Migration

1. Re-derive claim references for claim texts with long preambles or catch-all references. Persisted claim charts that marked such a claim `independent` carry the old conclusion; regenerate the chart or update its `claims` rows before reusing the coverage result.
2. If a claim cites another claim mid-body as a method step (for example `按权利要求1所述进行装配`), keep the bare wording: prefixed forms (`根据权利要求1`) are read as dependencies wherever they appear.
3. Confirm: `pnpm exec vitest run packages/patent/patent-core` passes, and a claim chart over a dependent claim reports its parent in `refersTo`.
