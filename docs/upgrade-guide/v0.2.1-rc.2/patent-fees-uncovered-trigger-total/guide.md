---
kind: upgrade-guide
description: "patent_fees now withholds the total and reports total.uncoveredTriggers when a named trigger has no indexed fee item."
---

# Unindexed fee stages withhold the total

English | [中文](guide.zh.md)

## Change

`patent_fees` previously reported an empty line list with `total: {amount: "0.00", complete: true}` when a named trigger had no indexed item. That made an unindexed stage look free. A trigger absent from the index is now listed under `total.uncoveredTriggers`, `total.complete` is false, and no amount is stated. The shipped index has no `grant-registration` item, so a query naming that stage now withholds the total instead of reporting zero. Totals for fully indexed triggers are unchanged.

## Migration

1. Add the missing item to the fee index with its `sourceDoc` and `verifiedOn`, or stop naming that trigger in `triggers`.
2. Read `total.uncoveredTriggers` and report the missing stage as unknown; do not quote a total this tool refused.
3. Confirm: `patent_fees` with `triggers: ["grant-registration"]` returns `complete: false`, `uncoveredTriggers: ["grant-registration"]`, and no `amount`; `triggers: ["filing"]` still totals its verified lines.
