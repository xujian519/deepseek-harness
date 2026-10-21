---
kind: upgrade-guide
description: "patent_deadlines now starts the annual-fee surcharge window at the rolled fee due date and rolls the window end too."
---

# Annual-fee surcharge windows follow the reported due date

English | [中文](guide.zh.md)

## Change

`patent_deadlines` previously reported `latePaymentWindow.from` as the annual fee's un-rolled due date and `latePaymentWindow.to` as exactly six months later, without applying 专利法实施细则第5条 to either end. The window now starts on the fee's reported (rolled) due date, so `from` equals the entry's `dueDate`, and `to` is six months after that date, rolled under the same criterion. A new optional `latePaymentWindow.calendarCaveat` names the uncovered year when the window end's year has no loaded holiday arrangement. Fees whose due date needs no roll and whose window end is covered keep the same dates.

## Migration

1. Read `latePaymentWindow.from` and `.to` as final dates; do not add the rest-day roll yourself or compute `to` from `rawDueDate`.
2. Handle the optional `calendarCaveat` on the window: when present, `to` is un-rolled because the holiday arrangement for that year is missing.
3. Confirm: for a case filed 2023-10-01 and granted 2026-09-01, annual fee 4 is due 2026-10-08 (rolled from 2026-10-01) and its window is 2026-10-08 to 2027-04-08 with a `calendarCaveat` naming 2027.
