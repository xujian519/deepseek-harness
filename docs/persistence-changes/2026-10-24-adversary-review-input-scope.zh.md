---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-24-adversary-review-input-scope

[English](2026-10-24-adversary-review-input-scope.md) | 中文

## 概述

为持久化的 patent/workflow-run 事件增加可选的阶段级 inputScope 字段。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

已有记录仍然有效：inputScope 可选，旧运行中没有该字段，读取方视为未记录输入范围。写入方只对声明 opt-in 的原子（当前为 adversary-review）写入；值是该原子声明读取的状态键列表。它不替代阶段输出，也不替代重放输入。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/patent/patent-workflow/tests/workflow.spec.ts packages/patent/patent-core/tests/adversary-review.spec.ts：53 个测试通过。

<a id="dev-note"></a>
## 开发备注

无。
