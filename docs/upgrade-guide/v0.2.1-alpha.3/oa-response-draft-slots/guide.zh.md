---
kind: upgrade-guide
description: "oa-response 受控草案的九个 arg-* 字段改为「事实—规则—论证」分节槽位，按旧槽位构造的草案校验失败。"
---

# oa-response 草案改版：事实、规则与论证分节

[English](guide.md) | 中文

## 变更

`render_patent_document` 的 `template: 'oa-response'` 曾把争辩部分承载为九个叶字段：`arg-nov-oa`、`arg-nov-reply`、`arg-nov-evidence`、`arg-nov-conclusion`、`arg-inv-oa`、`arg-inv-reply`、`arg-inv-evidence`、`arg-inv-conclusion`（必填）与 `arg-other`（可选）。

这九个字段移除。草案改以 `sections` 分块槽位承载争辩部分：`facts-application` 与 `facts-prior-art` 承载事实，`rules-body` 承载论证所依据的法条与规则，`argument-novelty` 与 `argument-inventiveness` 按争点承载论证，另有可选的 `argument-other` 与 `formalities-body`。前五项必填；沿用自旧草案的分节槽位保持必填（`doc-number`、`position-points`、`amendment-table`、`amended-claim-1`、`evidence-table`、`citation-table`）。

升级后，按旧槽位构造的 oa-response 草案校验失败：各 `arg-*` 名称被报为未知槽位，缺失的必填分节被逐一列出，不产出文书。渲染产物的标题也按同一顺序重新编号（三、本案事实 至 八、结论与请求），对等文书的新旧渲染做 diff 可见标题与编号变化。

## 迁移

1. 把草案的争辩部分重建为分节：新颖性论证进 `argument-novelty`，创造性论证进 `argument-inventiveness`，两组事实分别进 `facts-application` 与 `facts-prior-art`，所引法条进 `rules-body`，新颖性、创造性之外的理由进 `argument-other`，其他缺陷的处理进 `formalities-body`。模板 `SKILL.md`（`assets/templates/patent/oa-response/`）载有槽位清单与文书的小节顺序。
2. 确认：迁移后的草案照旧渲染出 HTML/PDF 一对文件；仍带 `arg-*` 的草案失败，报错把那些名称列为未知槽位、把新分节列为缺失。
