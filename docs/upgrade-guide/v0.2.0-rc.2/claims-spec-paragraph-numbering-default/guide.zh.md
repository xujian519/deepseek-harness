---
kind: upgrade-guide
description: "随包的 claims-spec 模板不再声明段落编号，render_patent_document 的渲染结果因此不再带 [0001] 编号，除非模板自行声明 data-paragraph-numbering。"
---

# claims-spec 模板默认渲染不带段落编号

[English](guide.md) | 中文

## 变更

`assets/templates/patent/claims-spec` 的说明书节不再带 `data-paragraph-numbering`。因此用 `render_patent_document` 以 `template: 'claims-spec'` 渲染出的文书不再含 `[0001]`、`[0002]`……编号：渲染引擎只对模板声明过编号的节逐段写入编号。这一变化改变交付件本身，把新渲染的「权利要求书与说明书」与本次变更前渲染的同一文书对比，会看到编号消失。

模板注释记录了原因：《专利法》《专利法实施细则》与《专利审查指南》均未要求段落编号，是否使用取决于提交体例。`paragraphNumbering.ts` 引擎与 `data-paragraph-numbering` 声明本身未变，改变的是随包默认值。

## 迁移

1. 提交体例使用段落编号的部署，把声明加回需要编号的节：

   ```html
   <section id="specification" aria-label="说明书" data-paragraph-numbering="[0001]">
   ```

   改本部署自己的模板根下的 `claims-spec` 副本，不要改随包资产。不要手写编号：引擎每次渲染都会先剥后写。
2. 提交体例不使用段落编号的部署无需改动；重新渲染即可让新交付件不再带编号。
3. 确认：渲染一次 `claims-spec`，在 HTML 中搜 `<p>[0`——未加声明时应无命中，加了声明时每段一条。
