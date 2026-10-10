---
kind: upgrade-guide
description: "dsh-doc-template 不再随包分发五个 patent-report 模板，点名它们的 render_doc_template 调用会失败；这些文书改由专利域的 render_patent_document 从受控草稿成文。"
---

# patent-report 模板离开 `dsh-doc-template`

[English](guide.md) | 中文

## 变更

`@deepseek-ai/dsh-doc-template` 曾在 `assets/templates/patent/` 下随包分发五个变量替换资产，名字是 `claims-spec`、`invalidation-opinion`、`patentability-opinion`、`search-report` 与 `oa-response-sati`。每一个都与专利域已从受控草稿成文的同名文书重复；而随包的 patent preset 只挂载 `@deepseek-ai/dsh-patent-document`，因此本仓库里没有任何 preset 通路能到达它们。

这五个资产已删除。随包语料现在是四个类别（`specification`、`claims`、`oa-response`、`disclosure`）共十二个模板，`list_doc_templates` 不再返回这五个名字，`TEMPLATE_CATEGORY_ORDER` 也不再列出 `patent-report` 类别。渲染过其中任一名字、或按「十七个模板」读取目录的部署，会在升级后看到这一变化。

## 迁移

1. 改走专利域成文：调用 `render_patent_document`，传模板 id（`claims-spec`、`patentability-opinion`、`search-report`、`search-report-form`、`oa-response`、`invalidation-opinion` 等共 11 个随 `@deepseek-ai/dsh-patent-document` 分发）与受控草稿，而不是变量表。
2. 部署自备的模板若放在自己配置的 `templateDirs` 根下则不受影响。仍要通过 `render_doc_template` 渲染就保留它们，改成由专利域渲染后再删除。
3. 确认迁移：`list_doc_templates` 报告十二个模板、且没有以这五个已删资产命名的条目；`render_patent_document` 调用写出文书文件。
