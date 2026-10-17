---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-17-patent-workflow-evidence-ledger

[English](2026-10-17-patent-workflow-evidence-ledger.md) | 中文

## 概述

新增 patent/evidence-ledger 与 patent/legal-gaps 会话事件，并在 patent/workflow-run 上新增可选的 evidenceLedger 字段。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

已有的 patent/workflow-run 记录仍可读取：旧运行没有该字段，本版本将缺失视为没有证据台账。两个新增事件类型只出现在本版本写入的会话中，旧日志不包含它们。早于这些判别字段的读取器会在执行、修改或恢复截断之前以 SessionFormatUnsupportedError 拒绝该日志，因此不会丢弃或改写这些记录。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/patent/patent-workflow/tests/workflow.spec.ts packages/patent/patent-workflow/tests/service.spec.ts packages/patent/patent-workflow/tests/replay-consistency.spec.ts packages/patent/patent-tools/tests/patent-workflow-run.spec.ts packages/patent/patent-tools/tests/legal-gaps.spec.ts：104 个测试通过。

<a id="dev-note"></a>
## 开发备注

无。
