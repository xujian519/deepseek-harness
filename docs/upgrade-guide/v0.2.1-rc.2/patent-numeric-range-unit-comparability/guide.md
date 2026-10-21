---
kind: upgrade-guide
description: "The patent numeric-range check reads signed values and suffix bounds, converts same-dimension units, and returns inconclusive instead of no_overlap when units cannot be compared."
---

# Numeric-range check converts units and fails closed on incomparable units

English | [中文](guide.zh.md)

## Change

`analyzeNumericRanges` and the `numeric-range` atom now read and judge numeric ranges differently:

- Signed values are part of the number token. `-5至-10℃` is the interval −10…−5 instead of the positive range 5…10, and Unicode `−` and full-width `－` are accepted as minus signs.
- Suffix bounds (`70℃以上`, `80%以下`, `-5℃及以上`) are one-sided findings beside the existing direction-word form (`不低于`).
- Units of the same dimension are converted to a base unit before comparison: `5-10mg` versus `0.005-0.01g` is now `overlapped` instead of `no_overlap`, and `1-2h` versus `60-90min` compares on seconds. Temperature is compared on the Celsius scale only; no °C/°F offset conversion is performed. Converted endpoints within a relative 1e-9 tolerance count as shared; conversions that overflow to infinity do not.
- A unit outside the vocabulary table is comparable only when both sides write it identically (`cps` versus `cps`). Different dimensions (`mm` versus `℃`) and different out-of-table spellings (`cps` versus `cp`) are recorded in the new `incomparablePairs` field with a `reason` (`dimension-mismatch` or `unknown-unit`), and any incomparable pair lowers the verdict to `inconclusive` unless a destructive overlap already decides it. The report and `summary` carry the new `reason` text.
- `NumericRangeAnalysis` gains `incomparablePairs` and `reason`; both are additive fields. The verdict vocabulary is unchanged.

## Migration

1. Treat `inconclusive` from `numeric-range` as "the units could not be compared", not as "no overlap evidence": read `reason` / `incomparablePairs` and normalize the prior-art units before relying on the result.
2. Write quantities with units from the shared vocabulary (`src/novelty/numeric-vocabulary.ts`) or with identical spellings on both sides. Normalize Fahrenheit and other offset scales to Celsius before the check; the module does not apply offsets.
3. Re-baseline recorded reports that contain `no_overlap` for cross-unit comparisons: they now report `overlapped` or `inconclusive` with the incomparable detail.
4. Confirm: `pnpm exec vitest run packages/patent/patent-core packages/patent/patent-tools` passes, and a workflow run on valid inputs contains no `[WORKFLOW_DEGRADED]` output.
