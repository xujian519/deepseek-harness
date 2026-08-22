---
name: document-word
description: |
  Word 交付管线：借助 officecli 技能生成/校对 .docx（md 转 docx、样式套用、
  结构校对）。officecli 不可用时回退为 Markdown 交付并说明。
whenToUse: 用户明确要求 .docx/Word 文件（合同、规范、报告、论文等）。
---

# Word 交付管线

需要 `.docx` 成品时，通过 officecli 技能生成与校对；officecli 是用户级技能，
不在本 preset 内，缺失时明确回退。

## 流程

1. 读 brief；无则先跑 document-brief。确认 Word 特殊要求：页眉页脚、封面、
   目录字段、页码、样式名。
2. 撰写源内容（Markdown 优先，便于 officecli 转换与复查）。
3. 调用 officecli 技能：转换 md → docx，套用命名样式（标题层级/正文/表格），
   按要求加封面、页眉页脚与页码。
4. 校对：用 officecli 的 analyze/proofread 检查结构（标题层级、表格、引用），
   人工可读的错别字与格式问题一并修正。
5. 自检（document-quality-gate）后交付：`<name>.docx` 路径与摘要。
6. 无 officecli 时：交付 `report.md` 并说明"Word 转换需要 officecli 技能"。

## 硬性规则

- 文档结构以 Markdown 源为唯一事实来源，docx 由转换生成，不同步手改。
- 事实性断言（数据、条款、版本）必须带来源；合同/法律文件加免责说明。
- 不伪造二进制产物：officecli 不可用时绝不手工拼 .docx 字节。
