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
    after: "6485bdea0016f26ca590feb811672762c3e4a466a1df162caadbce087eb62d36"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing records remain valid: both fields are optional and absent on older runs, which readers treat as no revision log. Writers only add them when a retry signal rewound a stage or the record cap was hit. Each record is a log-only summary: gap id, rewind target, the digest of the rewound stage's replaced output as `before`, the digest of its replacement as `after`, rationale, outcome, and an optional `at` that is present only when the caller injected a clock. The records do not replace the stage results or replay input.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/patent/patent-workflow/tests/workflow-retry.spec.ts packages/patent/patent-workflow/tests/flexible-plan.spec.ts: 65 tests passed. pnpm exec vitest run --config vitest.snapshot.config.ts -t patent: 11 scenarios passed.

<a id="dev-note"></a>
## Dev Note

None.
