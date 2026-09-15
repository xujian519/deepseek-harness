# Agent Note：桌面壳通过菜单 role 承接平台编辑面

Status: implemented

[English](2026-09-15-desktop-shell-edit-menu-role.md) | 中文

## Problem

Electron 壳在 [`apps/desktop/src/main.ts`](../../../../apps/desktop/src/main.ts) 里安装的应用菜单模板只有一项，携带插件、检查更新、退出三个入口。Electron 不会自行接通平台编辑加速键：在 macOS 上，Cmd+C、Cmd+V、Cmd+X、Cmd+A、Cmd+Z 只能通过 `role: 'editMenu'` 注册的 NSMenu 条目分发到 focused webContents，因此桌面壳在原生表单控件之外彻底失去了复制粘贴。Windows 和 Linux 通过 Chromium 内部绑定为可编辑控件保留了加速键路径，但在只读选区上失效——而聊天记录和代码块正是本产品的主面。

同一个壳没有 `webContents.on('context-menu', ...)` 监听，所以在任何平台上右键都没有反应。`setWindowOpenHandler(() => ({ action: 'deny' }))` 加上对所有非 `dsh-app:` URL 都调用 `preventDefault()` 的 `will-navigate`，一起把每一次外链点击静默丢弃，也没有 `shell.openExternal` 兜底。

第四个缺口在 bridge 上：[`BridgeServer.registerGlobalShortcut`](../../../../apps/desktop/src/bridge-server.ts) 会把后端插件请求的任何 accelerator 直接转发到 `globalShortcut.register`，而后者是系统级抢占。一个注册 `Cmd+C` 的插件会在整个桌面上窃取复制快捷键，直到壳将其卸载。

既有测试没有覆盖上述任何一点。[`apps/desktop/tests/bridge-server.spec.ts`](../../../../apps/desktop/tests/bridge-server.spec.ts) 只断言菜单首项的 label 和 rebuild 计数，[`main-startup.spec.ts`](../../../../apps/desktop/tests/main-startup.spec.ts) 从未 emit `context-menu`，也从未调用捕获到的 `setWindowOpenHandler` 回调。

## Decision

- **基础应用菜单携带平台编辑、视图、窗口三个 role。** `main.ts` 中的 `appMenuTemplate` 在 shell 自有应用菜单之后追加 `{ role: 'editMenu' }`、`{ role: 'viewMenu' }`、`{ role: 'windowMenu' }`。`BridgeServer.setAppMenuBase` 收到的是同一份模板，所以后端注册的菜单组是与 role 并列而不是替代。此处不适用 locale-owned 文案：role 条目的本地化标签由 Electron 自己提供。
- **每个 `BrowserWindow` 依据指针状态自行绘制右键菜单。** `createWindow` 挂上 `context-menu` 监听：可编辑目标构建 `{ role: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll' }`，非空选区构建 `{ role: 'copy' | 'selectAll' }`，其余情况不构建任何菜单。空菜单会显示为一个空白矩形；监听保持沉默，让平台把这次右键当作未处理。
- **渲染进程发起的外链导航交给系统浏览器。** 模块内的 `openExternalIfHttp` 只接受 `http:` 和 `https:` 并调用 `shell.openExternal`。`setWindowOpenHandler` 和 `will-navigate` 都经由它兜底，所以 `target=_blank`、`window.open`、`<a href="https://...">` 都能到达用户默认浏览器。其他协议仍然拒绝：壳从不打开第二个 `BrowserWindow`，`dsh-recovery:` 在 `will-navigate` 中保留专用处理。
- **Bridge 拒绝承接平台编辑面的 accelerator。** `bridge-server.ts` 中的 `RESERVED_ACCELERATOR_PATTERN` 匹配 `CmdOrCtrl | Cmd | Command | Ctrl | Control`，可选跟随 `Shift | Alt | Option`，最后是 `C V X A Z` 之一。`registerGlobalShortcut` 在触及 `globalShortcut.register` 之前抛错，拒绝发生在任何 OS 侧抢占形成之前，没有需要回滚的状态。其他编辑键——方向键、Home/End、Delete、功能键——保持可用，因为 shell 菜单并不系统级占用它们。

## Alternatives considered

