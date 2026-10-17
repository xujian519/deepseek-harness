---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-17-patent-workflow-evidence-ledger

English | [中文](2026-10-17-patent-workflow-evidence-ledger.zh.md)

## Summary

Adds the patent/evidence-ledger and patent/legal-gaps session events and an optional evidenceLedger field on patent/workflow-run.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-17-patent-workflow-evidence-ledger
baseline: false
changes:
  - root: "event:patent/evidence-ledger"
    previous: null
    after: "21a8536f828f11e9faf08635fe52956af4ee6017ef8983cbd91defb41bac4288"
    decision: same-version
  - root: "event:patent/legal-gaps"
    previous: null
    after: "790077a8f3ba90b34c4283a4b38b878b4e10af2cd53120f8f5da747c108932a9"
    decision: same-version
  - root: "event:patent/workflow-run"
    previous: "2026-09-16-upstream-sync"
    after: "e80f05a4b109cfba6d6049764537d04c217d556ed0c888a23059a3e720db0de6"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing patent/workflow-run records remain readable: the new field is absent on older runs, and this version treats absence as no ledger. The two added event types occur only in sessions written by this version, and older logs contain none of them. A reader that predates these discriminators rejects the log with SessionFormatUnsupportedError before execution, mutation, or recovery truncation, so it neither drops nor rewrites the records.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/patent/patent-workflow/tests/workflow.spec.ts packages/patent/patent-workflow/tests/service.spec.ts packages/patent/patent-workflow/tests/replay-consistency.spec.ts packages/patent/patent-tools/tests/patent-workflow-run.spec.ts packages/patent/patent-tools/tests/legal-gaps.spec.ts: 104 tests passed.

<a id="dev-note"></a>
## Dev Note

None.
