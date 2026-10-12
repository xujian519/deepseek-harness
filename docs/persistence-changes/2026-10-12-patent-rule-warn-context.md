---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-12-patent-rule-warn-context

English | [中文](2026-10-12-patent-rule-warn-context.zh.md)

## Summary

Adds the `patent-rule-gate` message source to the persisted `MessageSourceMap`, so a warn-level patent rule hit on a gated tool result reaches the model as context on the next request instead of only a log line.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-12-patent-rule-warn-context
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-10-fork-attribution-resync"
    after: "90fff1286544d6863eecf88edcf289585d929386d14acd91847ac8bc9637b17b"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-10-fork-attribution-resync"
    after: "aedeecf02e22392632a1289614b71d6c8c9084c90833c145f0c39c3318e9cc70"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-10-fork-attribution-resync"
    after: "a7a14313dec843213eb71f123e6db5e9497833e3e315dab90bd623ddf4e94d43"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-10-fork-attribution-resync"
    after: "0d9140cfdca61cd0bc7ad0b736fd1db14c3f7fc78a70beadc742071021c3146d"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Older readers: `MessageSourceMap` is merge-extensible and no consumer switches on `source.kind` exhaustively, so a record carrying `patent-rule-gate` reads as a user message whose producer is unidentified; its content is ordinary text. Newer readers: records written before this source existed contain no such value, and absence changes nothing. The source is produced only by the patent preset's warn path; a message carrying it is admitted like any other injected context.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/patent/patent-rule/tests/post-execute.spec.ts: 16 tests passed; the suite asserts the injected context text and its `source.kind`, that a downstream block decision still wins while keeping its own context behind the injected one, that a block-level hit and a fail-closed review-level hit of the same result keep the warn context, that no context is attached without a warn hit, and that a hit of the shipped rule set (PAT-ABS-001) injects one. pnpm exec vitest run packages/patent/patent-rule/tests: 291 tests passed. pnpm exec vitest run --config vitest.e2e.config.ts packages/patent/patent-rule/tests/warn-context.e2e.ts: 1 test passed; it boots the headless profile through the Loader with a probe tool and a scripted adapter, then asserts the warn context is spliced into the inbox and admitted as the second step's model input ahead of that step's reply, with the gated result left successful.

<a id="dev-note"></a>
## Dev Note

None.
