# Agent Note：第一方收编 better-sidebar

Status: implemented

[English](2026-08-28-adopt-better-sidebar-first-party.md) | 中文

## Problem

web GUI 的类 VSCode 工作区侧边栏——explorer、editor、按会话终端、git、side chat、subagent 预览、browser——此前只以外部 MIT npm 插件 `dsh-better-sidebar`（omdsh-dev，0.17.1）的形式经 profile 层消费。这一安排满足不了三项桌面要求：

- 打包的桌面发行版必须在离线状态下把每个已挂载插件装进部署的后端树。profile 层插件在部署时需要对 profile 执行 `pnpm install`，打包的桌面应用做不到。
- 上游依赖范围逐发行漂移（node-pty、可选的 `@huanlin` better-locale peer），针对上游锁定的打包树可能独立于本仓库而损坏。
- 本仓库无法对自己不携带的代码拥有修复、约定或测试。

## Decision

该插件以第一方身份收编为 `packages/client/better-sidebar` 的 `@deepseek-ai/dsh-better-sidebar`，落在 source plane：所有 peer 都从 workspace 解析，逐发行的 npm peer 范围漂移就此终结，且上游的 MIT LICENSE 文件保留。

桌面组合默认挂载它：`dsh-desktop-app` bundle patch（`packages/bundle/desktop-app/cordis.patch.yml`）插入 `better-sidebar` 行；浏览器 `dsh web` 组合不挂载任何东西，任何部署都可用自己 profile patch 中的一行 `- id: better-sidebar, disabled: true` 退出，该行在 desktop-app 层之后生效。

打包的桌面部署树在同一次变更中携带本包：`@deepseek-ai/dsh-better-sidebar` 是 `apps/cli` 的 production 依赖，且 `scripts/desktop-package.ts` 的 `REQUIRED_BACKEND_PATHS` 要求 `node_modules/@deepseek-ai/dsh-better-sidebar/package.json`，因此不完整的部署树会让打包检查失败，而不是带着缺口启动。

node-pty 锁定在 workspace 固定的 `1.2.0-beta.15`——与 `@deepseek-ai/dsh-subprocess-local` 声明的范围完全一致——因此 pnpm 为两个消费方解析同一个物理原生绑定，插件自己的契约测试会对照 `dsh-subprocess-local` 的 `package.json` 校验声明。

数据平面标识有意保留历史名称：设置命名空间 `dsh-better-sidebar` 与 side chat 上下文注入标记 `dsh-better-sidebar` 持久存在于跨 profile 共享的用户设置与会话日志中，因此即便包名完成了 rescope，它们也没有跟着改。

## Alternatives considered

- **继续经 profile 层消费上游 npm 插件。** 落败：逐发行的 peer 范围漂移、本仓库不运营的分发渠道，以及打包桌面发行版没有离线路径。
- **数据平面标识随包名一起 rescope。** 落败：命名空间与标记位于跨 profile 共享的持久用户设置与会话日志中；改名会让既有设置分区失联，并错标历史的 side chat 注入。
- **把上游 AGPL-3.0 的 office 预览扩展一并收编。** 落败：与第一方代码树许可不兼容；它保持外部且不挂载，只能作为单独安装的外部插件使用。
- **携带上游的 19 本第三方语言词典与可选的 `@huanlin` better-locale peer。** 落败：本仓库的客户端 UI 文案约定是 zh/en 双语；更多语言仍是外部工作。
- **移植上游 artifact-plane 的 chunk 产物规格与 Playwright e2e 通道。** 落败：source-plane 规则——它描述的 artifact plane 属于上游的打包器；此处由客户端 bundle 流水线与插件自己的 `/sidebar/bundle` 路由负责 chunk 投递，行为测试负责验证。

## Consequences

持久的后果在部署侧：桌面发行版离线携带侧边栏，既不需要 profile `pnpm install`，也不依赖上游 npm 状态。侧边栏成为任何 profile 都能用一行 patch 禁用的桌面默认项；浏览器 `dsh web` 组合除非自行插入该行，否则保持没有侧边栏。

上游专属渠道按构造消失：分发只经组合行发生；被放弃的面——plugin-registry 渠道（`dsh.plugin.json` + `client-registry.js` bundle）、第三方语言词典与 AGPL office 扩展——只能作为有意的第一方或外部工作回来，而不是随上游漂移回来。
