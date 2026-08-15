# @deepseek-ai/dsh-desktop

[English](README.md) | 中文

`ctx.desktop` 能力缝隙的 **Service Definition**：通过 Electron 主进程向 dsh 后端暴露 OS 级桌面集成能力。它声明了有类型的方法（`showOpenDialog`、`showSaveDialog`、`sendNotification`、`registerMenuItem`、`registerGlobalShortcut`、`setTray`）和 Cordis 事件（`desktop/menu-activated`、`desktop/shortcut-triggered`、`desktop/tray-clicked`、`desktop/file-dropped`、`desktop/notification-clicked`、`desktop/bridge-lost`）。[`@deepseek-ai/dsh-desktop-shell`](../shell/README.md) 等提供方实现该缝隙；消费方（`@deepseek-ai/dsh-desktop-directory-picker`、工具、命令）使用 `ctx.desktop` 而不依赖 Electron。

## Model Experience

无，因为本包仅定义 `ctx.desktop` 能力缝隙，不注册提示文本、工具模式或模型结果。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延后工作

- **仅为骨架** — Service Definition 只规定了契约；实际的 Electron API 集成位于提供方包和 Electron Main 中。
- **事件载荷范围** — 载荷故意保持精简；更丰富的 UI 状态（菜单勾选/取消、托盘图标、通知动作）需要后续修订契约。
