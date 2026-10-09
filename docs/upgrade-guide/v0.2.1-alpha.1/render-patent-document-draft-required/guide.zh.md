---
kind: upgrade-guide
description: "render_patent_document 删除 sections innerHTML 参数，全部模板改为必填受控草案 draft。"
---

# render_patent_document 改为必填受控草案

[English](guide.md) | 中文

## 变更

`render_patent_document` 不再接受 `sections` 参数（元素 id → innerHTML 记录），`draft` 改为必填。只传 `sections` 不传 `draft` 的调用不再渲染，而是在工具参数校验处被 `missing required property "draft"` 拒绝。

`draft` 按模板族携带带类型的结构：claims-spec 收 SpecDraft（著录项 `meta`（案卷号 `caseNumber`）、不带项号的 `claims`、多段 `abstract`、按图序排列的 `figureFiles`、摘要附图号 `abstractFigure`（须为 `1..figureFiles` 项数的整数，缺省第 1 幅；两条通道都按它标注摘要附图），以及五个说明书部分的 paragraph/list/table 块——附图说明部分恰每幅附图一条列表项，条数必须等于 `figureFiles` 项数）；其余十个模板收 id 键控草案（`fields` 填叶级文本槽，`sections` 为 blocks 或 rows）。转换器生成标题、权项项号、图号、表题与勾选状态并转义全部文本，渲染成品不再携带模型撰写的 HTML。槽位只替换自身元素的内容，骨架包装与章节标题保留在模板中；被省略的可选槽位不向成品贡献任何文本（撰写期提示语不进入交付件）。编号由草案供给而非模板自造：claims-spec 的抬头编号行与页脚印 `meta.caseNumber`，每个文档模板的抬头编号行（`doc-number`）与页脚编号（`footer-case`）都取自草案，成品里不会留下 `CS-2026-XXXX` 一类伪造占位。claims-spec 的说明书只含生成的五个 `h3` 部分标题，模板示例中的 `h4`「实施例」已移除。

正文槽位改为落在分区标题之下的正文容器上，因此填充正文不会吞掉分区标题：patentability-opinion 的八个分区槽位更名为 `basis-body`、`claim-decomposition-body`、`feature-comparison-body`、`inventiveness-step-1/2/3`（对应 5.1/5.2/5.3）、`other-requirements-body`、`evidence-body`、`citation-log-body`、`assumptions-body`；search-report 的 `assumptions` 更名为 `assumptions-body`；claims-spec 的权利要求与说明书正文落在 `claims-body`/`specification-body`，`权利要求书`/`说明书` 标题留在模板里。

## 迁移

1. 把每次调用的 `sections` 参数换成 `draft`。各模板的 `SKILL.md`（位于 `assets/templates/patent/<模板>/`）给出槽位清单；草案校验报错会列出未知槽位与缺失的必填槽位。上一版用旧槽位 id（如 patentability-opinion 的 `basis`、`inventiveness`）拼出的草案会以「未知槽位」报错并按上述新名替换。草案还须携带编号：claims-spec 用必填的 `meta.caseNumber`，八个文档模板用必填的 `doc-number` 正文槽（抬头编号行）与必填的 `footer-case` 文本槽（页脚编号）；patentability-opinion 原可选槽位 `footer-docno` 更名为 `footer-case` 并改为必填。
2. 重新渲染一份有代表性的文书并与旧产物对比：标题、编号与表题现在由结构生成，旧 `sections` 载荷里自带这些内容的部分不再匹配。
3. 确认：传 `sections` 而不传 `draft` 时报 `missing required property "draft"`；传合法 `draft` 时照旧写出 HTML/PDF。
