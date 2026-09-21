---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-21-patent-model-call

English | [中文](2026-09-21-patent-model-call.zh.md)

## Summary

Adds the log-only patent/model-call event recording one model call the patent pipeline makes inside a tool.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-21-patent-model-call
baseline: false
changes:
  - root: "event:patent/model-call"
    previous: null
    after: "556bd9fc5c106b5e42bfd7ac407a89d921cbca9a88769979fcb9ff379e878f46"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

A new root in the same Session format version. Existing logs contain no such event and stay valid; readers that predate it refuse a log carrying it, as every required-on-read event does. The event is log-only and never model-visible on its own: the tool result already carries the stage output, and the event adds the call envelope (call site, manifest, provider route, token usage) plus the complete output text the keyless replay rebuilds the call order from. The request side stays reconstructable without its own record: the tool-call arguments are logged and the manifest plus the run's stage outputs make up the prompt.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/patent/patent-workflow/tests/model-call-log.spec.ts packages/patent/patent-workflow/tests/invariant.spec.ts packages/test-support/llm-replay/tests/llm-replay.spec.ts: 162 tests passed; snapshots/session/patent-oa-chain replays a full office-action chain (approval-gate pause plus the approved rerun) through dsh --profile headless.

<a id="dev-note"></a>
## Dev Note

None.
