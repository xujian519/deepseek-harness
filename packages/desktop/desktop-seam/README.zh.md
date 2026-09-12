---
description: "`ctx.desktop` 能力缝隙的 **Service Definition**：通过 Electron 主进程向 dsh 后端暴露 OS 级桌面集成能力。它声明了有类型的方法（`showOpenDialog`、`showSaveDialog`、`sendNotification`、`registerMenuItem`、`registerGlobalShortcut`、`setTray`）和 Cordis 事件（`desktop/menu-activated`、`desktop/shortcut-triggered`、`desktop/tray-clicked`、`desktop/file-dropped`、`desktop/notification-clicked`、`desktop/bridge-lost`）。注册方法为异步，bridge 无法放置条目时（快捷键已被占用、托盘不可用）会 reject。[`@deepseek-ai/dsh-desktop-shell`](../shell/README.zh.md) 等提供方实现该缝隙；消费方（`@deepseek-ai/dsh-desktop-directory-picker`、工具、命令）使用 `ctx.desktop` 而不依赖 Electron。"
kind: "package-reference"
---

# @deepseek-ai/dsh-desktop-seam

[English](README.md) | 中文

## 概述

`ctx.desktop` 能力缝隙的 **Service Definition**：通过 Electron 主进程向 dsh 后端暴露 OS 级桌面集成能力。它声明了有类型的方法（`showOpenDialog`、`showSaveDialog`、`sendNotification`、`registerMenuItem`、`registerGlobalShortcut`、`setTray`）和六个 `desktop/*` Cordis 事件。注册方法为异步，bridge 无法放置条目时（快捷键已被占用、托盘不可用）会 reject。[`@deepseek-ai/dsh-desktop-shell`](../shell/README.zh.md) 等提供方实现该缝隙；消费方（`@deepseek-ai/dsh-desktop-directory-picker`、工具、命令）使用 `ctx.desktop` 而不依赖 Electron。

托盘菜单组下的菜单项进入托盘上下文菜单(可用 `DesktopTrayConfig.menuGroup` 覆盖);跨 bridge 的 id——`MenuId`、`NotificationId`——由同名构造函数打品牌。


## 目录

- [Model Experience](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

## Model Experience

无，因为本包仅定义 `ctx.desktop` 能力缝隙，不注册提示文本、工具模式或模型结果。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **文件拖放延后** — `desktop/file-dropped` 目前没有 Main 侧发射方（窗口级拖放不会到达 Electron Main；Web 界面自行处理应用内拖放）。渲染器拖放通道会扩大沙箱 preload 面，随该工作延后。
- **事件载荷范围** — 载荷故意保持精简；更丰富的 UI 状态（菜单勾选/取消、托盘图标、通知动作）需要后续修订契约。

### 开发备注

无。
