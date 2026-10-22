---
kind: upgrade-guide
description: "Office-action parsing now excludes the case's own number inside full-width parentheses and reads enumerated claim numbers."
---

# Office-action citations cover bracketed self-numbers and enumerations

English | [中文](guide.zh.md)

## Change

`parseOfficeAction` / `extractCitations` / `extractAffectedClaims` read notice text differently:

- A number written as `本申请（申请号CN117000000A）` is recognized as the case itself and no longer appears among the cited documents. Previously only the unparenthesized `本申请公开号CN…` and the trailing `CN…（本申请）` forms were excluded.
- Enumerated claim numbers (`权利要求1、2和3`, `权利要求1，2或4`, `权利要求1、2以及3`) are read in full. `affectedClaims` and each citation's same-sentence `claimsAffected` now contain every enumerated claim instead of only the first.

## Migration

1. Re-parse notices that write the case number inside parentheses or enumerate claims with `、／，／和／或`. Persisted parse results produced before this change may list the case's own number as a cited document or report a single claim where the notice named several.
2. Rebuild downstream reply plans and citation tables from the new parse result; both fields feed `buildResponsePlan` and the rendered summary.
3. Confirm: `pnpm exec vitest run packages/patent/patent-core` passes, and a notice containing `本申请（申请号CN…）` reports only the comparison documents in `citations`.
