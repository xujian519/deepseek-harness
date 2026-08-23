---
name: document-html
description: |
  单页 HTML 工件管线：落地页/原型/仪表盘/海报等单文件成品。优先复用
  OpenDesign 渲染模板（web-prototype / saas-landing / dashboard 等），否则用
  内置基线模板。输出自包含的 index.html。
whenToUse: 需要交付 HTML 单页工件（网页原型、落地页、KPI 仪表盘、海报、报告页）。
---

# HTML 单页工件管线

产出一个**自包含**的单文件 `index.html`：内联样式与资源、不依赖外部 CDN、
单一强调色、语义化结构。

## 模板选择

1. **OpenDesign 模板优先**：若技能目录中有 `web-prototype` / `saas-landing` /
   `dashboard` / `mobile-app` 等 OD 模板（`OPEN_DESIGN_DIR` 已配置时自动挂载），
   按需求场景选择并读取其 `assets/template.html` 作为种子；按模板技能的工作流
   填充。
2. **内置基线**（无 OD 模板时）：System UI 字体栈 + 中性色板 + 单一强调色 +
   960px 内容列 + 语义化 `<header>/<main>/<section>/<footer>`。响应式断点 920px。

## 流程

1. 读 brief（无则先跑 document-brief）。
2. 选定模板与设计系统；把 DESIGN.md（若有）的 token 映射到 `:root` 变量。
3. 撰写内容：真实文案，不用"Lorem ipsum"；图片用占位类或用户提供的资源。
4. 渲染为 `index.html`；自检（见 document-quality-gate P0/P1）。
5. 交付：给出文件路径 + 一句摘要（不含全文 HTML）。

## 硬性规则

- 单文件：所有 CSS 内联于 `<style>`，必要时内联少量 JS；不引用外部 CDN。
- 一个强调色，每屏最多用两处（eyebrow + 主 CTA 是默认预算）。
- 每个 `<section>` 带 `data-doc-id`，便于评审精确定位。
- 移动端可读性：默认 920px 媒体查询重排，不写死固定宽度。
