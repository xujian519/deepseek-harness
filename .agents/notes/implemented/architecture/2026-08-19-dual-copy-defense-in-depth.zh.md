# Agent Note：双副本调度器握手的纵深防御

状态：implemented

[English](2026-08-19-dual-copy-defense-in-depth.md) | 中文

## Problem

字符串键调度器握手（[2026-08-16-dual-copy-dsh-tools-scheduler-handshake](2026-08-16-dual-copy-dsh-tools-scheduler-handshake.zh.md)）让"同版本双副本 `@deepseek-ai/dsh-tools`"不再有害，但仍有三处缺口：

1. **版本分裂无防线。** 第三方插件把 `@deepseek-ai/dsh-tools` 声明为**直接依赖**（而非 peer）时，pnpm 会在 profile 的 `node_modules` 里按其锁定的版本物化一份物理副本。复现环境的 profile 中，`dsh-feishu-bot` 直接依赖 `@deepseek-ai/dsh-tools@0.1.0-rc.6`，与 app 的 `0.1.0-rc.7` 并存；`dsh-credentials`、`dsh-sdk-client`、`dsh-sdk-protocol`、`dsh-settings` 也各有一份 rc.6。修复后的 app 一旦遇到 profile 中 hoist 的"修复前（Symbol 键）或不同版本"副本，每次工具调用都会重新崩溃。
2. **故障不可诊断。** `ctx.tools[schedulerKey].prepare(...)` 对 `undefined` 抛出的裸错误 `Cannot read properties of undefined (reading 'prepare')` 不指向双副本成因，也不给出修复检查点。
3. **机制是全社区性的。** [anywhere-labs/deepseek-harness-desktop#227](https://github.com/anywhere-labs/deepseek-harness-desktop/issues/227) 报告了同一崩溃，场景为两套 DSH 安装共享一个 `$DSH_HOME`：`healProfilesModuleFallback` 把 `$DSH_HOME/profiles/node_modules` 重指向"最后启动的安装"，另一安装的进程随即加载混合副本。上游至今仍发布 `unique symbol` 键，npm 全局安装用户依旧脆弱。

## Decision

三层独立防线，任何单一布局故障都不会以崩溃形式到达用户：

- **L1（已落地）：字符串键。** `TOOL_RUNTIME_SCHEDULER` 按值跨副本共享。
- **L2：profile 的 pnpm workspace 版本钉。** `initProfile` 在 `pnpm-workspace.yaml` 写入 `overrides`，把 `@deepseek-ai/dsh-tools` 与 `@deepseek-ai/cordis` 钉到从安装锚点解析出的版本（`installedPackageVersion`、`profileCoreOverrides`）。`ensureProfileVersionPins` 幂等地给既有 profile 补写且保留无关键；`divergentProfileCoreVersions` 指出已装副本中版本偏离安装的包。钉版本使下一次 `pnpm install` 把所有物理副本收敛到安装版本，字符串握手永远面对同版本副本。
- **L3：可诊断故障 + 自愈。** `dsh-agent-loop` 的 `requireScheduler` 把"调度器缺失"转成指明键名与 `$DSH_HOME` 检查点的错误。`prepareProfile` 在副本分歧时打印手动修复指引（在 profile 目录运行 `pnpm install`）；设置 `DSH_AUTO_PNPM_INSTALL`（桌面启动）时自行运行 `pnpm install` 并报告仍未收敛的副本。desktop 主进程设置 `DSH_AUTO_PNPM_INSTALL=1`，打包 app 在无终端情况下也会在分歧出现后的首次启动自行收敛 profile。

## Alternatives considered

**在依赖图层消灭物理副本。** pnpm 的隔离/hoisted 布局叠加插件的直接依赖，使第二份副本不可避免；只有版本对齐可控。上游防重复契约（heal 软链 fallback、bundle 安装优先解析、`autoInstallPeers: false`）已让 peer 解析回安装；版本钉补上的是直接依赖这个缺口。

**改用 `Symbol.for` 而非字符串键。** 全局注册表仅在进程内有效，能修复进程内握手，但跨进程或序列化键场景无效；且改动已发布键会破坏 rc.7 兼容面，无收益。

**重写 Loader 让 bundle 行永远从 app 闭包解析。** 结构性最完整，但改动 vendored-Loader 解析；前一份 note 记为 deferred，仍成立。

## Consequences

- 新 profile 从首次初始化即携带版本钉；既有 profile 在启动时被幂等补写，并给出手动修复提示（桌面启动则自动收敛）。
- 调度器缺失时报告双副本检查点，而非裸的属性读取错误。
- 版本钉只钉两个包：`@deepseek-ai/dsh-tools`（握手键所有者）与 `@deepseek-ai/cordis`（经 `Symbol.for('cordis.is')` 的身份标识）。刻意避免钉满整个 `@deepseek-ai/dsh-*` 面：peer 已通过 fallback 解析回安装，过宽的钉会约束插件生态。

## Verification

- `profile.spec.ts` 覆盖：带/不带版本钉的 workspace 输出、从模拟安装解析 `profileCoreOverrides`、幂等补写且保留无关键、陈旧钉修正、缺失/一致/分歧三种已装副本的偏离检测。
- `tool-calls.spec.ts` 从已挂载的 `ToolRuntime` 上删除调度器槽位，断言失败 turn 的错误指明键名与 `$DSH_HOME` 检查点。
- 真实 desktop profile 启动期间的解析追踪（`node --import` resolve hook 拦截 `@deepseek-ai/dsh-tools` 与 `@deepseek-ai/cordis`）：握手双方都解析到安装副本——`dsh-agent-loop` 静态 import 它，loader 对 `tools` 行的动态 import 命中同一 ESM 缓存条目；profile 插件 import 各自的物理副本仅供自身 API 使用。cordis 双副本无冲突，因为其身份握手已用进程级 `Symbol.for('cordis.is')`。
- 本地复现：应用版本钉并重装后，profile 的 `@deepseek-ai/dsh-tools` 副本收敛到安装的 rc.7，桌面/CLI 启动执行工具调用无调度器错误。

## Remaining risks

- `DSH_AUTO_PNPM_INSTALL` 需要 PATH 上有 pnpm；没有 pnpm 的打包机器退化为手动修复警告（期间字符串键让同版本双副本不致命）。
- 插件 hoist 的"修复前（Symbol 键）`dsh-tools` 副本"仍会让修复后的 app 重新崩溃；该窗口只有等 npm 生态发布字符串键（上游合入并发布 [字符串键提交](https://github.com/xujian519/deepseek-harness/commit/8d031d46c8)）后才会关闭。
- 多安装共享 `$DSH_HOME`（社区 #227）在此仅被缓解而非解决：heal 仍会把 fallback 重指向最后启动的安装，但诊断错误已让混合加载可识别。
