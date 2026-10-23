---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-24-adversary-review-input-scope

English | [中文](2026-10-24-adversary-review-input-scope.zh.md)

## Summary

Adds an optional per-stage inputScope field to the persisted patent/workflow-run event.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-24-adversary-review-input-scope
baseline: false
changes:
  - root: "event:patent/workflow-run"
    previous: "2026-10-22-patent-workflow-revisions"
    after: "95ce6e0724b8c18c699693753732e17e4434f9fb94f1ad64c5e5ad365d7c4d82"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing records remain valid: inputScope is optional and absent on older runs, which readers treat as an unrecorded input scope. Writers add it only for atoms that opt in (currently adversary-review); the value lists the state keys the atom declares it reads. It does not replace stage output or replay input.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/patent/patent-workflow/tests/workflow.spec.ts packages/patent/patent-core/tests/adversary-review.spec.ts: 53 tests passed.

<a id="dev-note"></a>
## Dev Note

None.
