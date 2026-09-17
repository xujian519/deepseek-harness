# Agent Note: 桌面打包配置测试固定其假定的目标平台

Status: implemented

[English](2026-09-17-desktop-package-config-import-platform.md) | 中文

## 问题

`apps/desktop/tests/desktop-icon.spec.ts` 导入 `electron-builder.config.mjs`，而后者的默认导出会在模块求值时调用 `createElectronBuilderConfig()`。因此该测试在 `beforeAll` 中先 stub 发布环境再导入，但它只 stub 了 `DSH_DESKTOP_APP_ID` 与 `DSH_DESKTOP_UNSIGNED`。缺少 `DSH_DESKTOP_TARGET_PLATFORM` 时，unsigned 校验转而从构建主机解析平台，于是在 Linux CI 运行器上导入即抛出 `desktop package: unsigned builds support Windows and macOS only`，三个测试都在触及断言前失败。同一文件在 macOS 上通过，因为构建主机本身就是受支持的 unsigned 目标。

## 决策

`beforeAll` 从 `UNSIGNED_MAC_ENVIRONMENT` 一并 stub `DSH_DESKTOP_TARGET_PLATFORM`，即该文件显式调用已在使用的常量，使模块默认导出在任何构建主机上都解析出 macOS 目标。各测试内的调用仍为 Windows 场景覆盖该平台。

## 备选方案

**依赖每次显式调用传入的平台。** 拒绝：默认导出在导入时求值，早于任何测试体，逐调用的参数根本到不了它。

**让 `createElectronBuilderConfig` 在环境未指定目标平台时跳过 unsigned 平台校验。** 拒绝：默认导出服务于真实打包，此时缺少目标平台正是该校验存在所要报告的配置错误。

**不导入配置模块，直接断言图标路径。** 拒绝：断言读取的是解析后的 `mac.icon` 与 `win.icon`，只有该模块会产出它们。

## 后果

该测试现在固定其断言所假定的平台，而不是继承构建主机，因此 macOS 与 Linux 两条通道结果一致。

任何导入打包配置的测试都因同一原因需要完整的 stub 环境：该模块在默认导出处解析发布环境，而 unsigned 模式会拒绝 Windows 与 macOS 之外的一切目标平台。

## 验证

`pnpm exec vitest run apps/desktop/tests/desktop-icon.spec.ts` 的三个测试通过。模拟 Linux 构建主机（`Object.defineProperty(process, 'platform', { value: 'linux' })`）时，未 stub 目标平台可复现原失败，stub 后解析出 `apps/desktop/assets/icon.icns`。
