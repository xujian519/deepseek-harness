# Agent Note：桌面审查修复

状态：implemented

[English](2026-08-16-desktop-review-fixes.md) | 中文

## 问题

对 Phase 3 桌面外壳（桥接、Service Definition、托盘、应用改名）的代码审查暴露了契约与生命周期缺陷：导航白名单使用前缀匹配、桥接启动无兜底、abort 契约未实现、directory-picker README 中过时的 fail-loud 声明、正常销毁时误发 `desktop/bridge-lost`，以及传输错误泄漏到 `DesktopError` 词表之外。

## 决策

- **导航**：改为精确比较 URL origin 而不是前缀（`apps/desktop/src/navigation.ts` 中的 `isWithinBackendOrigin`）；像 `127.0.0.1.evil.com` 这样的伪装主机不会进入白名单。
- **启动**：将 `bridge.start` 包进 try/catch，失败时报告并退出，而不是留下空白窗口和一个未处理的 rejection。
- **abort 契约**：`ctx.desktop.showOpenDialog` / `showSaveDialog` 接受可选的 `AbortSignal`；`BridgeClient.call` 以 `AbortError` 拒绝挂起的调用并丢弃之后的服务器响应。Electron 没有提供可编程的对话框关闭接口，因此 JSDoc 和 directory-picker 能力文档如实说明：abort 会拒绝调用，但对话框会保持打开直到用户操作。
- **目录选择器**：声明 `static inject = ['desktop']`，使缺少桌面能力时加载失败（Cordis 让插件保持 PENDING），而不是在首次 pick 时抛延迟的 `TypeError`；README 已修正。
- **销毁**：`BridgeClient` 在显式 `dispose` 后抑制 `onClose`，因此正常关闭不再发出 `desktop/bridge-lost`。
- **错误映射**：桥接以 `BridgeRpcError` 报告服务器错误；shell provider 将其映射为 `DesktopError('dialog-failed')`，socket 失败映射为 `DesktopError('bridge-disconnected')`，保持封闭词表。
- **命名与卫生**：`shortcutDisposers` 改名为 `shortcutHandlers`；空 catch 注明吞掉的内容；被拒绝的第二个桥接连接挂上 error 监听。

## 备选方案

**新增支持取消往返的对话框方法。** 桥接取消请求仍然无法关闭已经打开的原生对话框，因为 Electron 没有提供可编程关闭接口，因此 signal 会拒绝调用方的等待并丢弃结果，而不是假装终止选择器。已采纳。

**按消息字符串映射传输错误。** 当 Electron 或 Node 改写失败信息时，匹配 `Error.message` 文本很脆弱；专用的 `BridgeRpcError` 类让 provider 映射保持稳定。已采纳。

**保留前缀导航检查。** `http://127.0.0.1.evil.com` 与后端 origin 共享前缀，会加载进窗口；精确的 `URL.origin` 比较消除了这个缺口。已采纳。

## 结果

- 新增测试覆盖导航策略、桥接启动失败、abort 在 `BridgeClient` / shell / directory-picker 中的传播、服务器错误映射、意外 socket 关闭与安静销毁。
- 2026-08-15 的 note 中与已发布行为矛盾之处已修正（缺失路径时的桥接注册、不自动重启后端、静态托盘）。
- 桌面单元测试：56 个通过。

## 剩余风险

- abort 无法关闭已经显示的对话框；调用方在 signal 中止时，应把对话框结果视为丢弃而非取消。
