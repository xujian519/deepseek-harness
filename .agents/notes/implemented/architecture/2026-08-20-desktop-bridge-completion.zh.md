# Agent Note：完成 ctx.desktop 桥接

Status: implemented

[English](2026-08-20-desktop-bridge-completion.md) | 中文

## 问题

`ctx.desktop` 能力缝隙声明了完整契约（对话框、通知、菜单、全局快捷键、托盘、六个事件），但 Electron Main 只实现了对话框，shell provider 在桥接丢失后从不重连。对外宣称的能力与行为不一致。

## 决策

**Main 侧**（`apps/desktop/src/bridge-server.ts`）：通知现经 Electron 的 `Notification` API 发布，点击以 `desktop/notification-clicked` 回传；菜单模型把注册组映射为应用菜单、把托盘的配置组（默认 `'tray'`）映射为托盘上下文菜单；全局快捷键经 Electron 注册，冲突以 JSON-RPC 错误浮现；`setTray`/`clearTray` 重建托盘 tooltip 与菜单；托盘点击推送 `desktop/tray-clicked`。`main.ts` 把托盘创建委托给 bridge。

**契约**（`packages/desktop/desktop`）：`registerMenuItem`、`registerGlobalShortcut` 与 `setTray` 改为异步，使放置失败（快捷键被占用、托盘缺失）能浮现给调用方；`DesktopNotification` 携带可选 `id`，点击时回传；`DesktopTrayConfig` 携带可选 `menuGroup`。

**韧性**（`packages/desktop/shell`）：`BridgeClient` 在意外关闭后有界指数退避重连，shell 重放其活动的菜单/快捷键/托盘注册。首次连接失败仍上报桥接丢失；重连尝试不上报。

**`desktop/file-dropped` 保持延后**：窗口级拖放不会到达 Electron Main，Web 界面已自行处理应用内拖放，渲染器通道会扩大沙箱 preload 面。

## 影响

桌面壳宣称的桌面能力与行为一致；Main 重启不再让后端的注册悬空；快捷键与托盘失败可观察而非静默。

## 备选方案

- 注册方法保持 fire-and-forget 以保留同步 disposer：否决——快捷键冲突与托盘缺失是调用方必须看到的真实失败。
- 经 preload 通道实现 `desktop/file-dropped`：否决——会扩大沙箱渲染器面，而该用例 Web 界面已覆盖。
