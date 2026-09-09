# Agent Note: 退役 desktop-app bundle

Status: implemented

[English](2026-09-09-retire-desktop-app-bundle.md) | 中文

## 问题

`packages/bundle/desktop-app`（`@deepseek-ai/dsh-desktop-app`）是桌面表层 bundle：它在 `dsh-web-app` 之上叠加 `cordis.patch.yml`，插入 `desktop-runtime` 胶水插件、`desktop-shell` 服务、Electron 目录选择器对（`dsh-desktop-directory-picker` + `dsh-client-ui-directory-picker-native`）、`macos-tools` 与 `better-sidebar`。桌面 profile（`dsh --profile desktop`）过去会叠加 `dsh-base`、`dsh-web-app` 与该 bundle。

官方 `apps/desktop` 壳不再使用它。其桌面组合现在由私有的 `@deepseek-ai/dsh-desktop-host` 进程拥有：`apps/desktop/src/project-manager.ts` 定义 `DESKTOP_PROFILE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']`（不含 `desktop-app`），`apps/desktop-host/config/desktop.cordis.patch.yml` 是插入 shell、picker、macos-tools 与 sidebar 行的 overlay。任何活跃 profile 或 `cordis.yml` 都没有在 `dsh.profile.bundles` 列表中命名 `@deepseek-ai/dsh-desktop-app`。Patent 壳退役（见退役说明）移除了它最后的消费者，使该 bundle 成为孤儿。

## 决定

退役 `packages/bundle/desktop-app`，以及一切仅为它而存在的引用。桌面组合不变：`dsh-desktop-host` overlay 仍是唯一的组合路径。

- 删除该包的源码树（插件、patch、README 双语、测试、tsconfig）。
- 从 `apps/cli/package.json` 移除 `@deepseek-ai/dsh-desktop-app` 依赖。CLI 从不 import 它；它只是转递桌面插件，而 `apps/desktop-host` 现在直接依赖这些插件。
- 删除该包的 tsconfig 路径映射与项目引用（`tsconfig.base.host.json`、`tsconfig.base.json`、`tsconfig.host.json`）。
- `packages/bundle/im/cordis.patch.yml` 注释不再把 `desktop-app` 列为前置层。
- 移除 `verify-package-readme-model-experience.ts` 中该包的条目。
- 重新生成生成的目录（`docs/module-graph.*`、`docs/config-catalog.*`）与 lockfile；命名过该 bundle 的文档描述现在改为描述 `dsh-desktop-host` overlay。

## 备选方案

**把 bundle 保留为无操作 legacy 表层。** 否决：没有任何东西启动它，保留死 bundle 会误导读者以为在 `dsh-desktop-host` 之外还存在桌面组合路径。

**把这一步并入 Patent 壳退役。** 当时推迟；它是独立包，移除需触达文档目录与 bundle 花名册，所以自成一次改动。

## 后果

仓库现在只发布一条桌面组合路径：Electron 应用通过私有的 `dsh-desktop-host` overlay 把桌面表层叠加在 `dsh-web-app` 之上。`desktop-app` bundle 不再存在；没有任何引用。
