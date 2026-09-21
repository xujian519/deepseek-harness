---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-21-patent-model-call

[English](2026-09-21-patent-model-call.md) | 中文

## 概述

新增 log-only 的 patent/model-call 事件，记录专利管线在工具内部发起的一次模型调用。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-21-patent-model-call
baseline: false
changes:
  - root: "event:patent/model-call"
    previous: null
    after: "9f02fcbc7e776511c9029a0c4658ee2dad6b68e466657dba9342ccaf97ed69f0"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

同一会话格式版本下的新 root。既有日志不含该事件、仍然有效；更早的读取方遇到带该事件的日志会拒绝，与所有 required-on-read 事件一致。该事件是 log-only 且本身不面向模型：工具结果已携带阶段产出，事件补上调用信封（调用点、manifest、provider 路由、token 用量）与完整输出文本——keyless 回放据此重建调用次序。记录在流结束后才写入，故一个端口并发服务多个调用方时，日志记的是完成次序；每条记录因此另带 `callSequence`（该调用的开始序号，按端口 wrapper 从 1 起；本字段出现之前的记录不带，其日志次序即调用次序）。请求侧无需自己的记录即可重建：工具调用入参已入日志，manifest 与该轮各阶段产出共同构成提示词。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/patent/patent-workflow/tests/model-call-log.spec.ts packages/patent/patent-workflow/tests/invariant.spec.ts packages/test-support/llm-replay/tests/llm-replay.spec.ts：162 个测试通过；snapshots/session/patent-oa-chain 经 dsh --profile headless 回放完整审查意见答复链（审批门暂停 + 放行后重跑）。

<a id="dev-note"></a>
## 开发备注

无。
