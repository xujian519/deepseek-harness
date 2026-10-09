---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-10-fork-attribution-resync

[English](2026-10-10-fork-attribution-resync.md) | 中文

## 概述

v0.2.1-alpha.2 同步合并了两组仅归属用途的来源种类，而它们各自都确认了同一个前驱。fork 的记录（2026-09-22-fork-source-attribution）新增了 `self-evolve`、`sidechat` 与 `patent-teams-report`；该版本的记录（2026-10-05-working-directory-attribution）新增了 working-directory 通知的归属。两条链都把 2026-09-21-user-question-reply 记为前驱，使 `event:agent/inbox/spliced`、`event:developer/message`、`event:session/title-llm-request` 与 `event:user/message` 的历史分叉。现在版本的记录接在 fork 的记录之后，本记录确认合并后的树实际携带的并集。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-10-fork-attribution-resync
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-05-working-directory-attribution"
    after: "0301e3760af7d7b861307251541c66628f38cb5262f1a8c9c82c17371806f106"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-05-working-directory-attribution"
    after: "bd7509f598012013bdb94741ff9986e75d53fcc81f024b8cd9152b4d69ce6a36"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-07-title-reasoning-effort"
    after: "d6688ca27df5baaffd4afeb0546ad20c7dde5213c712b6455c92140e634cc9e4"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-05-working-directory-attribution"
    after: "08021596969fdb8642e489e078da36fc75bc4ad7dc1e0a1a709926daa5d36ff3"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

既有记录保持有效。本记录新增的每一个来源种类都仅用于归属，声明的来源策略保留未知归属而不解释它。Session 格式仍为版本 4。

<a id="verification"></a>
## 验证

pnpm run verify-persistence-changes：4 个 root 与已确认历史一致，且记录中的 after 摘要等于当前树导出的 schema。

<a id="dev-note"></a>
## 开发备注

无。
