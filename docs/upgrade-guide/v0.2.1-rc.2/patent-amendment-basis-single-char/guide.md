---
kind: upgrade-guide
description: "amendment-basis no longer ignores single-character insertions; a lone 不 that reverses a limitation now fails the gate."
---

# Amendment-basis reports single-character insertions

English | [中文](guide.zh.md)

## Change

`AmendmentBasisHandler` (the `amendment-basis` atom) now reports a one-character added fragment when that character and its adjacent context are not recorded in the original filing. Previously any fragment shorter than two characters was dropped after trimming function words, so inserting `不` before `设置有散热孔` passed the gate even though it reversed the limitation.

A one-character addition still passes when the character appears together with its neighbours in the original text, so a recorded addition (for example `散热孔` → `散热孔组` with `散热孔组` in the description) is not reported. Fragments made only of function words remain ignored.

## Migration

1. Re-run the amendment-basis stage for replies whose amended claims differ from the original claims by one character. Results produced before this change may show `amendment_basis_passed: true` where the gate now reports a violation.
2. Treat the new violation as a review item, not an automatic rejection: the report lists the fragment and keeps the existing notice that character-level comparison does not decide whether the amendment is directly and unambiguously derivable.
3. Confirm: `pnpm exec vitest run packages/patent/patent-core` passes, and a draft that inserts `不` before a positive limitation returns `amendment_basis_passed: false` with `addedSpan: 不`.
