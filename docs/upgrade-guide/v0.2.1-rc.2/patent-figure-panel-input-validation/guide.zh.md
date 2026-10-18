---
kind: upgrade-guide
description: "generate_patent_figure 现在拒绝重复的面板后缀，以及 panels 同时提供的顶层结构/矢量输入，不再覆盖同一文件或静默丢弃输入。"
---

# 面板输入在渲染前校验

[English](guide.md) | 中文

## 变更

有两类面板模式输入过去会被接受，随后被错误处理。两个面板使用相同 `suffix` 时会写同一个 `figN<suffix>` 文件，结果里两个面板指向同一路径，后写的覆盖先写的。与 `panels` 同时提供的顶层结构/矢量输入（`steps`、`blocks`、`dot`、`circuit`、`plot`、`sections`、`sequence`、`appearance_views` 等）会被解析和校验，然后因为面板模式只渲染面板字段而被静默忽略。现在这两种情况都报 `invalid_tool_input`：后缀必须互不重复（按大小写不敏感比较，因为 `fig1A.svg` 与 `fig1a.svg` 在不区分大小写的文件系统上是同一个文件），与 `panels` 同时出现的顶层图形输入会在错误里点名。

## 迁移

1. 为每个面板指定不同后缀，重新调用。
2. 把共享的结构输入移入需要它的每个面板，或直接删除；`panels` 只渲染面板字段。
3. 确认：两个面板都写 `suffix: "A"` 时报「面板后缀重复」；`{ panels: [...], circuit: {...} }` 报「顶层结构输入」。
