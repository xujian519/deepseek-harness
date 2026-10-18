---
kind: upgrade-guide
description: "`loadClaimChart` now returns `gaps: []` for legacy chart JSON that omits the field."
---

# Legacy claim charts load with an empty gap list

English | [中文](guide.zh.md)

## Change

`loadClaimChart` in `@deepseek-ai/dsh-patent-core` now sets `gaps: []` when a stored `claim-chart-*.json` has no `gaps` field. Previously it returned the parsed object unchanged, so `chart.gaps` was `undefined` even though `ClaimChart` declares it required. The existing migration of legacy `gaps[].mapping` to `kind` still runs. Readers of old files now receive an array and can iterate it without a guard.

## Migration

1. Remove defensive `chart.gaps === undefined` branches, or leave them; they no longer trigger for files loaded through `loadClaimChart`.
2. If you need to distinguish "no gap was recorded" from "the legacy file omitted the field", store that fact when writing the file; the loader normalizes both to `[]`.
3. Confirm: write a chart JSON with `rows` and `elements` but no `gaps`, call `loadClaimChart(caseId, chartId)`, and observe `gaps` equal to `[]`.
