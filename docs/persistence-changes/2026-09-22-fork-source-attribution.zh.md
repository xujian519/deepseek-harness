---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-22-fork-source-attribution

[English](2026-09-22-fork-source-attribution.md) | 中文

## 概述

将 self-evolve、sidechat 与 patent-teams-report 记为会话来源策略中的仅归因来源类型，使这三项相对已接受的格式 4 基线的增加保持同版本，而不需要格式 5。

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
    previous: "2026-09-16-session-format-v4"
    after: "f4f2424597df0567cd59b35e60684e967deb30803600d7e34dc11d86c298880a"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-16-session-format-v4"
    after: "d8eae0dc0feb5d96561d9388d2d0b7cecbc130f0a5f01bcb49e910bd21d7a871"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-16-session-format-v4"
    after: "b11448027a364e518726379f5692fbcb3459abae999975dfb5b24a29836c030e"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-16-session-format-v4"
    after: "bca411f41b35050229d6515ed5a3c22aa0326694275521c018f3e272a7c136b3"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已接受的格式 4 基线未记录这三个类型，且每个都由仅本仓库提供的写入方声明。在限定之前，分类器把每一处增加都读作未限定的联合备选，而兼容性规则将其视为破坏性变更。限定陈述了这些写入方本就满足的读取方承诺：没有对应插件的读取方保留记录的内容与来源的全部 JSON 属性，且该类型不带来校验、回放或权限要求。检查该类型的行为留在写入方内部——self-evolve 循环判断自己的提示、better-sidebar 结构化渲染侧会话边界、patent-teams 依据 senderSessionId 渲染发送会话——因此其他读取方不丢失信息。其余来源类型保持原有归因限定，增量规则因此适用；已接受的 3 到 4 转换、写入方版本与全部已有记录保持不变。

<a id="verification"></a>
## 验证

pnpm run verify-persistence-catalog 报告目录、中英文页面、known-event-types 模块与模式清单均为最新。pnpm exec vitest run scripts/persistence-changes.spec.ts scripts/persistence-schema.spec.ts：161 个测试通过。pnpm run persistence-changes --check 接受这四处记录的转换，且没有未确认的变更。

<a id="dev-note"></a>
## 开发备注

无。
