---
kind: upgrade-guide
description: "patent_deadlines now starts a PCT application fee at nationalPhaseEntryDate and keeps it pending when that date is absent."
---

# PCT application fees start at the national-phase entry date

English | [中文](guide.zh.md)

## Change

For a case with `isPctNationalPhase: true`, `patent_deadlines` counted the application-fee period from the international filing date. A 2024 international filing therefore reported the fee as overdue in 2024 even though entry into the Chinese national phase was still open until 2026. The period now starts at the new `nationalPhaseEntryDate` input under 专利法实施细则第120条. When a PCT case omits that date, the `application-fee` entry is returned under `pending` with `requiredInput: "nationalPhaseEntryDate（进入中国国家阶段之日）"` instead of being computed from another date. Domestic cases are unchanged.

## Migration

1. Supply `nationalPhaseEntryDate` (the 进入日) for every PCT case in `patent_deadlines` calls.
2. Read the `application-fee` entry from `computed`; when it appears in `pending`, record the entry date and re-run rather than using the international filing date.
3. Confirm: a PCT case filed 2024-01-01 with `nationalPhaseEntryDate: "2025-07-01"` reports the application fee due 2025-09-01 with `legalBasis: "专利法实施细则第120条"`; the same case without the date lists `application-fee` under `pending`.
