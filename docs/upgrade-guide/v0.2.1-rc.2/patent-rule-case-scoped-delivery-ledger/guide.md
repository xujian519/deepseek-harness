---
kind: upgrade-guide
description: "The patent-rule delivery gate now scopes case-named prerequisite calls to that case, so a gate run for case A no longer authorizes a delivery for case B."
---

# Delivery-gate evidence is scoped by case

English | [中文](guide.zh.md)

## Change

The delivery gate's ledger was keyed only by the calling agent. In one session handling several cases, a `rule_check` (or another prerequisite) executed while working on case A satisfied the same prerequisite for case B's delivery. The ledger is now keyed by agent and by the case key a call names (`caseId`, `case_id`, `case_dir`, or `caseDir`). A prerequisite that names a case satisfies only that case; another case's records are never consulted. A prerequisite that names no case remains session-scoped and is used only when the delivery's case has no own record. A delivery that names no case accepts any record from its session.

## Migration

1. When a delivery call names a case, pass the same case identifier on its prerequisite calls; otherwise those prerequisites are session-scoped evidence.
2. Re-run each case's prerequisites after switching cases in one session instead of relying on an earlier case's run.
3. Confirm: `rule_check` with `caseId: "case-A"` followed by `render_patent_document` with `caseId: "case-B"` is denied and names the missing prerequisite; running `rule_check` with `caseId: "case-B"` then allows the render.
