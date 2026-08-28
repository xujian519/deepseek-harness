# Agent Note: 上游同步后的债务清扫（v0.1.2-alpha.1）

Status: implemented

[English](2026-08-28-post-sync-debt-sweep.md) | 中文

## 问题

上游 v0.1.2-alpha.1 同步（953e7d370d）留下两类债务。其一，桌面打包链被两处独立打断：`scripts/desktop-package.ts` 的 `REQUIRED_BACKEND_PATHS` 仍要求已删除的 `dsh-host-apiproxy` 包；v0.1.2 改为 peer 声明的 seam 包会被 `pnpm deploy --prod` 丢弃，因为 `apps/cli` 未声明它们——这正是打包脚本注释记载的启动失败模式。其二，事实源与副本漂移：`vendor/README.md` manifest 表（10 个版本格 9 个过期）、根 `AGENTS.md` 布局段（23 个组未列出、两条已改名或删除、根 `examples/` 行在合并中丢失）、生成文档 `docs/event-producer-consumer` 双语对（仍列 `apiproxy`）、fork CI（无文档门禁，漂移静默）。此外 `docs/TECH_DEBT.md` 中若干条目要么可以低成本闭合、要么可以低成本证伪、要么到了需要记录决策的时候。

## 决策

1. **桌面链**：从 `scripts/desktop-package.ts` 及其 spec 镜像删除 apiproxy 必备路径；`apps/desktop` 版本升到 0.1.2-alpha.1；把被丢弃的 9 个 peer seam 包（`dsh-attachment`、`dsh-client-store`、`dsh-credentials`、`dsh-hook-protocol`、`dsh-invariants`、`dsh-jobs`、`dsh-sdk-protocol`、`dsh-session-persistence`、`dsh-util-workspace-path`）声明为 `apps/cli` 生产依赖——打包脚本注释规定的既有修复方式。已端到端验证：`build:lib` → `build:web` → `package:desktop:prepare` 通过，部署树携带全部静态导入的 specifier，合并前的陈旧 `resources/` 树已再生。
2. **事实源**：`vendor/README.md` manifest 刷新为实际 vendored 版本，Commit 列标注 `not recorded`（7bedce822f 替换源码时未记录 pin；下次 sync 按程序第 1 步补录）。根 `AGENTS.md` 布局段指向 `packages/README.md` 作为 group map 的唯一事实源，并记录 `apps/desktop` 与根 `examples/`。`packages/client/AGENTS.md` 的 rpcId 规则直接引用 Connection，不再指向迁移目标已删除的 note。`docs/event-producer-consumer` 已再生，zh 孪生的表格逐行同步。
3. **fork CI**：`node-checks` 现在运行 `pnpm run test:docs`，生成文档漂移会让 fork 构建变红；coverage exclude 登记 per-file 门禁暂时管不住的 fork 本地族（`patent/*`、`web/synapse`、`self-evolve/*`、`client/ui-agent-preset`，带 `TODO(cov)` 标记），并删除 `packages/self-modification` 死条目。这闭合了 2026-08-26 hygiene-gate note 的第 3 项。
4. **台账条目闭合**：M5——`writeFileAtomic` 在 rename 前 fsync 临时文件、rename 后 best-effort 刷父目录，平台差异隔离在 `src/fsync.ts`；M7——两个 `describe.skip` 恢复（整个 spec 实测不到 1 秒，记录的「60s 超时」理由不成立），过时的 service 方法断言按新的 `kind` 判别字段修正；L1/L2/L5——`AGENTS.md` 布局段、lsp `finalExtension` 内部化到 `src/extension.ts`、workflow `WorkflowEventName` 取消导出、`desktop/shell` `bridge-client` 在同步 write 抛错时 settle pending 条目（并摘除 abort 监听）。
5. **sync follow-up 3 闭合**：stream-chunk skip-hardening 移植进上游 fold——`ui-chat` `conversation-nodes/assistant.ts` 的每个 chunk 变体加 `isBlockIndex`/`isDeltaText` 守卫，packed chunk rows 适用同一 index 规则，`AssistantMarkdown` 通过 `textOf` 兜底块文本。两处 `it.skip` 已恢复并通过。
6. **证伪/决策**：H1 不成立——cordis `resolveConfig` 经 schemastery 的 `~standard.validate` 校验配置，缺失键不报 issue，文档承诺的 env 回退一直可达；已补 env 选择回归测试，schema 不改。M9 保留：legacy 迁移 shim 的消费者是已出货桌面构建（DSH Patent 0.1.1-rc.2）磁盘上的会话日志，无法证明不存在，「fail-loud + 迁移」是有意设计；首个 tagged release 时复审。`docs/TECH_DEBT.md` 载有完整状态更新。

## 已否决的替代方案

**H1 改 web seam schema 为 `.optional()`。** 否决：对 schemastery 3.18.1 该失败机制不存在，改 schema 只会把错误模型写进代码。

**删除 M9 legacy 迁移。** 否决：已出货的桌面安装可能回放携带旧形状的会话日志；只有格式版本边界上删除才是安全的。

**现在抽取 H5 announcement 原语与 H7 `emitContained` 原语。** 推迟：两者都是台账排期为独立可评审 PR 的核心生命周期重构；并入本次清扫会把无关风险耦合进一个过宽的 diff。

**coverage 门禁只豁免精确的未覆盖文件。** 否决，改为带 `TODO(cov)` 标记的族级登记，与既有 GUI 债豁免风格及 hygiene note 的表述一致。

## 后果

桌面打包在 v0.1.2 上可用，打包后端携带其代码静态导入的每一个包；部署树不再包含已删除的包，打包 app 版本与 workspace 一致。事实源与实物一致，fork CI 此后能在生成文档漂移时失败。`writeFileAtomic` 在 POSIX 上具备崩溃持久性。畸形的 assistant chunk 降级为跳过该块，不再击穿会话树。`docs/TECH_DEBT.md` 的开放清单缩减为 H4/H5/H7/M1/M2/M3/M4/M6 余下/M8/L3/L4 加 sync follow-up 1 与 2。

## 取代关系

部分取代 [2026-08-28-upstream-v0.1.2-alpha.1-sync](../process/2026-08-28-upstream-v0.1.2-alpha.1-sync.zh.md)：其 follow-up 3 在此闭合；follow-up 1（readFileText Remote 网关）与 2（synapse live-reply）仍开放，该 note 保持 active。部分取代 [2026-08-26-hygiene-gate-debt-and-conflict](../../proposed/bug-fix/2026-08-26-hygiene-gate-debt-and-conflict.zh.md)：其第 3 项已实现；`bundle/im` 的 knip 项仍归其窗口。
