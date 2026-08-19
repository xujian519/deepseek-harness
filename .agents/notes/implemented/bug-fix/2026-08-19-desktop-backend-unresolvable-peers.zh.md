# Agent Note: 打包后端缺失 peer 提供的运行时导入

Status: implemented

[English](2026-08-19-desktop-backend-unresolvable-peers.md) | 中文

## Problem

安装的桌面端启动即失败，报 `dsh backend exited before reporting a URL (code 1, signal null)`：后端子进程在启动过程中退出，未打印外壳等待的就绪行 `dsh web:`。直接运行打包后端可见底层错误：先是 `dsh-app-boot` 报 `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/cordis-plugin-group'`，修复后又从 `dsh-llm`（`@deepseek-ai/dsh-timeout`）等暴露同类失败。

工作区能正常启动，是因为 pnpm 会把可解析的 peer 链接进各工作区包自己的 `node_modules`。打包后端由 `pnpm deploy --prod` 部署 `@deepseek-ai/dsh`（`scripts/desktop-package.ts`）得到，只物化 cli 的 dependencies 闭包。harness 各包把共享的接缝/定义包（能力 Service Definition、`dsh-scope`、`dsh-timeout`、vendored cordis 插件等）声明为 `peerDependencies`，因此任何 cli 未同时声明为 dependencies 的 peer 都会从部署树中消失，第一个静态导入它的模块在加载时即崩溃。

## Decision

1. `apps/cli` 现在把其 profile 图运行时导入的 peer 全部声明为 `dependencies`：`@deepseek-ai/cordis-plugin-group`（`dsh-app-boot` 已声明为 peer 的四个 cordis 插件中缺失的那个）以及 19 个共享接缝/定义包（`dsh-anonymous-user-id`、`dsh-atomic-write`、`dsh-bash-local`、`dsh-code-runtime`、`dsh-compaction`、`dsh-fs`、`dsh-output-retention`、`dsh-patent-core`、`dsh-patent-data`、`dsh-sandbox`、`dsh-scope`、`dsh-session-telemetry`、`dsh-session-title-llm`、`dsh-shell`、`dsh-spill`、`dsh-subagent-in-process-driver`、`dsh-subprocess`、`dsh-timeout`、`dsh-workflow`）。cli 是部署根，也是所有 profile 启动的聚合点，在此提供共享 peer 与 cordis 插件既有的处理方式一致。

2. `scripts/desktop-package.ts` 现在会校验部署树能解析自身代码导入的每个 `@deepseek-ai/*` 说明符。`findUnresolvableBackendImports` 扫描部署后的 `lib/` 与每个 `@deepseek-ai` store 包的静态导入，再用 cwd 指向部署树的 `--eval` 子进程解析（见 Alternatives），`prepareDesktopResources` 失败即大声报错，列出缺失说明符及其导入文件。`REQUIRED_BACKEND_PATHS` 也补上了五个 vendored cordis 插件路径。

## Alternatives considered

- **把共享包声明为导入方（如 `dsh-llm` → `dsh-timeout`）的 `dependencies`** —— 符合包管理惯例，但 peer 模式是跨数十个包、刻意为之的能力接缝单例契约，改动会触及每个接缝消费方。作为更大爆炸半径而被否决。
- **恢复被删的 `.pnpm/node_modules` store 镜像** —— 删除是刻意的（electron-builder 会把整个 store 压缩两遍）。否决。
- **在打包脚本里用 `import.meta.resolve(specifier, parent)` 解析** —— Node ≤ v22.22 忽略显式 `parent` 参数，只从调用模块解析，导致首个门禁实现检查的是仓库根 `node_modules` 而非部署树，并对 `@deepseek-ai/nuo-patent`（树中存在、根中不存在）误报。cwd 指向部署树的 `--eval` 子进程从树自身的 `node_modules` 链解析，与启动时的解析链一致。

## Consequences

打包后的桌面后端能启动并打印 `dsh web: http://127.0.0.1:PORT`，外壳恢复加载 UI；发布到 npm 的 `@deepseek-ai/dsh` 包中完全相同的潜在缺口也由同样的依赖声明修复。今后再有 peer 被丢弃，会在 `package:desktop:*` 的 prepare 阶段带着说明符和导入文件直接失败，而不是作为不透明的启动退出码到达用户。门禁给 prepare 增加约两秒。它检查 `@deepseek-ai/*` 导入；外部包（如 `schemastery`、`cordis`）的导入经由 pnpm 常规依赖闭包解析，不在扫描范围，且 bundle 行引用扫描集之外的插件时，必须在同一改动中把该包路径加进 `REQUIRED_BACKEND_PATHS`（常量注释即为维护契约）。
