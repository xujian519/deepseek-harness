---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-22-patent-workflow-revisions

[English](2026-10-22-patent-workflow-revisions.md) | 中文

## 概述

在持久化的 patent/workflow-run 事件上新增可选的 revisions 与 revisionsTruncated 字段。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

已有记录仍然有效：两个字段均为可选，旧运行不携带，读取方按「没有回退记录」处理。写入方仅在结构化/正则回退发生或记录达到上限时写入。字段只是日志摘要（缺口编号、回退目标、前后产出摘要、原因、结果），不替代阶段结果，也不参与重放输入。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/patent/patent-workflow/tests/workflow-retry.spec.ts packages/patent/patent-workflow/tests/flexible-plan.spec.ts：59 个测试通过。pnpm run test:snapshot -t patent：11 个场景通过。

<a id="dev-note"></a>
## 开发备注

无。
