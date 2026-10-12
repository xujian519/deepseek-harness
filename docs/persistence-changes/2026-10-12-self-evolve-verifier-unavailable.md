---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-12-self-evolve-verifier-unavailable

English | [中文](2026-10-12-self-evolve-verifier-unavailable.zh.md)

## Summary

Adds the `verifier-unavailable` variant to the persisted self-evolve validation rejection reason.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-12-self-evolve-verifier-unavailable
baseline: false
changes:
  - root: "event:self-evolve/validated"
    previous: "2026-09-16-upstream-sync"
    after: "87d6299014acfdb8a84a84cc478128e733a759ef37a7f104e8c2ece52854f242"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing records remain valid: the union gains one alternative and no existing alternative changes meaning. A reader that switches on the reason must handle the new value; one built before this change that exhaustively matches the old alternatives needs its own update, because the value appears in newly written sessions. Only the base self-evolve provider writes it, and only when a verification dimension produced no signal, so sessions written before this change cannot contain it.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/self-evolve packages/test-support/self-evolve-eval: 450 tests passed. The new value is covered by provider.spec.ts cases 'a missing judge is not scored favourably' and 'lowering minAcceptConfidence does not turn a missing signal into an acceptance'.

<a id="dev-note"></a>
## Dev Note

None.
