# Agent Note: 退役 Patent Electron 壳

Status: implemented

[English](2026-09-09-retire-patent-desktop-shell.md) | 中文

## 问题

`apps/desktop-patent`（`@deepseek-ai/dsh-desktop-electron`）是围绕 dsh 后端与 Web UI 打包的旧 Patent 侧 Electron 壳。官方 `apps/desktop` 壳（`@deepseek-ai/dsh-desktop`）已吸收了 Patent 壳承载的每一项功能——品牌、托盘与打印、`ctx.desktop` 桥接接缝、macOS 原生工具，以及无端口 better-sidebar 传输——因此 Patent 壳成了一个重复的应用程序，带有自己的基于端口的传输和自己的 `desktop-patent` CLI profile。保留它意味着要维护两个壳，并把 better-sidebar 桌面功能搁浅在一个本无端口壳内唯一的基于端口的传输上。

## 决定

退役 `apps/desktop-patent`，以及一切仅为构建或启动它而存在的东西。官方桌面组合保持不变：`apps/desktop-host` + 在 `web-app` bundle 之上的 `desktop.cordis.patch.yml` overlay，承载保留的 `desktop` profile。

- 删除 `apps/desktop-patent` 源码树、其打包配置与测试。
- 删除构建/打包/测试它的根脚本（`build:desktop:patent`、`dev:desktop:patent`、`package:desktop:patent:{mac,prepare,win}`、`test:desktop:patent`）；`@deepseek-ai/dsh-desktop` 的脚本保留。
- 删除 `scripts/desktop-package.ts` 与 `scripts/desktop-download-node.ts`（及其 spec）：唯一调用方是 Patent 的 `package:desktop:patent:prepare`，官方壳通过 `apps/desktop/scripts/*`（`package-target.ts`、`prepare-runtime.ts`）组装自己的后端与 Node 运行时。
- 从 `packages/boot/app-boot/src/profile.ts` 移除 `desktop-patent` 随附 profile 模板及其安装持有元组（连同其测试）。CLI 继续拒绝应用持有的 `desktop` profile 名称。
- 删除对该 Patent 应用的 workspace、tsconfig、约束与 vendoring 引用（`pnpm-workspace.yaml`、`tsconfig.host.json`、`scripts/check-workspace-constraints.ts`、`scripts/rescope-vendor.ts`）。
- **保留** `@deepseek-ai/dsh-desktop-app` bundle：壳的移除使其失去消费者，但退役该 bundle 属于另一改动，不属于本次壳的退役。

## 备选方案

**把 Patent 壳保留为瘦 legacy 启动器。** 否决：它重复官方壳并让基于端口的传输继续存活；一旦官方壳拥有桌面表层，就无人再引用它。

**在同一改动里退役 `desktop-app` bundle。** 推迟：该 bundle 是独立包，移除它需触达文档目录与 bundle 花名册；让壳的退役保持聚焦，避免耦合两次移除。

## 后果

仓库现在只发布一个 Electron 壳（`apps/desktop`）。`desktop-patent` CLI profile 不再存在；应用持有的 `desktop` profile 仍保留并由 CLI 管理。基于 `web-app` 的桌面组合承载 better-sidebar、`macos-tools`、`desktop-shell` 与原生目录选择器。`desktop-app` bundle 仍存在但已无使用，等待其自身的退役。
