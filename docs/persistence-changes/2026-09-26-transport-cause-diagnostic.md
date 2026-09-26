---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-26-transport-cause-diagnostic

English | [中文](2026-09-26-transport-cause-diagnostic.zh.md)

## Summary

Adds an optional diagnostic to the serialized LLM failure payload, naming the coded platform error behind a failure code too coarse to act on.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-26-transport-cause-diagnostic
baseline: false
changes:
  - root: "event:assistant/attempt"
    previous: "2026-09-16-session-format-v4"
    after: "e7179ba1575fe95c2cfe1260ffb8cfa82e60f24c92ca7f343b08474a187e197d"
    decision: same-version
  - root: "event:assistant/message"
    previous: "2026-09-16-session-format-v4"
    after: "fea632e9ea42a1aecedd25c540d881990c161c2d3e14bd7c92b5812178d6f625"
    decision: same-version
  - root: "event:llm/retry"
    previous: "2026-09-14-image-offload"
    after: "fb0e3ac0685d9c9305f1a83386c6c4b62305df43539602dfbfdf6d0ebfe36450"
    decision: same-version
  - root: "event:turn/end"
    previous: "2026-09-16-session-format-v4"
    after: "382951d480b72af74e99bb9a6fb3f6cba36a2c58055a7956e9c4b58c9ce248bb"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing logs stay valid. diagnostic is optional and absent unless an adapter can name a coded cause, so every payload written before this change keeps its exact meaning and no reader defaults from its absence. Released V0-V3 failure payloads remain closed, so the field appears only in current-format logs; the change stays within V4 and implies no fallback or downgrade support for predecessors.

<a id="verification"></a>
## Verification

pnpm exec vitest run over packages/llm/llm/tests, packages/llm/llm-retry/tests, packages/llm/llm-deepseek/tests, packages/client/ui-chat/tests, packages/client/ui-conversation/tests, and packages/client/ui-trajectory/tests: 2228 tests passed. pnpm run test:snapshot -t transport-failure-retry: 1 passed, comparing the persisted llm/retry failure carrying the diagnostic through dsh --profile headless, and the corpus gate adds 3 passed. A source-built dsh web pointed at a socket that dies on connect rendered the terminal row as "This turn failed  DeepSeek Messages transport failed ECONNRESET: read ECONNRESET  TRANSPORT" with retries disabled, and the retry row as "Failure reason: DeepSeek Messages transport failed ECONNRESET: read ECONNRESET" with retries enabled, at 1280x900 and 390x844 viewports; the Trajectory target rendered the same session.

<a id="dev-note"></a>
## Dev Note

None.
