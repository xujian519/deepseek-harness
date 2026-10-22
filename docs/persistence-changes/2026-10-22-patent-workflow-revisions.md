---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-22-patent-workflow-revisions

English | [中文](2026-10-22-patent-workflow-revisions.zh.md)

## Summary

Adds optional revisions and revisionsTruncated fields to the persisted patent/workflow-run event.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-22-patent-workflow-revisions
baseline: false
changes:
  - root: "event:patent/workflow-run"
    previous: "2026-10-17-patent-workflow-evidence-ledger"
    after: "b989347b8e3e6c98d683f45b309f2177b3d869acf02fee91f2f1764fa4d1a04b"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing records remain valid: both fields are optional and absent on older runs, which readers treat as no revision log. Writers only add them when a retry signal rewound a stage or the record cap was hit. The fields are log-only summaries (gap id, rewind target, digest of before/after output, rationale, outcome); they do not replace the stage results or replay input.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/patent/patent-workflow/tests/workflow-retry.spec.ts packages/patent/patent-workflow/tests/flexible-plan.spec.ts: 59 tests passed. pnpm run test:snapshot -t patent: 11 scenarios passed.

<a id="dev-note"></a>
## Dev Note

None.
