---
name: document-deck
description: |
  演示文稿管线：章节大纲 → HTML Deck（横向滑动、杂志版式）→ 交付 deck.html，
  并按需生成 .pptx（officecli 可用时）或给出导出说明。
whenToUse: 需要交付演示文稿（路演 Deck、周报、培训课件、方案汇报）。
---

# 演示文稿（Deck）管线

交付 `deck.html`：横向滑动的单文件 Deck（每张为一节，键盘/滚轮翻页），
杂志版式节奏；需要 .pptx 时用 officecli 转换。

## 流程

1. 读 brief；无则先跑 document-brief。
2. 大纲：封面 → 问题/背景 → 方案/证据 → 计划 → 行动项；每节一句话要点；
   用 ask_user 确认篇幅与节奏（默认 8–12 页）。
3. 撰写内容：每页一个主张（header + 3–5 行要点 + 可视元素占位）；
   数据页带来源标注。
4. 渲染 `deck.html`：
   - 每节 `<section class="slide">`，`data-doc-id` 标注；
   - 杂志版式基线：大标题衬线、正文无衬线、数字等宽；
   - 键盘 `→`/`←` 翻页 + 触控/滚轮节流；
   - 演讲者备注：每页 `<aside class="notes">`（打印/导出时隐藏）。
5. 自检（document-quality-gate）后交付：`deck.html` 路径与摘要。
6. PPTX：officecli 可用时生成 `deck.pptx` 并校对；否则说明导出途径。

## 硬性规则

- 单文件自包含，不依赖外部字体/CDN。
- 每页主主张不超一句；要点不用完整段落。
- 数字与事实必须带来源；无来源的数据不进 Deck。