- **引入 `electron-context-menu` 依赖承接指针路径。** 拒绝：该依赖会扩大桌面壳的运行时面，而所需行为已由四个 role 条目完整覆盖。[依赖策略](../process/2026-07-26-dependencies-over-hand-rolling.zh.md) 只在维护型依赖真正删除自有代码和测试时优先采纳；此处自有代码是一个模块内 helper 加一个 `context-menu` 监听，自有测试是几个 `it` 块——依赖引入的面比它删除的还多。
- **在渲染进程拦截 `keydown` 直接调 `navigator.clipboard`。** 拒绝：这绕开了原生菜单路径，macOS 用户看不到菜单项高亮、看不到 label 旁的加速键提示、也拿不到系统级本地化；而且重复实现了 Chromium 已经通过 role 暴露的能力。
- **拒绝所有与菜单 role 冲突的 accelerator。** 拒绝：菜单 role 保留了几十个 accelerator（F5、F11、Cmd+M、Cmd+W 等等），过宽的拒绝会破坏插件对窗口和视图控制的合法绑定。拒绝收窄到两个家族：主修饰键为 Cmd/Ctrl/Super/Meta 的五个字母绑定（C/V/X/A/Z），以及任意修饰键组合下的 Windows 传统编辑键（Insert/Delete）。`Shift+C` 保持可用，因为它只是大写 C，不是剪贴板操作。
- **在同一批改动中承接文件拖放。** 延后：`desktop/file-dropped` 仍无 Main 侧发射方，[desktop-seam README](../../../../packages/desktop/desktop-seam/README.zh.md) 已经显式记录。接通拖放需要一个渲染进程侧的 drop 通道，会扩大沙箱 preload 面，属于独立改动。

## Consequences

macOS 上桌面菜单栏现在显示 Application、Edit、View、Window 四项，Windows 和 Linux 显示等价的顶级菜单。平台为这些 role 保留的每一个加速键都能作用在 focused webContents 上，包括此前毫无剪贴板路径的聊天记录和代码块。右键在可编辑字段上弹出标准编辑菜单，在选区上弹出只含复制的菜单。外链点击进入系统浏览器，不再消失。

后端插件如果此前通过 `ctx.desktop.registerGlobalShortcut` 注册了字母编辑绑定（`Cmd+C`、`Cmd+V`、`Cmd+X`、`Cmd+A`、`Cmd+Z` 或其上任意修饰键组合）或 Windows 传统编辑键（`Ctrl+Insert`、`Shift+Insert`、`Shift+Delete`），现在会收到一个 rejected promise，携带 `accelerator ${value} is reserved for system editing`。仓库内目前没有插件注册这些 accelerator；这是一条前瞻性的守卫。

## Testing

[`apps/desktop/tests/main-startup.spec.ts`](../../../../apps/desktop/tests/main-startup.spec.ts) 新增六条用例：安装的应用菜单包含 `editMenu`、`viewMenu`、`windowMenu`；`setWindowOpenHandler` 拒绝开窗并把 `https:` 转交给 `shell.openExternal`，同时把 `dsh-app:` 留在壳内；外链 `will-navigate` 同时 `preventDefault` 并转交系统浏览器；非空选区上的 `context-menu` 事件构建只含复制的菜单并调用 `popup({ window })`；`isEditable: true` 时构建完整编辑菜单；空选区叠加非可编辑目标不构建任何菜单。测试 harness 直接捕获 `Menu.buildFromTemplate` 的返回、`Menu.setApplicationMenu` 的模板、`shell.openExternal` 的调用以及 `setWindowOpenHandler` 的回调，测试直接读取而不再从 mock 计数反推。

[`apps/desktop/tests/bridge-server.spec.ts`](../../../../apps/desktop/tests/bridge-server.spec.ts) 新增两条参数化用例。第一条覆盖十四个保留 accelerator——`Cmd+C`、`Cmd+V`、`Cmd+X`、`Cmd+A`、`Cmd+Z`、`CmdOrCtrl+Shift+Z`、`Ctrl+V`、`Control+Alt+C`、`Cmd+Shift+Alt+C`、`Super+V`、`Meta+X`、`Ctrl+Insert`、`Shift+Insert`、`Shift+Delete`——同时断言 JSON-RPC 错误和 `globalShortcut.register` 从未被调用。第二条覆盖六个可接受 accelerator——`Shift+C`、`Alt+F4`、`Cmd+K`、`Ctrl+P`、`F5`、`Insert`——断言注册成功，防止正则过度拒绝。

## Related

[Client UI copy is locale-owned](2026-08-23-locale-owned-client-ui-copy.zh.md) 解释了 role 条目为何绕过桌面 `messages` 字典：本地化标签由 Electron 而不是壳提供。[desktop-seam README](../../../../packages/desktop/desktop-seam/README.zh.md) 记录了本次未触及的、仍然延后的 `desktop/file-dropped` 发射方。
