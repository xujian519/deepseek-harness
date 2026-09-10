# Agent Note: 将个人工作台入口提升到侧边栏顶部条带

Status: implemented

[English](2026-09-04-promote-personal-workbench-entry.md) | 中文

## Problem

外部插件 `@dely0/dsh-personal-workbench` 把它的侧边栏入口（`button[data-dsh-personal-workbench-entry]`）注入到条带中段，夹在顶部操作与工作区列表之间。当该插件与定时任务、新会话等入口并存时，工作台入口看起来像一处突兀插入，而不像一个同级操作；且侧边栏的定时任务入口占据了本应放工作台操作的槽位。插件还在自己注入的样式表里把该入口画成普通导航行。

## Decision

实际挂载的侧边栏外壳（`packages/client/ui-sidebar/src/client/SidebarRoot.tsx`）提升该入口：隐藏定时任务触发器，把工作台入口移到「新建会话」紧后一格的槽位，并赋予它该按钮的类、标签类与图标尺寸（展开态 14、轨道态 18），使其读起来像一个同级操作。由于插件在挂载后才注入该入口、且外壳的子树会在启动/HMR 时被替换，一个监听 `#root` 的 `MutationObserver` 会重复应用该位置。

提升逻辑放在渲染该条带、且每个组合都会挂载的外壳里。插件自己的样式表在 bundle 之后落入 `<head>`，因此入口的表面样式来自同时命中新会话类与该入口属性的外壳规则（`SidebarRoot.module.css`）：同权重的规则会输掉后者，而入口自身的 `:hover` 与 `[data-active]` 规则与该规则同权重，仍按源顺序生效。

锚点是外壳自己的新会话按钮，按外壳渲染的 module 类匹配（展开态侧边栏有两个 `session.new.label` 按钮——品牌快捷键与真正的按钮——仅凭标签有歧义）。定时任务触发器按其自身类（`button.dshc-trigger`）匹配，而不用其 `aria-label`，因为那个标签由插件本地化。

## Alternatives considered

- **用 `aria-label="新建会话"` 作锚点** — 有歧义：品牌快捷键带同样标签且按文档顺序排在前面，效果会把入口移到 logo 之上，而非新会话按钮之后。
- **写死当前 CSS-module 哈希（`hT2-rG_newSession`）** — 哈希随构建变化，选择器会在下次重建时失效；导入 module 自身的类名可在构建期解析锚点。
- **在 personal-workbench 插件本身应用该位置** — 插件拥有入口来源，但入口注入位置及其与定时任务触发器的并存属于外壳已持有的侧边栏布局问题。
- **把提升逻辑留在 better-sidebar 客户端** — 该外壳已不再被任何随仓库发布的组合挂载（见[桌面不再挂载工作台侧边栏](2026-09-10-desktop-without-workspace-sidebar.zh.md)），效果从未运行，桌面端显示的是插件原样的入口。
- **在效果里用内联样式设定表面** — 内联样式同时会挡住插件自身的 `:hover` 与 `[data-active]` 反馈，而类加属性的规则会保留它们。

## Consequences

凡挂载侧边栏外壳处（含桌面端），工作台入口都渲染为「新会话」的同级操作。定时任务触发器是隐藏而非重排（其原槽位被复用），因此被隐藏的那个会话里，定时任务面板失去了该入口。提升现在属于外壳职责：不挂载侧边栏外壳（也就没有条带）的组合没有可提升的对象。
