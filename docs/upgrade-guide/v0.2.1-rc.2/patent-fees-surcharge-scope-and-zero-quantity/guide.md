---
kind: upgrade-guide
description: "patent_fees no longer charges claims/specification surcharges to designs and ignores zero-quantity lines when deciding whether the total is complete."
---

# Fee surcharges follow the patent type and zero units

English | [中文](guide.zh.md)

## Change

The shipped fee index declared the claim-count and specification-page surcharges with `patentTypes: null`, so a design case with `claims: 15` was charged a 750 元 权利要求附加费 even though a design has no claims or specification pages. Both items now apply to `invention` and `utility-model` only, and a design report lists them under the type-filter note instead. Separately, `total.complete` treated a zero-quantity line with no recorded unit price (for example the specification surcharge at 20 pages) as incomplete and withheld the total; zero-quantity lines now cannot withhold it. Totals for cases where a surcharge has units are unchanged.

## Migration

1. Re-run `patent_fees` for affected design cases; the claims and specification surcharge lines disappear and the total is the sum of the applicable items.
2. Re-run small applications (claims ≤ 10, specification pages ≤ 30); the specification surcharge still appears with `quantity: 0`, but `total.amount` and `total.complete` are no longer withheld by it.
3. Confirm: `patentType: "design", claims: 15, specificationPages: 40, triggers: ["filing"]` returns only the design application fee; `claims: 5, specificationPages: 20, triggers: ["filing"]` returns `complete: true` with the verified total.
