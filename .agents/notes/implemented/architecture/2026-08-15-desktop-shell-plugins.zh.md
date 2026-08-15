# Agent Note: 桌面端 Shell 插件与 Host 桥接

Status: implemented

[English](2026-08-15-desktop-shell-plugins.md) | 中文

## Problem

桌面应用需要把 OS 级能力（原生对话框、通知、菜单栏、托盘、全局快捷键、文件拖放）暴露给 dsh 后端和现有 Web UI，同时不能破坏桌面部署方案中约定的安全模型：

- Electron 渲染进程不能直接访问 Node.js 或 Electron API。
- dsh 后端不能依赖 Electron；同一后端也运行在 headless 和浏览器部署中。
- 原生行为应像文件系统或 shell 提供方一样通过 Cordis 插件组合，而不是硬编码在 Electron 主进程中。

这需要为桌面集成建立专门的能力缝隙，以及 dsh 后端进程与 Electron 主进程之间的私有桥接。

## Decision

### 高层形状

```
Electron Main  (owns OS APIs: dialog, Tray, Menu, globalShortcut, Notification)
     │
     │ JSON-RPC over local socket / named pipe
     │
@deepseek-ai/dsh-desktop-shell/   (Service Provider: ctx.desktop)
     │
     │ Cordis service
     │
dsh backend plugins / UI   (Consumers: ctx.desktop, ctx.directoryPicker, tools, commands)
```

渲染进程只参与那些需要 UI 表面的事件：主进程把 OS 事件（文件拖放、快捷键、托盘点击）推给后端；后端再通过现有 HTTP/WebSocket API 把相关状态转发给渲染进程。

### 新增包

| 包 | 角色 | ctx key |
| --- | --- | --- |
| `packages/desktop/desktop` | 桌面集成的 Service Definition | `ctx.desktop` |
| `@deepseek-ai/dsh-desktop-shell` | 桥接到 Electron Main 的 Service Provider | registers `ctx.desktop` |
| `@deepseek-ai/dsh-desktop-directory-picker` | 由 Electron 对话框支持的 `ctx.directoryPicker` 提供方 | registers `ctx.directoryPicker` |

`packages/bundle/desktop-app` Cordis 包挂载 `dsh-web-app` 加上上面三个包以及未来的桌面插件。

### 桥接传输

在 macOS 上使用 Unix domain socket，在 Windows 上使用 named pipe。路径通过环境变量 `DSH_DESKTOP_BRIDGE_PATH` 传给 dsh 后端。

- Electron Main 在启动 dsh 子进程之前创建服务端。
- `@deepseek-ai/dsh-desktop-shell` 在构造时读取 `DSH_DESKTOP_BRIDGE_PATH` 并连接。
- 协议采用 JSON-RPC 2.0，一个双向通道：
  - 后端 → 主进程：方法调用（`desktop/showOpenDialog`、`desktop/showSaveDialog`、`desktop/sendNotification`、`desktop/registerMenuItem`、`desktop/unregisterMenuItem`、`desktop/registerGlobalShortcut`、`desktop/unregisterGlobalShortcut`、`desktop/setTray`、`desktop/clearTray`）。
  - 主进程 → 后端：通知（`desktop/menu-activated`、`desktop/shortcut-triggered`、`desktop/tray-clicked`、`desktop/file-dropped`、`desktop/notification-clicked`）。
- 只有一个后端连接；socket 位于应用用户数据目录，文件系统权限仅允许当前用户。

如果缺少 `DSH_DESKTOP_BRIDGE_PATH`，`@deepseek-ai/dsh-desktop-shell` 会记录警告并不注册 `ctx.desktop`。这样同一个包可以在无 Electron 的测试中启动，但桌面 profile 始终会设置该变量。

### `ctx.desktop` Service Definition

