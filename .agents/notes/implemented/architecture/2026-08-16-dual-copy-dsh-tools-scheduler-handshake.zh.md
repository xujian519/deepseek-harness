# Agent Note：dsh-tools 双副本导致工具调度器握手失效

状态：implemented

[English](2026-08-16-dual-copy-dsh-tools-scheduler-handshake.md) | 中文

## 问题

Web/桌面会话中每次工具调用都以 `Cannot read properties of undefined (reading 'prepare')` 失败，记录为 `code: UNKNOWN` 的 `turn/end`。失败按环境稳定复现：源码启动的 dev 后端不报错，打包桌面后端 + standard 预设 + 真实模型可复现。

根因：桌面 profile 自身的 `node_modules`（`$DSH_HOME/profiles/desktop/node_modules`）里存在第二份物理 `@deepseek-ai/dsh-tools`——第三方插件的 peer/直接依赖要求 `>= 0.1.0-rc.6` 而被 pnpm 提升，而应用捆绑的是 `0.1.0-rc.5`。Loader 按最近优先解析 `tools` 行到 profile 自己的 `node_modules`，因此 `ToolRuntime` 服务实例来自这份副本；捆绑的 `dsh-agent-loop` 从后端副本导入 `TOOL_RUNTIME_SCHEDULER`。两份模块实例各自铸造不同的 `Symbol('@deepseek-ai/dsh-tools.scheduler')`，于是对 loop 那份副本而言 `ctx.tools[symbol]` 是 `undefined`，`undefined.prepare(...)` 在 `tool-calls.ts`（`startCall`）、`code-mode.ts`（子派发）等所有调度访问点抛错。

## 决策

将 `TOOL_RUNTIME_SCHEDULER` 从模块内私有 `unique symbol` 改为带命名空间的字符串常量（`'@deepseek-ai/dsh-tools:runtime-scheduler'`）。字符串字面量在多个模块副本间按值共享，无论实例由哪份副本创建，agent loop 都能在 `ToolRuntime` 实例上取到调度器。键保持命名空间化且 `@internal`，仍不出现在生成的具名服务 API 中。

## 备选方案

**保留 symbol 并对齐版本（重建应用至 rc.6）。** 插件生态的发布领先于本 checkout，版本错位是移动目标；且不同路径下的两份相同版本副本仍会铸造不同 symbol——仅对齐版本不能修复机制。不采纳。

**让 Loader 从应用自身依赖闭包解析 bundle 行，而非 profile 的 `node_modules`。** 这是针对 profile 遮蔽的结构性完整修复，但会改变 vendored Loader/app-boot 的解析行为，属于更大且独立的改动；调度器握手对任何其他双副本路径仍脆弱。延后。

**把调度器暴露为 `ToolRuntime` 的公开方法。** 分段协议（prepare/dispatch/finalize/finish）刻意不属于具名服务 API；字符串键属性保留该边界。不采纳。

## 影响

- `TOOL_RUNTIME_SCHEDULER` 现为字符串字面量；`ToolRuntime` 调度器字段、`tool-calls.ts`、`code-mode.ts` 无需其他改动。
- `packages/core/tools/tests/tools.spec.ts` 新增回归测试，钉住键的字符串性及通过键可达调度器。
- 针对复现环境做了端到端验证：两份副本同时在位且都携带修复后的 lib（打包后端的副本是 workspace 链接）时，先前失败的 prompt 完成 22 次工具调用，调度器零报错。
- 已发布应用（无需重建）的即时环境修复：从 profile 的 `node_modules` 移除被提升的副本，使 `tools` 行解析到应用捆绑副本；在未改动的捆绑代码下验证可用。

## 剩余风险

- 本修复之前构建的 dsh-tools 副本仍只暴露 symbol；生态发布修复版副本前，profile 提升旧副本会使修复后的应用再次失效。届时请保持 profile 中该副本缺席（或固定为修复版）。
- Loader 在 profile 的 `node_modules` 遮蔽应用闭包时仍会从 profile 解析 bundle 行；未来任何被插件提升的核心行都可能以同样方式被遮蔽。本次修复已使当前握手健壮；Loader 解析加固仍是候选后续项。
