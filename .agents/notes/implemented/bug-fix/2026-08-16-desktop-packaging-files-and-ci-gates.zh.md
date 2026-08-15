# Agent Note：桌面打包 files 与 fork CI 门禁

状态：implemented

[English](2026-08-16-desktop-packaging-files-and-ci-gates.md) | 中文

## 问题

桌面外壳发布后暴露了两个缺陷。第一，打包后的应用启动即崩溃，报 `ERR_MODULE_NOT_FOUND: Cannot find module '.../app.asar/dist/bridge-server.js'`：`electron-builder.yml` 的 `files` 显式列出 `dist` 文件（`main.js`、`server-manager.js`、`preload.cjs`），漏掉了 `main.ts` 静态 import 的 `bridge-server.js`、`navigation.js` 和 `tray.js`。此前该列表已经漏过一次模块（`server-manager.js`，由 `a2f7b7bc8a` 修复），所以显式列表这个模式本身就是缺陷。第二，把 fork CI 从上游 larger-runner 标签切换为标准托管 runner 后，暴露出本 PR 自身代码的五个门禁失败：`scripts/desktop-package.ts` 及 spec 中的 `duplication` 克隆、`verify-cordis-config` 缺少 desktop 包在 `tsconfig.base.json` 中的 paths、过期的 `docs/module-graph.md`、`knip` 报告 `desktop-app` bundle 依赖未使用，以及 vitest 无法解析 desktop-shell 测试中的 `@deepseek-ai/dsh-desktop`。

## 决策

- **以目录而非列表打包 `dist`**：`electron-builder.yml` 的 `files` 现在包含整个 `dist` 输出，排除 `*.map`、`*.d.ts` 和 `dist/types/**`，与 `apps/desktop/package.json` 的 npm `files` 字段对称。以后 `src/` 下新增模块会自动进包。
- **源码面解析**：在 `tsconfig.base.json` 的 `paths` 中新增 `@deepseek-ai/dsh-desktop*` 与 `@deepseek-ai/dsh-desktop-app` 条目，使 tsx 源码启动和 vitest 将这些包解析到 `src` 而不是构建产物 `lib/`。
- **bundle 依赖口径**：`knip.json` 给 `packages/bundle/desktop-app` 加上与 `bundle/web-app`、`bundle/base` 相同的 `ignoreDependencies: ["@deepseek-ai/.+"]`；bundle 依赖经 `cordis.patch.yml` 消费，而 knip 不解析 yml。
- **消除克隆**：从 `desktop-package.spec.ts` 的 POSIX/win32 镜像 setup 块提取 fixture helper（`makeExternalLink`、`makeVendorCycle`、`makeInTreeStoreLink`、`expectPackageJson`），并从 `desktop-package.ts` 的两处 symlink 遍历骨架提取 `resolveLinkTarget`。
- **生成文档**：重新运行 `pnpm run gen-module-graph`，使 `docs/module-graph.md` 包含 desktop 包。
- **双语配对**：`docs/module-graph.md` 是配对文档；中文侧与 `module-graph.i18n.yaml` 的 hash 记录必须同步更新（`verify-translation-pairing`）；固定旧显式 `files` 列表与已退役 `dsh-windows-2025-16core` 自托管标签的打包/CI spec 断言，改为匹配 dist 目录 glob 与托管默认 `windows-2025`（`packaging-files.spec.ts`、`ci-workflow.spec.ts`）。

## 备选方案

**把三个缺失文件加进显式列表。** 能修复崩溃，但保留了会再次出错的模式；第四个模块会再次漏掉。已拒绝。

**用 `jscpd:ignore` 标记包裹重复的测试 setup。** 项目已用该机制处理许可证头，但这里的重复块是可以干净提取成 helper 的 fixture 代码；生产代码的克隆（两处 symlink 遍历骨架）是真实的结构性重复，也应重构而非豁免。已拒绝。

## 结果

- 打包后的应用在 macOS 上正常启动：Electron 主进程、嵌入式 Node backend（`--profile desktop --port 0`）、bridge socket、绑定端口返回 HTTP 200。
- 五个门禁本地全部通过：`duplication` 报 0 克隆，`verify-cordis-config` 129 个文件，`verify-module-graph` 最新，`knip` 干净，desktop-shell/directory-picker 套件（31 个测试）正常解析 `@deepseek-ai/dsh-desktop`。
- fork CI 现在可以运行企业级 lane；与本 PR 无关的快照分歧（pwsh 工具 schema 固定、web e2e 装配）另行跟踪。

## 剩余风险

- 本 fork 上 CI 的 snapshot 与 web-e2e lane 仍因本 PR diff 之外的原因失败（jobs 工具 schema 固定、重复的 `tool-pwsh` loader 条目、stderr 上的 SQLite 实验警告）；它们需要上游刷新 fixture，而不是本 PR 处理。
