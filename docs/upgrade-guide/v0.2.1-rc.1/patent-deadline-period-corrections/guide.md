---
kind: upgrade-guide
description: "@deepseek-ai/dsh-patent-deadline corrects design terms, annual-fee years, category gates, and default response periods, and adds compensation, paid-through, horizon, and time-zone inputs."
---

# Patent deadline periods corrected by category

English | [中文](guide.zh.md)

## Change

The `patent_deadlines` tool and `evaluateDeadlines` now derive periods per category. A design filed before 2021-06-01 has a 10-year term; one filed on or after that day has 15 years. Annual fees stop at the last year of the term (including a granted `termCompensationYears`), so an expired patent no longer reports fees for years that cannot exist. Term compensation exists only for an invention, priority restoration and addition only for an invention or utility model, and PCT national-phase entries do not apply to a design; a query asserting the opposite now fails instead of emitting the entry.

The first office-action default is four months for an invention in substantive examination and two months for a utility model or design in preliminary examination. The reexamination-notice answer defaults to one month. The invalidation answer cites 审查指南第四部分第三章第4.4.1节.

New optional inputs: `termCompensationYears` (invention, 0–5) extends the term and its fee years; `paidThroughYear` omits annual fees recorded as paid. New configuration: `annuityHorizonYears` (default 2) and `timeZone` (default `Asia/Shanghai`), which replaces the host's local date as the source of "today". The report also prints each notice's delivery rule and states that the patent term and priority window are excluded from recovery (细则第6条第5款).

## Migration

1. For a granted patent whose annual fees are paid through a known year, pass that year as `paidThroughYear`; otherwise the report lists fees inside the horizon as overdue.

2. Pass `termCompensationYears` when compensation has been granted; without it the report caps fees at the statutory term.

3. Update expectations for a utility model or design: first office action is two months, and term-compensation, priority-restoration, and priority-addition entries no longer appear. A design also loses the PCT entries, so remove `isPctNationalPhase: true` from a design query; a utility model may keep it. Remove `marketingApprovalDate` from a design or utility-model query; the call now fails.

4. Remove host-time-zone assumptions. Set `timeZone` only when the deployment must read "today" outside `Asia/Shanghai`.

5. Confirm: `pnpm exec vitest run packages/patent/patent-deadline/tests` passes, and a utility-model query with a first office action shows a two-month period.
