---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-16-upstream-sync

[English](2026-09-16-upstream-sync.md) | 中文

## 概述

同步后的工作树带有 19 个上游基线从未记录过的持久化事件根，以及 1 个可选事件体属性：agent/request-error、patent/plantask、patent/workflow-run、9 个 patent-teams/* 事件（member-added、member-removed、message-sent、task-created、task-gated、task-updated、task-validated、team-created、team-deleted）、7 个 self-evolve/* 事件（commit、end、mined、proposed、reflection、start、validated），以及 todo/write 上的 data.todos[].tags。已记录的历史只确认了上游的根，因此这些根全部被判为未确认的新增。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-16-upstream-sync
baseline: false
changes:
  - root: "event:agent/request-error"
    previous: null
    after: "3ce68f22dbe500044770c3e747ecb29ff058f9be23b20cfb433b5115b14687fb"
    decision: same-version
  - root: "event:patent-teams/member-added"
    previous: null
    after: "f12d2b6080a4b7dee55ebea0fdea0070909b7e5976cd6e022e72a28fd97ffe18"
    decision: same-version
  - root: "event:patent-teams/member-removed"
    previous: null
    after: "3b2f4b5d180cf4afa508cbc700d078341e4847611ecc60b80f6a9486a20e000a"
    decision: same-version
  - root: "event:patent-teams/message-sent"
    previous: null
    after: "f7952fb11e7169b6558dd1b2dfb976b9ae100d3b202492c99a12f3f6c863d4d3"
    decision: same-version
  - root: "event:patent-teams/task-created"
    previous: null
    after: "85631eca17553f2b7d209edc198f285f106a01eff88220cdda729513595d5b4c"
    decision: same-version
  - root: "event:patent-teams/task-gated"
    previous: null
    after: "02e1998cf81c86b9eb92d048ad9994f2f8bc36bdc26e1e16dc7aa30eccf1ffb7"
    decision: same-version
  - root: "event:patent-teams/task-updated"
    previous: null
    after: "98d71d18d263fbc1a38e1a314d243e4bcb350b11f419f31c0c42c0a03d1adc09"
    decision: same-version
  - root: "event:patent-teams/task-validated"
    previous: null
    after: "3de55eacf0f371e68d78f99aad63fd0a8b72e6f64d1acc1c1392f0e30dd475c8"
    decision: same-version
  - root: "event:patent-teams/team-created"
    previous: null
    after: "d3403e99eac7930bea2f320fece4f5170255ed812c6bdb5c0b2057e5c8d47010"
    decision: same-version
  - root: "event:patent-teams/team-deleted"
    previous: null
    after: "6ccaff85d31459a300c449653602514c34489d856e2e1bc31d9a27b77e634d95"
    decision: same-version
  - root: "event:patent/plantask"
    previous: null
    after: "21031fbcbdff405ad47179a7acc9fb7bcf70e838ee106d70f7aa26604fb61ce5"
    decision: same-version
  - root: "event:patent/workflow-run"
    previous: null
    after: "81664fc5119d57f14ba526b8480c4264e98f716e12bf717aa01e7d9fac6c76da"
    decision: same-version
  - root: "event:self-evolve/commit"
    previous: null
    after: "4ec3446a838614d12c506302b6c9cb6eb59e9b478840ab4ac7fba0e78bf66016"
    decision: same-version
  - root: "event:self-evolve/end"
    previous: null
    after: "1388c9a96fb4f7bb44ff675188121659b3d8714369eb761db1fbd51a7ceeb2d9"
    decision: same-version
  - root: "event:self-evolve/mined"
    previous: null
    after: "f4e68d27424e4bee890165330db6ac45cbfcd3c8fedf4f05b53931f3e614cb4b"
    decision: same-version
  - root: "event:self-evolve/proposed"
    previous: null
    after: "99588ecf33e317788daf0cb0c6c59c7398b1edb16db31ab0ea5c7062b2e5161c"
    decision: same-version
  - root: "event:self-evolve/reflection"
    previous: null
    after: "65a9d813bdd59744577a5e1301cd107df818197ad7768dd859a2d6a69a413db7"
    decision: same-version
  - root: "event:self-evolve/start"
    previous: null
    after: "3941545fcf511ea09245d6327c6b58dac7462d98f9d3e71c80293605e42414dd"
    decision: same-version
  - root: "event:self-evolve/validated"
    previous: null
    after: "b34fa6922bab30f7cd3dd40653128741936986f3de1258eae1741c1e78c8498b"
    decision: same-version
  - root: "event:todo/write"
    previous: "2026-09-11-initial"
    after: "df5b1fe42a0660d1a3c4beb7c4f20a6a8b5d2857b9efaeb554c9dde9ea75e8b2"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新增的事件根都是加入持久化日志词表的普通事件类型，data.todos[].tags 是既有事件体上的可选属性。新增之前写下的记录只是不含它们，而早于它们的读取方会忽略未知事件类型与缺失的可选属性，因此旧记录的 replay 行为不变。没有任何既有事件体新增或丢失必需属性、没有属性改变类型，会话头与事件信封也未变动，所以该变更仍停留在同一个会话格式版本内。

<a id="verification"></a>
## 验证

记录的 after schema 快照与生成 docs/persistence-schema.json 的同一份源清单同源提取，因此每个受影响根的记录摘要都等于当前清单摘要；随后 pnpm run verify-persistence-changes 以退出码 0 报告当前各根与已记录历史一致。同一清单上 pnpm run verify-persistence-catalog 与 pnpm run verify-persistence-formats 保持通过。

<a id="dev-note"></a>
## 开发备注

无。
