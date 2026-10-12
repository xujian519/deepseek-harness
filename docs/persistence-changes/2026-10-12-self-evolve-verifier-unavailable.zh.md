---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-12-self-evolve-verifier-unavailable

[English](2026-10-12-self-evolve-verifier-unavailable.md) | 中文

## 概述

为持久化的 self-evolve 验证拒绝原因新增 `verifier-unavailable` 变体。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

已有记录仍然有效：该联合只新增一个备选，既有备选的含义不变。对 reason 做分支的读取方必须处理这个新值；在本改动之前构建、且穷举匹配旧备选的读取方需要自行更新，因为新写入的会话中会出现该值。只有基础 self-evolve provider 会写入它，且仅在某个验证维度没有信号时写入，因此本次改动之前写入的会话不可能包含它。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/self-evolve packages/test-support/self-evolve-eval：450 个测试通过。新值由 provider.spec.ts 的用例 'a missing judge is not scored favourably' 与 'lowering minAcceptConfidence does not turn a missing signal into an acceptance' 覆盖。

<a id="dev-note"></a>
## 开发备注

无。
