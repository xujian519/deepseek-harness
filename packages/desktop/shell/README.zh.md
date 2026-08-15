# @deepseek-ai/dsh-desktop-shell

[English](README.md) | 中文

[`ctx.desktop`](../desktop/README.md) 能力缝隙的 **Electron 主进程桥接提供方**。`DesktopShell` 是一个 Cordis Service Provider，从环境变量读取 `DSH_DESKTOP_BRIDGE_PATH`，通过 [`BridgeClient`](./src/bridge-client.ts) 经本地 socket 连接到 Electron 主进程，并注册 `ctx.desktop`。如果缺少桥接路径，插件会加载但 `ctx.desktop` 不可用，所有方法都会以 `DesktopError('bridge-disconnected')` 拒绝；这样同一个包可以在无 Electron 的测试中启动。

## Model Experience

无，因为本包仅将 `ctx.desktop` 调用桥接到 Electron Main，不注册提示文本、工具模式或模型结果。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延后工作

- **主进程桩实现** — Electron Main 中的桥接服务端目前把 `showOpenDialog` 和 `showSaveDialog` 接到 Electron 的 `dialog` API。通知、菜单、全局快捷键和文件拖放仍为桩实现，需在 Main 中补齐；托盘以 Main 进程静态图标形式存在，可编程的 `setTray` 桥接契约仍为桩实现。
- **无自动重连** — socket 关闭时会发出 `desktop/bridge-lost`，但提供方不会重连；生命周期恢复由 Electron 主进程负责。
- **单一后端连接** — 桥接服务端只接受一个并发后端 socket，额外连接会被拒绝。
