---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-26-transport-cause-diagnostic

[English](2026-09-26-transport-cause-diagnostic.md) | 中文

## 概述

为序列化的 LLM 失败载荷增加可选字段 diagnostic，用于记录过粗的失败 code 背后那个带错误码的平台错误。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

现有日志仍然有效。diagnostic 为可选字段，只有适配器能够指出带错误码的根因时才会写入，因此此前写入的每个载荷含义不变，读取方也不会因缺失该字段而采用任何默认值。已发布的 V0–V3 失败载荷保持封闭，该字段只会出现在当前格式日志中；本次变更留在 V4 内，不意味着对更早版本提供回退或降级支持。

<a id="verification"></a>
## 验证

对 packages/llm/llm/tests、packages/llm/llm-retry/tests、packages/llm/llm-deepseek/tests、packages/client/ui-chat/tests、packages/client/ui-conversation/tests、packages/client/ui-trajectory/tests 运行 pnpm exec vitest run：2228 个测试通过。pnpm run test:snapshot -t transport-failure-retry：1 个通过，经 dsh --profile headless 比对携带 diagnostic 的 llm/retry 失败；语料门禁另有 3 个通过。用源码构建的 dsh web 指向一个连接即被断开的 socket：关闭重试时终端行显示为「This turn failed  DeepSeek Messages transport failed ECONNRESET: read ECONNRESET  TRANSPORT」，开启重试时重试行显示为「Failure reason: DeepSeek Messages transport failed ECONNRESET: read ECONNRESET」，两者均在 1280x900 与 390x844 视口下核对；Trajectory 目标也能渲染同一会话。

<a id="dev-note"></a>
## 开发备注

无。