```ts ignore-check
export interface DesktopService {
  /** Show a native open-file / open-directory dialog. */
  showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogResult>
  /** Show a native save-file dialog. */
  showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogResult>
  /** Show a system notification. */
  sendNotification(notification: DesktopNotification): void
  /** Register a menu item under a named group. Returns a disposer. */
  registerMenuItem(group: string, item: DesktopMenuItem): Disposer
  /** Register a global shortcut. Returns a disposer. */
  registerGlobalShortcut(accelerator: string, handler: () => void): Disposer
  /** Configure the tray icon and its context menu. Returns a disposer. */
  setTray(config: TrayConfig): Disposer
}
```

事件采用有类型的 Cordis 事件：

| 事件 | 方向 | 载荷 |
| --- | --- | --- |
| `desktop/menu-activated` | Main → 后端 | `{ menuId: string }` |
| `desktop/shortcut-triggered` | Main → 后端 | `{ accelerator: string }` |
| `desktop/tray-clicked` | Main → 后端 | `{ button: 'left' \| 'right' }` |
| `desktop/file-dropped` | Main → 后端 | `{ paths: string[] }` |
| `desktop/notification-clicked` | Main → 后端 | `{ notificationId: string }` |

后端插件通过 `ctx.on('desktop/...', ...)` 注册处理器。

### `ctx.directoryPicker` Electron 提供方

`@deepseek-ai/dsh-desktop-directory-picker` 以新的能力 kind 实现现有 `DirectoryPicker` 缝隙：

```ts ignore-check
{ kind: 'electron', pick(signal): Promise<string | null> }
```

它委托给 `ctx.desktop.showOpenDialog({ properties: ['openDirectory'] })`，返回第一个选中的路径或取消时返回 `null`。浏览器 half 复用 `packages/client/ui-directory-picker-native`，因为用户交互形状相同：都是代表操作者打开原生 OS 选择器。

因此桌面 bundle 会在桌面 profile 中用 `dsh-desktop-directory-picker` 替换 `dsh-host-directory-picker-native`，而浏览器和 headless profile 保留原有提供方。

### Electron Main 职责

Electron Main 进程保持轻量宿主：

- 启动时创建桥接服务端。
- 带 `DSH_DESKTOP_BRIDGE_PATH` 启动 dsh 后端。
- 通过调用 Electron API 实现桥接方法处理器：
  - `dialog.showOpenDialog` / `dialog.showSaveDialog`
  - `Notification`
  - `Menu.setApplicationMenu` / `Menu.buildFromTemplate`
  - `Tray`
  - `globalShortcut`
- 通过同一 socket 把 OS 事件转发给后端。
- 不在 Main 中保留产品状态。菜单标签、快捷键和托盘动作由后端插件通过 `ctx.desktop` 动态注册。

### 渲染进程参与

渲染进程不为桌面能力直接与 Main 通信，除非事件起源于 OS 窗口层（例如 HTML5 拖放）。对于这些情况，preload 脚本暴露 `desktop:fileDrop`；渲染进程通过现有 `ctx.attachments` 或 workspace API 把路径转发给后端。

渲染进程不承载桌面业务逻辑。菜单点击和全局快捷键走 Main → 后端 → 渲染，通过常规会话事件流，保留**模型可见事实必须被记录**的规则。

### Bundle 组合

`packages/bundle/desktop-app/cordis.patch.yml` 叠加在 `dsh-base` 和 `dsh-web-app` 之上：

- 把 `directory-picker-native` 行替换为 `desktop-directory-picker`。
- 在 web runtime 之后插入 `desktop-shell`。
- 保留 `dsh-web-app` 的 `surfaceContext` 和 `printUrl` 行为；`dsh web:` URL 就绪行仍是打包应用的就绪信号，直到 shell 桥接管。

### 生命周期与错误处理

- 桥接断开时，`@deepseek-ai/dsh-desktop-shell` 发出 `desktop/bridge-lost` 并清除所有动态注册。Main 在后端退出时会重启它。
- 桥接断开期间调用对话框，提供方以 `DesktopError('bridge-disconnected')` 拒绝。消费方将其视为暂时失败。
- Main 对每一个传入的 JSON-RPC 方法名做白名单校验；未知方法返回 JSON-RPC 错误。

## Alternatives considered

