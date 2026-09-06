# Agent Note: Packaged desktop app ships ABI-mismatched native addons

Status: implemented

[English](2026-09-06-desktop-native-addon-abi-from-host-node.md) | 中文

## Problem

打包后的桌面应用在报告 URL 之前就退出：后端加载 `fs-ext` 原生插件时失败，报 `ERR_DLOPEN_FAILED`，这是 Node ABI（`NODE_MODULE_VERSION`）不匹配导致的。`scripts/desktop-package.ts` 通过 `pnpm deploy --prod` 把 `apps/cli` 部署到后端资源树，而 `pnpm deploy` 复用了 pnpm store 中的缓存构建，该构建已按打包宿主机 Node 编译。桌面 shell 刻意携带并运行一个独立的嵌入式 Node 二进制（从而不依赖 Electron 内置 Node），而该嵌入式 Node 的 major 版本高于打包宿主，因此在宿主机上编译的 node-gyp 源码构建插件携带宿主 ABI，在嵌入式运行时下无法加载。

这里只有 node-gyp 插件是 ABI 相关的。`node-pty`、`sharp`、`koffi` 和 `node-addon-require-builtin` 属于 N-API 或预构建，可跨 Node ABI 加载；`fs-ext` 是树中唯一的源码构建插件。

## Decision

在 `scripts/desktop-package.ts` 中，下载嵌入式 Node 二进制后，针对它重新编译每个源码构建的原生插件：

- `sourceBuiltNativeAddonModules(backendDir)` 查找同时持有 `binding.gyp` 与 `build/Release/*.node` 的包目录，仅遍历已部署 `node_modules` 下的 pnpm store。
- `rebuildNativeAddonsWithNode(backendDir, nodeBin)` 在每个这类包中执行 `node <embedded> <node-gyp-cli> rebuild`，非零状态即抛出；`resolveNodeGypCli()` 定位仓库 pnpm store 中已安装的最高版本 node-gyp。
- `prepareDesktopResources` 仅在 `platform === currentDesktopPlatform()` 时调用重建。源码编译是宿主相关的，因此跨平台下载 Node（例如在 macOS 上 `--platform win-x64`）仅用于链接验证，不可分发。

`sourceBuiltNativeAddonModules` 同时支撑 `scripts/desktop-package.spec.ts` 的单元测试，这些测试锁定只会识别 node-gyp 源码构建，而 N-API 预构建与纯依赖包会被忽略。

## Alternatives considered

**为 `fs-ext` 提供 ESM 友好的纯 JS 替代。** 消除了 ABI 问题，但用一次重写替换一个可用插件，对启动修复而言超出范围。

**在 CI 宿主上构建打包插件并依赖单一 Node 版本。** 缩小但未消除漂移：打包宿主与嵌入式 Node 是独立固定的，而打包时重建能让两者无论选择哪个版本都保持一致。

**在源码处按嵌入式 Node 编译插件并跳过重建步骤。** 把不匹配提前，但为未来任何嵌入/重建漂移留下同类失败；在 `prepareDesktopResources` 中重建把该不变量放在可能破坏它的部署旁边。

## Consequences

- 打包应用首次启动即可运行：源码构建插件现在与嵌入式 Node ABI 匹配，而非打包宿主。
- 重建仅在打包的目标 OS 上、且仅当树中存在源码构建插件时运行，因此不受影响的树不会多做这份工作。
- 打包宿主必须能编译原生插件（macOS 上需 Xcode CLT，Windows 上需 Build Tools）；失败会以响亮的构建错误暴露，而非悄悄打进错误的 bundle。
