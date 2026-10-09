---
kind: upgrade-guide
description: "render_patent_document 删除 sections innerHTML 参数，全部模板改为必填受控草案 draft。"
---

# render_patent_document 改为必填受控草案

[English](guide.md) | 中文

## 变更

`render_patent_document` 不再接受 `sections` 参数（元素 id → innerHTML 记录），`draft` 改为必填。只传 `sections` 不传 `draft` 的调用不再渲染，而是在工具参数校验处被 `missing required property "draft"` 拒绝。

`draft` 按模板族携带带类型的结构：claims-spec 收 SpecDraft（著录项 `meta`、不带项号的 `claims`、多段 `abstract`、每幅附图一条 `drawingDescriptions`、`figureFiles`，以及五个说明书部分的 paragraph/list/table 块）；其余十个模板收 id 键控草案（`fields` 填叶级文本槽，`sections` 为 blocks 或 rows）。转换器生成标题、权项项号、图号、表题与勾选状态并转义全部文本，渲染成品不再携带模型撰写的 HTML。槽位只替换自身元素的内容，骨架包装与章节标题保留在模板中；claims-spec 的说明书只含生成的五个 `h3` 部分标题，模板示例中的 `h4`「实施例」已移除。

## 迁移

1. 把每次调用的 `sections` 参数换成 `draft`。各模板的 `SKILL.md`（位于 `assets/templates/patent/<模板>/`）给出槽位清单；草案校验报错会列出未知槽位与缺失的必填槽位。
2. 重新渲染一份有代表性的文书并与旧产物对比：标题、编号与表题现在由结构生成，旧 `sections` 载荷里自带这些内容的部分不再匹配。
3. 确认：传 `sections` 而不传 `draft` 时报 `missing required property "draft"`；传合法 `draft` 时照旧写出 HTML/PDF。
