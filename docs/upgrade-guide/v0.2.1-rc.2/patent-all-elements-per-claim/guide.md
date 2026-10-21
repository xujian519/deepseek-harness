---
kind: upgrade-guide
description: "All-elements coverage is now judged per claim with the overall conclusion taken from the best-covered claim, an empty element table yields `undetermined` instead of `not-covered`, and the coverage atom requires `claimNo` on chart elements."
---

# All-elements coverage is now judged per claim

English | [中文](guide.zh.md)

## Change

`deriveAllElementsCoverage` in `@deepseek-ai/dsh-patent-core` now evaluates each claim's own elements instead of pooling every element of the chart. Infringing any one claim reads on the patent, so the overall `outcome` is the best-covered claim (ranked `literal` > `construction-dependent` > `equivalence-required` > `not-covered`, ties keep the lowest claim number); the chosen claim is reported in `claimNo`, and `claims` carries each claim's own outcome and element breakdown. Top-level element lists mirror the chosen claim.

An empty element table is no longer reported as `not-covered`: the result is `undetermined` with empty element lists, because nothing was there to judge. `scoreInfringement` throws a `RangeError` on an `undetermined` conclusion instead of scoring zero coverage.

The `coverage` atom now requires a positive integer `claimNo` on every element of `claim_chart_doc` and degrades with an indexed reason when it is missing or invalid. The `claim_chart_build` tool renders each claim's outcome when the chart holds more than one claim.

## Migration

1. If a chart mixes elements from several claims, expect per-claim results: read `claims` when you need every claim, and `claimNo` when you need to know which claim produced the overall outcome.
2. Stop treating an empty `elements` array as "not covered". Branch on `outcome === 'undetermined'` and supply claim elements before scoring; `scoreInfringement` now throws on that input.
3. Add `claimNo` (a positive integer) to every element in any `claim_chart_doc` consumed by the `coverage` atom. Charts written by this package already carry it.
4. Confirm: `pnpm exec vitest run packages/patent/patent-core packages/patent/patent-tools` passes, and an infringement run on a multi-claim chart reports one paragraph per claim.
