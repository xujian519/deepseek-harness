# Agent Note：桌面 Electron 托盘与应用包重命名

Status: implemented

[English](2026-08-16-desktop-electron-tray-and-app-rename.md) | 中文

## Problem

桌面壳发布时没有品牌资产和系统托盘，而且其应用工作区与新 Service Definition 共用 `@deepseek-ai/dsh-desktop` 包名，导致 pnpm `--filter` 命中两个工作区，桌面打包脚本失败。

## Decision

### Assets

从 `steven-kid/deepseek-harness-desktop`（MIT）采纳图标集到 `apps/desktop/assets/`。electron-builder.yml 接入 macOS、Windows、Linux 应用图标。托盘 PNG 打包进 `app.asar`。

### System tray

在 Electron Main 增加系统托盘：

- macOS 使用 `trayTemplate.png` 作为模板图标；其他平台使用 `tray.png`。
- 托盘存在时关闭最后一个窗口会隐藏窗口；从托盘菜单退出会设置退出标志并退出。
- 托盘菜单提供 Show 和 Quit。
- 平台决策（图标文件、模板标志、关闭时隐藏）放在 `src/tray.ts`，无需 Electron 主机即可单元测试。

### App package rename

将 Electron 应用工作区从 `@deepseek-ai/dsh-desktop` 改名为 `@deepseek-ai/dsh-desktop-electron`。Service Definition 保留 `@deepseek-ai/dsh-desktop`；bundle 保留 `@deepseek-ai/dsh-desktop-app`。

## Alternatives considered

**改为重命名 Service Definition。** 拒绝：Service Definition 是目录和消费者引用的规范 seam 名称。

**把应用改名为 `@deepseek-ai/dsh-desktop-app`。** 拒绝：该名称已被桌面 bundle 占用。

**跳过托盘只使用应用图标。** 拒绝：用户要求完整托盘行为。

## Consequences

- `apps/desktop/assets/` 包含九个采纳的资产文件。
- electron-builder.yml 接入应用图标并打包托盘 PNG。
- Electron Main 创建托盘，并在窗口关闭后保持应用存活。
- 应用工作区为 `@deepseek-ai/dsh-desktop-electron`；根脚本、工作区约束和应用文档在同一次变更中更新。
- `src/tray.ts` 及其测试覆盖平台决策。

## Remaining risks

- 托盘无法在无头沙箱中启动；行为通过单元测试和打包 `app.asar` 检查验证，而非实时 GUI 会话。
- `nativeImage.createFromPath` 从 `app.asar` 内读取托盘图标；真实 GUI 启动应确认托盘正常渲染。