**在 Electron Main 中硬编码菜单和快捷键，并通过 HTTP 调用 dsh。** 这对第一版更简单，但会使桌面能力无法被 Cordis 插件扩展，并把产品逻辑塞进外壳。由于项目架构以插件优先，已拒绝。

**使用 stdio IPC 代替 socket。** Stdio 避免了网络路径，但 dsh 后端已经向 stdout 打印日志；把结构化 IPC 和日志混在一起很脆弱。专用 socket 保持关注点分离，也不需要改动 dsh CLI 入口。已拒绝。

**在 dsh API gateway 上增加私有 HTTP 端点。** 渲染进程已经在用 HTTP，但把桌面操作暴露到同一表面会模糊信任边界，还需要鉴权以防止其他本地进程触发对话框。私有 socket 通过文件系统权限更容易保证安全。已拒绝。

**在渲染进程中用 Electron remote 或不安全的 preload API 实现 OS 对话框。** 这会破坏安全模型（`contextIsolation`、`sandbox`），并允许渲染进程被破坏后驱动原生对话框。已拒绝。

## Consequences

已交付 Phase 3 骨架：

- `packages/desktop/desktop` 定义 `ctx.desktop` Service Definition，包含方法（`showOpenDialog`、`showSaveDialog`、`sendNotification`、`registerMenuItem`、`registerGlobalShortcut`、`setTray`）和事件（`desktop/menu-activated`、`desktop/shortcut-triggered`、`desktop/tray-clicked`、`desktop/file-dropped`、`desktop/notification-clicked`、`desktop/bridge-lost`）。
- `packages/desktop/shell` 提供 `DesktopShell` Service Provider，读取 `DSH_DESKTOP_BRIDGE_PATH`，通过 `BridgeClient` 连接到 Electron Main，并注册 `ctx.desktop`。
- `packages/desktop/directory-picker` 提供 `ElectronDirectoryPicker`，为 `ctx.directoryPicker` 新增 `electron` kind，委托给 `ctx.desktop.showOpenDialog`。
- `apps/desktop/src/bridge-server.ts` 在 Electron Main 中运行 JSON-RPC 2.0 服务端，接入 `main.ts`，并在启动后端时传入 `DSH_DESKTOP_BRIDGE_PATH`。
- `packages/bundle/desktop-app/cordis.patch.yml` 在 web runtime 之上挂载新插件。
- 单元测试覆盖 Service Definition、bridge client、shell provider 和 directory-picker provider。
- Host 聚合 typecheck、oxlint 和 `build:lib:host` 均通过。

已知剩余工作：通知、菜单、全局快捷键、托盘、文件拖放的实际 Electron API 集成，以及 Windows named pipe 验证。

已交付行为：

- `packages/desktop/desktop` 定义 `ctx.desktop` 并带有类型的方法和事件。
- `@deepseek-ai/dsh-desktop-shell` 通过本地 socket 连接到 Electron Main 并注册 `ctx.desktop`。
- `@deepseek-ai/dsh-desktop-directory-picker` 为 `ctx.directoryPicker` 提供 `electron` kind。
- 桌面 bundle 能替换 `directory-picker-native` 并挂载 `desktop-shell`，无需改动核心包。
- Main 已实现打开/保存对话框；通知、菜单、全局快捷键、托盘和文件拖放当前为桩实现。
- 桥接断开可被处理并通过 `desktop/bridge-lost` 被观测到。

剩余风险：

- **Socket 可移植性。** Windows named pipe 与 Unix domain socket 行为略有不同；桥接客户端必须使用 Node.js `net.createConnection` 并采用正确的路径格式。
- **进程顺序。** Main 必须在启动 dsh 之前创建服务端，后端插件必须能在环境中找到路径。启动期间的竞态需要显式日志。
- **渲染进程桥接面。** 虽然很小，但如果 Main 被欺骗，文件拖放 IPC 通道可能接收任意路径。Main 必须在发送路径前按文件系统访问策略校验拖放路径。
- **无窗口父级的原生对话框。** 在没有 `BrowserWindow` 父级的情况下显示对话框可能在某些平台被其他窗口遮挡；应尽可能传入主窗口句柄。
