---
description: "`ctx.directoryPicker` 缝隙的 **Electron 后端提供方**。它暴露新的 `electron` 能力 kind，并将目录选择委托给 `ctx.desktop.showOpenDialog({ properties: ['openDirectory'] })`。这样桌面 shell 可以复用现有的 directory-picker 契约，同时通过 Electron Main 打开 OS 原生选择器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-desktop-directory-picker

[English](README.md) | 中文

## 概述

`ctx.directoryPicker` 缝隙的 **Electron 后端提供方**。它暴露新的 `electron` 能力 kind，并将目录选择委托给 `ctx.desktop.showOpenDialog({ properties: ['openDirectory'] })`。这样桌面 shell 可以复用现有的 directory-picker 契约，同时通过 Electron Main 打开 OS 原生选择器。

本包故意不提供浏览器 half：桌面 shell 通过自己的渲染进程显示 Web UI，且同一后端代码在两种上下文中运行。只有桌面 profile 挂载此提供方；浏览器和 headless profile 保留原有的 directory-picker 实现。

不发布运行时不变式伴生；provider 不持有状态——它把每次选取委托给 ctx.desktop.showOpenDialog，并在调用边界把响应转换为目录选择器的 string | null 约定。


## 目录

- [Model Experience](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

## Model Experience

无，因为本包仅代表 GUI 主机打开原生目录选择器，不注册提示文本、工具模式或模型结果。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **依赖 `ctx.desktop`** — 如果未挂载 `ctx.desktop` 实现，提供方会在加载时抛出；因此桌面 bundle 必须先挂载 `@deepseek-ai/dsh-desktop-shell`。
- **单目录选择** — `electron` 能力只返回一个路径（第一个选中的目录），取消时返回 `null`。`DirectoryPicker` 契约不暴露多选能力。

### 开发备注

无。
