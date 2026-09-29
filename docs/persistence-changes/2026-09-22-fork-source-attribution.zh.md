---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-22-fork-source-attribution

[English](2026-09-22-fork-source-attribution.md) | 中文

## 概述

将 self-evolve、sidechat 与 patent-teams-report 记为会话来源策略中的仅归因来源类型，使这三项相对已接受的格式 4 基线的增加保持同版本，而不需要格式 5。合并上游 `dsh-v0.2.0-rc.2` 后，本确认改接在 [2026-09-21-user-question-reply](2026-09-21-user-question-reply.zh.md) 之上，因此合并后的 schema 还带有上游的 `user-question-reply` 归属类型。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-22-fork-source-attribution
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-21-user-question-reply"
    after: "db54cc04ba2cb7603630dfde2c1a5d479de8217deabde0c06a370ecee19922ee"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-21-user-question-reply"
    after: "6b6ac01d2684845a20d8ace37d0b08fff13f27ed5e077bda5edc88a3e02a845e"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-21-user-question-reply"
    after: "99a7dde2199675a3b2b3e12fd5bc26977a827bc669bd401eba2728259f9d456a"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-21-user-question-reply"
    after: "65413309bd7e40004a5852115a882aa1ecfabe842ec1e07e4d77037a99134cee"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已接受的格式 4 基线未记录这三个类型，且每个都由仅本仓库提供的写入方声明。在限定之前，分类器把每一处增加都读作未限定的联合备选，而兼容性规则将其视为破坏性变更。限定陈述了这些写入方本就满足的读取方承诺：没有对应插件的读取方保留记录的内容与来源的全部 JSON 属性，且该类型不带来校验、回放或权限要求。检查该类型的行为留在写入方内部——self-evolve 循环判断自己的提示、better-sidebar 结构化渲染侧会话边界、patent-teams 依据 senderSessionId 渲染发送会话——因此其他读取方不丢失信息。其余来源类型保持原有归因限定，增量规则因此适用；已接受的 3 到 4 转换、写入方版本与全部已有记录保持不变。

<a id="verification"></a>
## 验证

pnpm run verify-persistence-catalog 报告目录、中英文页面、known-event-types 模块与模式清单均为最新。pnpm exec vitest run scripts/persistence-changes.spec.ts scripts/persistence-schema.spec.ts：161 个测试通过。pnpm run persistence-changes --check 接受这四处记录的转换，且没有未确认的变更。rc.2 合并用 `pnpm exec tsx scripts/persistence-changes.ts --update 2026-09-22-fork-source-attribution` 从合并后的源码树重新推导确认摘要；`pnpm run verify-persistence-changes` 报告 82 个根与 12 条历史记录匹配。

<a id="dev-note"></a>
## 开发备注

无。
