# Agent Note: 将个人工作台入口提升到侧边栏顶部条带

Status: implemented

[English](2026-09-04-promote-personal-workbench-entry.md) | 中文

## Problem

外部插件 `@dely0/dsh-personal-workbench` 把它的侧边栏入口（`button[data-dsh-personal-workbench-entry]`）注入到条带中段，夹在顶部操作与工作区列表之间。当该插件与定时任务、新会话等入口并存时，工作台入口看起来像一处突兀插入，而不像一个同级操作；且侧边栏的定时任务入口占据了本应放工作台操作的槽位。

## Decision

better-sidebar 客户端外壳（`packages/client/better-sidebar/src/client/Sidebar.tsx`）在每次挂载时提升该入口：隐藏定时任务按钮，把工作台入口移到「新建会话」紧后一格的槽位，并复制新会话按钮的类与图标尺寸（14×14），使其读起来像一个同级操作。由于插件在挂载后才注入该入口、且外壳的子树会在启动/HMR 时被替换，一个监听 `#root` 的 `MutationObserver` 会重复应用该位置。

锚点是新会话按钮，以其 CSS-module 类后缀（`[class*="_newSession"]`）匹配。展开态侧边栏有**两个**元素带 `aria-label="新建会话"`（品牌快捷键与真正的按钮），所以仅凭 aria-label 匹配有歧义；类后缀在不写死构建期哈希的前提下完成区分。`document.querySelector` 只返回已连接的节点，因此匹配到的锚点必然在 DOM 中。

## Alternatives considered

- **用 `aria-label="新建会话"` 作锚点** — 有歧义：品牌快捷键带同样标签且按文档顺序排在前面，效果会把入口移到 logo 之上，而非新会话按钮之后。
- **写死当前 CSS-module 哈希（`hT2-rG_newSession`）** — 哈希随构建变化，选择器会在下次重建时失效。
- **在 personal-workbench 插件本身应用该位置** — 插件拥有入口来源，但入口注入位置及其与定时任务入口的并存属于外壳已持有的侧边栏布局问题。

## Consequences

无论哪些插件向条带注入操作，better-sidebar 客户端现在都能一致地编排工作台入口。定时任务入口是隐藏而非重排（其原槽位被复用）。由于该效果运行于 better-sidebar 客户端 bundle，浏览器 `dsh web` 组合与桌面组合（挂载第一方 `@deepseek-ai/dsh-better-sidebar`）都会带上它；桌面需要重建该第一方包，使其客户端 bundle 携带此改动。
