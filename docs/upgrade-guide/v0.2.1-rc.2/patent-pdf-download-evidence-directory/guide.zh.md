---
kind: upgrade-guide
description: "patent_pdf_download 在 record=true 时把留证截图写入 <outputDir>/evidence/。"
---

# 留证截图移入 evidence 目录

[English](guide.md) | 中文

## 变更

`patent_pdf_download` 在 `record: true` 时过去把每张截图写到 `<outputDir>/evidence-<patent>.png`，并把该路径放进 `recorded` / `evidence`。现在截图位于 `<outputDir>/evidence/evidence-<patent>.png`，`recorded` 为 `<outputDir>/evidence`。单独目录可避免输出目录兼作交付目录时截图与 PDF 混在一起。

## 迁移

1. 直接读取工具结果里返回的路径，不要按专利号自行拼接。
2. 若有下游步骤引用了旧的扁平路径，改指 `<outputDir>/evidence/evidence-<patent>.png`。
3. 确认：`record: true` 的调用返回 `recorded: "<outputDir>/evidence"`，且每条 evidence 路径都存在于该目录下。
