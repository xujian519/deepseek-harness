---
kind: upgrade-guide
description: "build_patent_filing 删除 content 参数、改为必填 SpecDraft；docx 自动生成权项项号、「图N为……」附图说明与表题段。"
---

# build_patent_filing 改为必填受控草案

[English](guide.md) | 中文

## 变更

`build_patent_filing` 不再接受 `content` 参数，`draft` 改为必填——与 claims-spec 渲染同一份 SpecDraft 结构。传 `content` 的调用会在参数校验处被 `missing required property "draft"` 拒绝。

成文后的 DOCX 随结构变化：权项自动加项号前缀；附图说明的列表项改写为「图N为……；/。」正文段；每个表格前生成「表 N · 名称」表题段，由独立的 表 计数器连续编号。表题段不带 `[NNNN]` 编号、也不占编号位——引擎只给正文段落编号，正文序列保持连续。

## 迁移

1. 把 `content` 映射为 `draft`：`meta`、不带项号的 `claims`、`abstract`、`figureFiles`、`drawingDescriptions`，以及五个说明书部分的块序列。从文本里删掉手写的项号、「图N」前缀、表题与 `[NNNN]` 前缀：前两类由工具生成，段落编号由引擎按段序重写。
2. 重新跑 `build_patent_filing`，并用 `verify_patent_filing` 验收成品。
3. 确认：不传 `draft` 时报 `missing required property "draft"`；验收报告给出正文段落连续的 `[NNNN]` 编号，表题段存在且不带编号。
