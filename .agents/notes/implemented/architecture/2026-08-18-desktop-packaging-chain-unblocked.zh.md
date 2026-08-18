# Agent Note：桌面端打包链路打通（client face 隔离、stale bridge socket、base bundle 依赖）

状态：implemented

[English](2026-08-18-desktop-packaging-chain-unblocked.md) | 中文

## 问题

`pnpm run package:desktop:mac` 无法产出可用的应用；四个预存缺陷依次挡住了它：

1. **Client face 类型隔离被破坏。** 共享包（`api/remotes`、`llm-retry`、`compaction` 等）从 `@deepseek-ai/dsh-session` root import 类型，而 root 的声明产物携带 host 侧独有的 `Context.sessions: SessionStore` 合并。任何把这些包拉进编译程序的 client face 程序——client/runtime 引用了它们——都会与 client 自己的 `Context.sessions: ISessions` 声明冲突（约 30 处 TS 错误，首当其冲是 TS2717）。仓库自己的规则（projection-store.ts："one program must not hold both sides"）已悄然失效：CI 的 typecheck 通道只跑 `build:lib:host`，client face 从未被发现。
2. **Base bundle 清单不完整。** `packages/bundle/base/cordis.patch.yml` include 了 `dsh-self-evolve`、`dsh-self-evolve-basic` 和 `dsh-tool-self-evolve`，但 `base/package.json` 从未声明它们，于是打包部署的后端树缺少这些包，desktop profile 启动时报 `Cannot find package`。
3. **Stale bridge socket。** POSIX socket 文件在其监听者退出后依然存在；被 kill 或崩溃的应用会留下 `dsh-desktop-bridge.sock`，即使没有任何监听者，下一次启动也会以 `EADDRINUSE` 失败。这正是最初"桌面端无法启动"的根因，且每次非干净退出都会复发。
4. **工具目录滞后。** `scripts/gen-tool-catalog.ts` 的 `TOOL_PACKAGES` 漏掉了 `tool-self-evolve`（后来才加入），其 spec 以清单完整性错误失败，生成的 `docs/tool-catalog.md` 也是旧的。

## 决策

1. 把 `Context.sessions` 从 `dsh-session` root 移出，放入独立的 `@deepseek-ai/dsh-session/context` 子路径。每个读取 `ctx.sessions` 的包加一处 type-only 导入（`import type {} from '@deepseek-ai/dsh-session/context'`）：该增强一旦加载即对整个程序生效，而 type-only 形式不会进入产出的声明文件，因此 client 程序永远不会看到 host 的合并。host face 的注入点在 `apps/cli/tests/context-host.ts`。
2. `base/package.json` 现在依赖 `@deepseek-ai/dsh-self-evolve`、`@deepseek-ai/dsh-self-evolve-basic` 和 `@deepseek-ai/dsh-tool-self-evolve`；`verify-cordis-config` 对全部 132 个配置通过。
3. `BridgeServer.start()` 对 POSIX socket 的 `EADDRINUSE` 做探测：有活跃监听者则保持错误，死文件则 unlink 后重试一次绑定。新增 stale socket 回归测试覆盖。
4. `TOOL_PACKAGES` 补上 `tool-self-evolve` 条目（mount 用 `ctx.provide` 桩掉 `ctx.selfEvolve`），工具目录 spec 的完整工具名断言刷新为 81 个已发布工具，`docs/tool-catalog.md`/`zh` 重新生成并重新记录配对。

## 备选方案

- **把所有共享包改成 `/types` import**——不可行：值（`SessionStore`、`canonicalHeader` 等）只在 root；root 仍然携带合并。
- **删掉 client 的 `ISessions` 声明**——会让每个 client 消费点都加断言转换；否决，改用隔离修复。
- **启动时无条件删除 socket 文件**——会破坏真正存活的第二个实例；探测区分了存活与死文件。

## 后果

`package:desktop:mac` 端到端完成；安装后的应用能启动（bridge + 后端 + UI）且能扛住非干净退出。`tsc -b tsconfig.client.json` 现在全绿，并被桌面端构建路径持续检查，这类 host/client Context 合并漂移会快速失败。工具目录现在包含 self-evolve 工具。已知遗留：`docs/tool-catalog` 与 `docs/config-catalog` 的 zh 侧是手工维护的经评审翻译；生成器只写英文。
