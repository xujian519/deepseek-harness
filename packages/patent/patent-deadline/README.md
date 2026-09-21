---
description: "Function plugin computing the Chinese patent statutory and designated deadlines of one case: the period arithmetic and delivery rules of 专利法实施细则 (periods counted from the dispatch date), a shipped State Council holiday calendar for rest-day roll-forward, and the patent_deadlines tool."
kind: "package-reference"
---

# @deepseek-ai/dsh-patent-deadline

English | [中文](README.zh.md)

## Summary

Function plugin computing the Chinese patent statutory and designated deadlines of one case: the period arithmetic and delivery rules of 专利法实施细则 (periods counted from the dispatch date), a shipped State Council holiday calendar for rest-day roll-forward, and the patent_deadlines tool.

## Table of Contents

- [patent_deadlines tool](#patent_deadlines-tool)
- [Period and delivery arithmetic (library API)](#period-and-delivery-arithmetic-library-api)
- [Work calendar asset](#work-calendar-asset)
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="patent_deadlines-tool"></a>
## patent_deadlines tool

patent_deadlines reports the deadline set of one case from its patent category, filing date, whether it claims priority, and the notices it has received. Each entry carries its reported end date, the period's own end date, remaining days, status, and the article it comes from.

Two inputs are deliberate rather than inferred. **Whether the case claims priority** is supplied by the agent or the human handling the case: it decides whether the substantive-examination request is counted from the priority date (the start the office uses in practice) or from the filing date, so a half-filled record must not flip it silently — a priority date without a claim, or a claim without a date, fails the call. **The roll-forward criterion** selects between the statutory reading and the un-rolled one; both end dates are always returned.

Periods that a notice starts — registration and divisional filing at the grant notice, reexamination at the rejection decision, and the office-action, reexamination-notice, and invalidation periods at the delivered document — are reported as pending entries naming the exact notice delivery record still missing. The tool never approximates them from the filing date. Annual fees are numbered from the granted patent year, so they too wait for the grant publication date.

<a id="period-and-delivery-arithmetic-library-api"></a>
## Period and delivery arithmetic (library API)

The package re-exports the ported rules for direct callers:

- `periodEnd(start, period)` — 细则第5条: the start day is not counted, a month or year period ends on the corresponding day of its last month, and a month with no corresponding day ends on its last day. `1999-12-31` plus two months is `2000-02-29`.
- `resolveDeliveryMode(request)` — an omitted mode means electronic delivery.
- `resolveDeliveryDate(request)` — 细则第4条 as revised and the 2023 审查指南: a designated or statutory period is counted from the delivery date, which for electronic delivery is the day the document enters the electronic system and, absent evidence of a later day, the dispatch date it is presumed to be — so the period runs from the dispatch date and carries no 15-day extension. Postal delivery is the evidenced receipt date, otherwise 15 days after dispatch; direct delivery is the hand-over day; service by announcement is one month after publication.
- `WorkCalendar.rollForward(date)` — an end date on a statutory holiday or moved weekly rest day moves to the first working day after it.
- `evaluateDeadlines(query, options)` — assembles the whole set, applies the requested roll-forward criterion, and dates every entry against an explicit `today`.
- `renderDeadlineReport(report, meta)` — the Markdown the tool returns.

All of these are keyless pure functions except the calendar loaders.

<a id="work-calendar-asset"></a>
## Work calendar asset

`assets/work-calendar/cn-holidays.yaml` transcribes the State Council's holiday arrangements, recording both the days off and the weekend days moved to working days. Each year cites the notice it came from. The shipped file covers 2025 (国办发明电〔2024〕12号) and 2026 (国办发明电〔2025〕7号); a new year is appended once its arrangement is published.

A date whose year has no loaded arrangement is not assumed to be a working day: the entry keeps its un-rolled end date and carries a `calendarCaveat` naming the uncovered year, so a report never presents a rest-day roll-forward that was never verified. The un-rolled criterion consults no calendar at all.

<a id="configuration"></a>
## Configuration

Schemastery configuration, every field optional.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| calendarDir | string | packaged asset | Directory holding `cn-holidays.yaml`; must mirror the packaged layout. A missing or invalid file fails the plugin load. |
| reminderLeadDays | number | 30 | Warn when an end date falls within this many days. A firm policy, not a legal period. |

## Model Experience

### patent_deadlines tool

#### What the model sees

One registered tool named `patent_deadlines` with a required `patentType` enum (`invention`, `utility-model`, `design`), `filingDate`, and `claimsPriority`, plus optional `priorityDate`, `isPctNationalPhase`, `authorizationPublicationDate`, `marketingApprovalDate`, `restDayRule`, and `notices` (each with a document kind, a delivery mode defaulting to electronic, the matching delivery date, and an optional designated length in months). The result renders as a Markdown table of computed deadlines with the reported and un-rolled end dates, remaining days, status, and legal basis, followed by the pending entries that name the missing notice delivery, the unverified-calendar warning, and the recovery and extension rules that apply once something is overdue. A `claimsPriority`/`priorityDate` contradiction comes back as a tool error naming both fields.

#### Token effect

Fixed definition cost on every request while the tool is enabled; each result is one short table plus a pending list, resent only until compaction.

#### KV Cache effect

Append-only; newly visible result prose follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **The holiday calendar ships 2025-2026 only** — an end date beyond those years is reported un-rolled with a `calendarCaveat`. Extend the shipped asset (or point `calendarDir` at your own) before relying on a far-future end date that lands on a weekend. The un-rolled criterion (`restDayRule: 'omit'`) is unaffected.
- **The un-rolled criterion is for recording the period, not for acting** — it reports each period's own end date for records whose subject is the period itself; answering, paying, and filing deadlines still carry the statutory roll-forward.
- **The granted patent year is derived from the grant publication date** — the entry for each annual fee assumes the standard case where the granted year is the patent year containing that date, so fees for a case granted before its first annuity year are not modelled.
- **Recovery and extension are advice, not rows** — 细则第6条 recovery windows and the guideline's two-month extension are stated in the report when something is overdue, but they are not computed as their own deadlines because they start from a lapse notice this tool does not take as input.
- **The current day is not a tool input** — it comes from the host clock, so the "as of" date in the result is the host's local date; a model cannot date a report against an invented day.
- **Patent-term compensation amounts are not computed** — the request deadline for 专利法第42条第2款 and 第3款 is reported; the compensation length itself (细则第78条、第82条) is out of scope.
- **Priority is a claim, not a derivation** — the tool states the start date it used but does not judge whether a priority claim is valid or timely; that is the case file's question.
- **No case-record integration** — notices are supplied per call; nothing here reads or writes a case file.

### Dev Note

None.

No companion is published because the package owns no durable state or event: every export is a pure function over an explicit query, and the one asset it reads is validated fail-loud at plugin load.
