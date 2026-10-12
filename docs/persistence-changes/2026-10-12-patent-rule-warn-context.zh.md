---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-12-patent-rule-warn-context

[English](2026-10-12-patent-rule-warn-context.md) | 中文

## 概述

在持久化的 `MessageSourceMap` 中新增 `patent-rule-gate` 消息来源：受门禁工具结果上的 warn 级专利规则命中，改为在下一次请求以上下文到达模型，而不再只留一行日志。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

旧读者：`MessageSourceMap` 是可合并扩展的联合类型，没有消费方对 `source.kind` 做穷尽分支，因此带 `patent-rule-gate` 的记录读作一条来源未识别的用户消息，其内容仍是普通文本。新读者：该来源出现前写入的记录不含此取值，缺失不改变任何行为。该来源只由 patent preset 的 warn 路径产生；携带它的消息与其他注入上下文同样被接纳。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/patent/patent-rule/tests/post-execute.spec.ts：16 个测试通过；用例断言注入上下文的文本及其 `source.kind`、下游 block 决策仍然生效且其自带上下文排在注入项之后、同一结果的 block 级命中与 fail-closed 的 review 级命中都保留 warn 上下文、无 warn 命中时不附任何上下文、以及随包规则集命中（PAT-ABS-001）时确实注入。pnpm exec vitest run packages/patent/patent-rule/tests：291 个测试通过。pnpm exec vitest run --config vitest.e2e.config.ts packages/patent/patent-rule/tests/warn-context.e2e.ts：1 个测试通过；该用例经 Loader 启动 headless profile，挂一个探针工具与一段脚本化适配器，断言 warn 上下文被 splice 进收件箱、并在第二步作为模型输入先于该步回复被接纳，同时被门禁的结果保持成功。

<a id="dev-note"></a>
## 开发备注

无。
