---
description: "Function plugin pricing a Chinese patent case's official fees from the fee index shipped with the package: the items a case owes with each one's counting basis, fee reduction, annual-fee tiers and the late-payment surcharge, and the patent_fees tool, which never states an amount the index cannot support."
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-fees

English | [中文](README.zh.md)

## Summary

Function plugin pricing a Chinese patent case's official fees from the fee index shipped with the package: the items a case owes with each one's counting basis, fee reduction, annual-fee tiers and the late-payment surcharge, and the patent_fees tool, which never states an amount the index cannot support.

## Table of Contents

- [patent_fees tool](#fee-tool)
- [Fee items and counting bases](#fee-items-and-counting-bases)
- [What is recorded and what is not](#what-is-recorded-and-what-is-not)
- [Fee reduction](#fee-reduction)
- [Annual fees and the surcharge](#annual-fees-and-the-surcharge)
- [Library API](#library-api)
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="fee-tool"></a>
## patent_fees tool

patent_fees prices one case: it takes the patent type and the steps the case is at, counts each indexed fee item by its basis, applies the case's fee reduction where the index records one, and reports every line with the statutory basis it came from. Each line states whether its amount is verified, and the total is withheld while any applicable line is not.

The tool exists because the patent discipline required fee amounts to be computed by a tool while no tool owned them: the persona and the quality gate both said 费用用工具计算, and the model had nothing to call. It also exists to make a refusal usable: an amount that has not been transcribed is unknown, so the tool hands back the item checklist and names what withholds the sum instead of returning a partial figure that reads as the price.

<a id="fee-items-and-counting-bases"></a>
## Fee items and counting bases

Each item declares the step it is owed at (`trigger`) and how its quantity is counted (`basis`): `per-case`, `per-claim-beyond` and `per-page-beyond` (subtracting the item's `freeUnits`), `per-priority`, `per-annuity-year`, `per-month`. The caller names the case's steps; an item whose step is not named is not priced at all, so the report's coverage is exactly the steps passed in.

```yaml
- id: claims-surcharge
  name: 权利要求附加费
  trigger: filing
  patentTypes: [invention, utility-model]
  basis: per-claim-beyond
  freeUnits: 10
  amount: null
  legalBasis: 专利法实施细则第110条第1款第（一）项
```

<a id="what-is-recorded-and-what-is-not"></a>
## What is recorded and what is not

An item's amount and the dates that support it are transcription content: `amount` (yuan, decimal string), `sourceDoc`, `effectiveFrom`, `verifiedOn`. Three states follow, and the tool reports which one each line is in:

| Status | Meaning |
| --- | --- |
| `verified` | The amount is recorded and so is the date a person checked it against `sourceDoc`. |
| `unverified` | The amount is recorded, its verification date is not. The line shows the figure and says it is unverified. |
| `unrecorded` | No amount is recorded. The line carries applicability and counts and no figure. |

The shipped index is in the third state for every item: `amount`, `sourceDoc`, `effectiveFrom`, and `verifiedOn` are null throughout, so a default deployment gets the item checklist, its counts, and an explicit refusal to total. The thresholds (10 claims, 30 pages) and the surcharge rule the shipped file does carry come from this repository's own statements — the `draft-claims` comment and the `patent-deadline` annual-fee entries — and are unverified in the same way the amounts are.

<a id="fee-reduction"></a>
## Fee reduction

`reductions` carries one entry per programme (`individual`, `enterprise`) with `reductionPercent` — the **waived** share, so 85 means 15% is still payable — and `requiresFiling`, which marks a reduction that needs a filed reduction record beforehand. An item joins a reduction only through its own `reducible` flag, and a year-indexed item through `reductionMaxYears`, because a reduction that covers the first six annual fees must not discount the twentieth. An item whose `reducible` is null reports that its scope is not recorded and stays at the full amount; a ratio that is not recorded yields no reduced figure at all.

<a id="annual-fees-and-the-surcharge"></a>
## Annual fees and the surcharge

Annual fees are priced one line per patent year. The years come from the caller — `patent_deadlines` owns the dates and reports which years are due — and the amount comes from the item's `tiers` (a year outside the transcribed tiers is reported rather than guessed). A delay on a year adds a surcharge line: `latePayment.monthlyPercent` of that year's full annual fee per started month, up to `latePayment.maxMonths`; past that window the line says so and states no amount, because the fee is no longer payable.

<a id="library-api"></a>
## Library API

- `loadFeeTable(path?)` / `parseFeeTable(source, origin)` — the index, validated fail-loud.
- `computeFees(table, query, options)` — the priced report: lines, pending items, the reduction outcome, and the total.
- `parseYuan` / `formatFen` / `applyPercent` / `sumFen` — money in integer 分; percentages round half up to the 分.
- `createPatentFeesTool({ table, policy })` — the tool over a loaded index.

No service is published: the index is a read-only asset and the tool is the in-process consumer, so a second consumer imports the library the way `dsh-patent-core` is consumed.

<a id="configuration"></a>
## Configuration

Schemastery configuration; both fields have a default.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| feeTablePath | string | packaged asset | Path of the fee-index YAML file. A missing or malformed file fails the plugin load. |
| failOnUnverified | boolean | `true` | Withhold the total while any applicable line lacks a verified amount. Turning it off reports a sum over the verified lines only, labelled as partial. |

<a id="model-experience"></a>
## Model Experience

### patent_fees tool

#### What the model sees

One registered tool named `patent_fees` with `patentType` and `triggers` required, and `claims`, `specificationPages`, `priorityClaims`, `annuityYears`, `extensionMonths`, `lateMonths`, and `reduction` optional. The result is the priced lines — id, name, basis, quantity with the basis it was counted from, unit amount, subtotal, payable, status, reduction, legal basis, recorded source, and notes — plus the pending items, the reduction outcome, the total, and the report notes, rendered as a Markdown table followed by the total, the reduction, the pending inputs, and the notes. The tool description states that money is reported only from transcribed amounts, that the total is withheld while any applicable line is not verified, and that an omitted step is not priced.

#### Token effect

Fixed definition cost on every request while the tool is enabled; each result is one table plus a few short sections, resent only until compaction.

#### KV Cache effect

Append-only; newly visible result prose follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **The shipped index carries no amounts.** Every `amount`, `sourceDoc`, `effectiveFrom`, and `verifiedOn` is null, so `patent_fees` reports applicability, counts, and statutory bases and never a figure, and the persona and the quality gate require the model to look an amount up before quoting it. Transcribing the official fee standard into `assets/fees/cn-fees.yaml` — per fee item, with the announcement's document number and the date it was checked — is work a deployment does for the fees it bills.
- **The structural fields are unverified too.** `trigger`, `patentTypes`, `basis`, `freeUnits`, `reducible`, `reductionMaxYears`, `tiers`, and `legalBasis` were transcribed from this repository's own statements and from the patent domain's step names, not from an official source; only the two `legalBasis` values pinned in `draft-claims` and the annual-fee article and surcharge rule pinned in `patent-deadline` are held to a recorded article number, and this repository has already recorded that its 细则 numbering mixes 2020 and 2010 revisions. Verify each field against the current fee announcement before invoicing.
- **Dates belong to `patent_deadlines`.** The tool takes `annuityYears` and `lateMonths` as inputs and computes no date and no started-month count itself, so a caller that has not run `patent_deadlines` cannot learn the years; a delay whose months were counted differently from the deadline package's late-payment window will disagree with it.
- **Percentages round half up to the 分** as an arithmetic convention of this package, stated once in `money.ts`; the official standard does not say how a fractional 分 is handled, and a deployment that must match a published rounding should check the difference on the amounts it bills.
- **A service fee, a foreign office fee, and a fee the index does not carry are out of scope.** The index covers the Chinese fee items it lists; the report says nothing about anything else, and its silence is not a zero.
- **No package invariant is published.** Whether an amount is right is a property of the content, and no runtime observation can falsify it independently; the mechanically checkable parts (index parsing, quantity arithmetic, the statuses, and the refusal to total) are checks the tool runs, so they do not meet the invariant bar.

### Dev Note

None.

No companion is published because the package owns no durable state or session event: the index is read at load, and every export is a pure function over an explicit query.
