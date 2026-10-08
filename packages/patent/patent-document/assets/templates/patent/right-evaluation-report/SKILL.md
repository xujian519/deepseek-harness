---
name: patent-right-evaluation-report
description: |
  实用新型/外观设计专利权评价报告模板（表格式，复刻国家知识产权局表格 220701 版式）。
  把收到的正式评价报告转成结构化可引用件，或为诉讼、客户决策出具预测/模拟件。
triggers:
  - "专利权评价报告"
  - "评价报告"
  - "right evaluation report"
template:
  kind: patent-document
  mode: report
  scenario: patent-right-evaluation
  preview:
    type: html
    entry: assets/template.html
  exports: [html, pdf]
---

# 实用新型/外观设计专利权评价报告模板

将实用新型或外观设计专利权的评价结论渲染为**表格式评价报告**，复刻国家知识产权局《表格 220701（2011.4 版）》版式。

## 文书性质（必读）

专利权评价报告是**行政机关（国家知识产权局）出具的文书**，代理机构不能出具，也无权以自己名义签发。本模板只有两种正当用途：

1. **转制**：把收到的正式评价报告转成结构化、可引用、可检索的电子件；保留原报告的著录项与结论，不改动实质内容。
2. **预测/模拟**：为诉讼策略或客户决策制作的预测件或模拟件，用于预判评价结论。

抬头区留空。用作用途 1 时保留原报告著录项；用作用途 2 时**必须在抬头区显著标注「模拟件 · 非行政机关出具」**，不得使第三方误认为该件由国家知识产权局出具。

## 输入要求

渲染前必须已具备（缺任一项先补齐）：

1. 著录项：专利号、申请日、优先权日、授权公告日、名称、专利权人、请求人、请求日。
2. 评价所针对的文本与检索针对的权利要求范围。
3. A–E 分区内容：主题分类、检索领域、数据库与检索式、相关文件清单、评价结论与评价意见。
4. 每条相关文件的类型、文献号、公开日、分类号、相关部分、相关权利要求编号。
5. 审查员、审核员、完成日期（仅转载原报告时填写）。

## 工作流

1. 读 `references/conventions.md`、`references/checklist.md` 与 `references/citation-log.md`。
2. 复制 `assets/template.html` 为输出文件。
3. 填充：著录项 → 评价所针对的文本 → 检索针对的权利要求 → A/B/C/D/E 分区 → 初步结论 → 专利权评价意见 → 落款。
4. D 表按相关文件条数复制数据行；评价意见超出第 3 页时复制续页 II 整块与页眉，内容不足一页时删除该页。
5. 删除模板占位，按 `references/checklist.md` 自查后定稿。

## 输出契约

```
文件：right-evaluation-report.html（单文件、内联 CSS）
可选：right-evaluation-report.pdf（A4 打印）
```

本模板复刻官方表格版式，刻意使用黑白表格线，**不套用 `assets/templates/patent/tokens.css` 品牌色**；agent 不改样式。
