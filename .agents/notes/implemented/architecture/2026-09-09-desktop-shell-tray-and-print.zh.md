# Agent Note: 桌面壳托盘、打印 PDF 与 preload chunk 限制

Status: implemented

[English](2026-09-09-desktop-shell-tray-and-print.md) | 中文

## 问题

桌面壳此前没有托盘与打印，而收敛后的壳必须承载两者。打印能力还有既定的客户端契约：Web UI 探测 `window.desktop.printHtmlToPdf`，缺失时降级，因此壳必须以这个确切名称暴露桥。此外，给 preload 增加一个共享导入会静默弄坏所有 preload 桥，在更多 preload 代码落地之前需要一条结构性规则。

## 决策

壳拥有由仓库 `assets/` 图标构建的系统托盘：macOS 使用模板图，上下文菜单承载 locale 字典的显示与退出条目，且在托盘存在且未开始退出时，关闭最后一个窗口只会隐藏应用。打印是隐藏窗口的 HTML 转 PDF 助手；在打印窗口运行前，主进程校验封闭通道（HTML 非空、4 MiB 上限、字符串建议文件名），桥以 `window.desktop` 暴露——即客户端 `DesktopPrintBridge` 契约已探测的名称；`dshDesktop` 协议标记保留用于载体检查。

Electron 沙箱 preload 无法 require 共享 chunk：tsdown 会在多入口间拆分共享模块，preload 内一个 `require("./ipc-*.cjs")` 失败后 Electron 会静默跳过整个 preload。因此每个 preload 从单主文件导入自己的 channel（主渲染器用 `channels-app.ts`，插件窗口用 `channels-shell.ts`），rollup 会把它们内联进各自入口；`ipc.ts` 聚合两个文件，主进程以同名注册 handler。channel 测试把聚合表锁定到这两个来源。

## 已否决的替代方案

**以 `window.dshDesktop.printHtmlToPdf` 暴露打印桥。** 客户端 UI 需要第二个特性探测名；既有 `window.desktop` 契约是渲染器已探测的唯一表面。

**在打包器中关闭 chunk 拆分。** tsdown 0.22 没有 JS 拆分开关，且 rollup 总是提取多入口共享的模块；单主 channel 文件从根源避免共享模块。

## 后果

关闭最后一个窗口后应用留在托盘，托盘显示条目可恢复；菜单与 tooltip 文案跟随打包的产品名。完整的保存对话框环节需要人工点击，由助手自身的单元测试覆盖，而 IPC 校验路径（非法负载、空 HTML、尺寸上限）已在开发壳中端到端演练。
