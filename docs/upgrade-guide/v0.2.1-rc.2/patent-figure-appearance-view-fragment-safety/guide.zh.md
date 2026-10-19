---
kind: upgrade-guide
description: "外观设计视图片段若包含脚本、事件处理属性、javascript: URL、嵌入 HTML、动画、style 或 ENTITY/CDATA，现在会在落版前被拒绝，不再写进交付 SVG。"
---

# 外观设计视图片段只承载几何内容

[English](guide.md) | 中文

## 变更

外观设计图片排版过去把模型给的每个视图片段原样嵌入交付 SVG。渲染后的复核（`assertSafeSvg`）会拒绝 ENTITY/CDATA，但不拒绝 `<script>`、事件处理属性或 `javascript:` URL，因此片段可能把可执行内容带进交付件；出现实体声明时，工具仍会交付 SVG，只记一条跳过复核的警告。现在 `generate_patent_figure` 在渲染前就以 `invalid_tool_input` 拒绝这类片段，不写任何文件。被拒绝的内容：`script`、`style`、`foreignObject`、`iframe`、`object`、`embed`、`animate`、`set`、`on*=` 属性、`javascript:` URL 与 ENTITY/CDATA。检查前会先解码数字字符引用，因此 `&#x6a;avascript:` 也会被识别。`<style>` 一并拒绝，因为 CSS 可以加载外部资源；表现样式请写在属性里。

## 迁移

1. 从 `appearance_views[].body` 与 `extras[].body` 中移除可执行内容，保留几何元素与表现属性。
2. 重新调用；被拒绝的片段会点名视图与命中的结构。
3. 确认：视图 body 含 `<script>` 时报「可执行元素」，且不会写出 `fig1.svg`。
