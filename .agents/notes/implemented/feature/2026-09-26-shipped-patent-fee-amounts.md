# Agent Note: transcribed patent fee amounts, and what the item model cannot price

Status: implemented

English | [中文](2026-09-26-shipped-patent-fee-amounts.zh.md)

## Problem

`patent_fees` shipped with a fee index that recorded which items a case owes and how each is counted, and no amount: every `amount` was null. The persona and the quality gate both required money to be computed by the tool, so the domain's number discipline had its hole exactly where the money is — the tool could hand back a checklist and refuse a total, but it could not price anything. The fields the file did carry had been taken from this repository's own statements rather than from the fee standard, and the repository had already recorded that its 实施细则 numbering mixes revisions.

## Decision

Record the amounts from the official fee standard, and let the item model — not the transcription — decide what cannot be priced.

- **The amounts come from the CNIPA payment guide's fee table (附件2).** Every item records the document it was copied from and the date of the copy. `effectiveFrom` stays null because the guide prints no effective date for the domestic table: filling it with the guide's own publication date would assert something the guide does not say.
- **One amount per item means one item per price.** 申请费, 复审请求费, and 无效宣告请求费 cost one amount for an invention and another for a utility model or a design, and each patent type has its own annual-fee tiers, so those became separate items scoped by `patentTypes`. The consumer filters by the query's patent type, so a case is priced by exactly one of them.
- **Two items stay without an amount, and the reason is the model, not unfinished work.** 说明书附加费 is charged per page band (50 from page 31, 100 from page 301) and 延长期限请求费 per occurrence (300 per month for a first extension, 2000 for a repeat). An item holds one `freeUnits` and one `amount`, and a query carries neither a band selector nor an occurrence, so splitting either into two items would apply one band's price to every unit. They stay null, and the tool withholds the total rather than state a figure that is wrong for part of the case.
- **The reduction is recorded with a stated approximation.** Ratios 85% (individual) and 70% (enterprise) are now recorded, and `reducible: false` marks the items the standard puts outside the reduction — previously `null` carried both "outside the reduction" and "not recorded". The official scope is the annual fees from the granted year for ten years, and a query carries no grant year, so `reductionMaxYears: 10` is a patent-year ceiling rather than the rule itself.
- **印花税 is removed.** The 2023 revision's 实施细则 article 110 lists the fee kinds and does not include it, and the payment guide does not charge it, so the item had no basis to keep.

## Alternatives considered

**Add a banded price field (`bands: [{from, to, amount}]`) and price both items exactly.** It would close both gaps. It lost on scope for this change: it reaches the types, the reader, the quantity arithmetic, the tool's parameter schema, and every test that builds an item, and the shape of a price model deserves its own decision rather than riding along with a transcription. The two nulls keep the gap visible in the meantime.

**Price the specification surcharge with its first band only.** Most specifications never reach page 301, so this would be right most of the time. It lost because "right most of the time" is a wrong invoice: a 320-page specification would undercharge every page over 300, and nothing in the report would say so.

**Leave the index untranscribed and let each deployment fill in the fees it bills.** That was the shipped state. It lost because the persona already required the tool to own money, so an empty index made the discipline unsatisfiable rather than merely narrow.

## Consequences

A default deployment prices a case's filing, examination, grant, annual-fee, and procedure fees and states a total, and it withholds that total only where it would otherwise have to invent a unit price. What remains is the two banded items, which need a price model that can hold a band, and the standing limit that the amounts are a mechanical copy: `verifiedOn` records when the copy was checked against its source, and nothing here asserts that a qualified person read it back.
