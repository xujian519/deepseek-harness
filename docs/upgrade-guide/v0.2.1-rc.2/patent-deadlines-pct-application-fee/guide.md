---
kind: upgrade-guide
description: "patent_deadlines counts the PCT application fee within the 30-month entry period and the priority claim fee from nationalPhaseEntryDate."
---

# PCT entry fees follow their own periods

English | [中文](guide.zh.md)

## Change

For a case with `isPctNationalPhase: true`, `patent_deadlines` previously counted the application-fee period from the international filing date. It now treats the application fee, publication printing fee, and any application surcharge as entry formalities under 专利法实施细则第121条: they fall due within the 30-month entry period counted from the priority date (32 months with the grace fee, 专利法实施细则第120条). The separate two-month period from `nationalPhaseEntryDate` belongs to the priority claim fee under 专利法实施细则第127条; that entry is returned as `priority-claim-fee` and stays pending while the entry date is unknown. Domestic cases are unchanged.

## Migration

1. For a PCT case, read `application-fee` from `computed`; it reports the 30-month entry deadline with `legalBasis: "专利法实施细则第121条、第120条"` and no longer depends on the entry date.
2. Supply `nationalPhaseEntryDate` (the 进入日) for a PCT case claiming priority so the two-month `priority-claim-fee` period can be computed; without it that entry is returned under `pending`.
3. Confirm: a PCT case filed 2024-01-01 without priority reports `application-fee` due 2026-07-01; with priority 2023-01-01 and `nationalPhaseEntryDate: "2025-07-01"`, `application-fee` is due 2025-07-01 and `priority-claim-fee` due 2025-09-01 with `legalBasis: "专利法实施细则第127条"`.
