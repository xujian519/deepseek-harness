# Agent Note: 闭合联合的 switch 以 `assertNever` 收尾，以及穷举 lint 选项决定的事

Status: implemented

[English](2026-09-13-switch-exhaustiveness-guards.md) | 中文

## 问题

Issue #89 报告全仓有 26 处穷举 switch 既无 `default` 也无 `assertNever`，并要求复核 oxlint 的 `considerDefaultExhaustiveForUnions: true` 是否与 AGENTS.md「闭合联合以 `assertNever` 收尾」的要求冲突。按解析器加类型检查器重新计数——`packages/*/*/src` 与 `apps/*/src` 下所有无 `default` 子句、且 case 标签全为字面量的 `switch`，再看 switch 表达式的类型——共 **69** 处：61 处是字面量联合，另有 8 处的判别值是普通 `string`（`method` 或 `topic` 名、迁移输入里未定型的 `event.type`、`value.toLowerCase()`），`assertNever` 在那里根本无法适用。

审计优先点名的六个静默面里，有两处的正确处理与它要求的相反：

- `packages/experimental/inspector/src/worker/inspection/network-store.ts` 的 switch 永远不会遇到未知 topic：`NetworkStore.append` 在进入 `ingest` 前就把 `topics` 集合（`FETCH_TOPICS`）之外的记录丢掉，所以缺的不是 `default` 子句，而是那道过滤处的说明。
- `session-format-*` 的迁移 switch 读的是未定型的输入，类型就是 `string`。

## 决策

**lint 选项保持 `true`。** 在 lint 配置副本里把它翻成 `false` 后，全仓有 **90** 处 switch 报 `switch-exhaustiveness-check` 失败，且每一处都是带 `default` 的有意子集处理——对可合并扩展的 `SessionEventMap` 做投影的那一族及同类。该选项正是给「某个构建无法替别的构建穷举」的联合留出写明理由的 `default` 的空间。`assertNever` 的契约并不依赖它：`assertNever(value: never)` 只接受 `never`，因此往闭合联合里加成员会在调用点令 `pnpm run typecheck` 失败——是每个消费方的构建，而非只有本仓的 lint 车道。

**闭合联合用 `assertNever`，开放判别值用写明边界的注释。** 本批为九处协议 switch 加了守卫（此前未识别的成员会静默通过）：`api/session-controller` 五处（Host 助手流累加器、Client 累加器、会话列表变更折叠、日志变更应用、日志变更翻译），外加 `client/ui-conversation` 的会话窗口折叠、`experimental/webworker-runtime` 的两处 shell switch（参数分段与重定向子类型）、以及 `experimental/inspector` 的 `validateRemoteObject`。每处 default 都带 `/* v8 ignore next -- closed-union backstop; ... */`，因为它在构造上不可达：值的类型是闭合的，inspector 那一处还由 `parseRemoteObject` 在 cast 之前只放行 `REMOTE_TYPES`。

**三处可扩展联合现在就地说明为何落空。** `compaction/compaction/src/tool-pairing.ts`（事件增量）、`interaction/permission-presets`（投影的引用不变变更闸门）、`compaction/compaction-basic/src/summarizer.ts`（既不属于三种失败之一的结束原因——`FinishReasonMap` 的类型文档本身就要求对未知种类落空）各自写明未知成员为何进入 default 而不是某个 case。

## 考虑过的替代方案

- **把 `considerDefaultExhaustiveForUnions` 翻成 `false`。** 依据上述实测否决：90 处有意的「子集 + default」处理将被迫穷举每个成员，而可扩展映射跨构建时给不出这种承诺；闭合联合这一半的规则也不需要它。
- **同样给 `NetworkStore` 的 switch 加 `assertNever`。** 否决：追加过滤让那个 default 不可达，加上去只是把边界在第二处死陈述一遍，而边界属于过滤处——本批把它写在了那里。
- **一次性守卫全部候选。** 依据影响面否决：剩下 52 处字面量联合会连带 20 个包各一行清单声明与一次 lockfile 刷新，且每处都要单独判定「闭合还是可扩展」。改为记录分类，使剩余部分成为机械工作。
- **从 `@deepseek-ai/dsh-value` 再导出 `assertNever`**（该包已有 182 个声明方，且已在再导出 values 包的 `deepFreeze`，后者有 134 个声明方）。并非在可行性上否决——它能省掉大部分清单工作——但它会扩大一个被广泛使用的包的公开面，需要单独决策，而不是搭在本次改动里。

## 后果

九处协议 switch 现在会对未识别的变体抛出具名错误，而不是静默忽略；每一处在任何构建出货前都会由编译器拒绝新成员。剩余 60 处候选已连同类型与包/依赖状态记录在案：52 处字面量联合（10 个已声明 `@deepseek-ai/dsh-util-values` 的包里有 16 处，20 个未声明的包里有 36 处），以及 8 处各自需要单独裁定的开放判别值。在这些落地之前，往它们任一联合里加成员仍会在 lint 期被 oxlint 的穷举规则拦住；本批加强的是跨协议边界的运行期保证与面向消费方的编译期保证。

## 测试

扫描按本 Note 的描述可复现：解析器加类型检查器遍历 `packages/*/*/src` 与 `apps/*/src`，改动前报 69 处候选、改动后 60 处，九处已加守卫的 switch 全部从列表中消失。对七个受影响的包跑 `npx vitest run`：2409 通过。十三个被改文件的逐文件覆盖率仍为 100%（用带 `--coverage --coverage.include` 的定向运行验证，含其 ignore 注释之后的那些新 default 分支）；`network-store.ts` 的新用例用一个假想的新版 worker 记录钉住了 topic 边界。`pnpm run lint`（4489 文件 0 警告 / 0 错误）、`pnpm run typecheck`、`pnpm run duplication`（0 克隆）、`pnpm run verify-package-dependencies`（66 个包）、`pnpm run verify-suppression-reasons`（400 条抑制，零发现），以及上面的翻配置实测（`npx oxlint --config <flipped> .` → 90 处 `switch-exhaustiveness-check`）。

## 相关

- [以同仓库 Issue 跟踪技术债](../process/2026-09-11-tech-debt-issue-tracking.zh.md)——Issue #89 的登记处。
- [类型感知 lint 清理](../process/2026-08-29-type-aware-lint-cleanup.zh.md)——此前确立「抑制与防御注释是承重文档」的裁定，与本次同一「就地写明理由」的规则。
- [lint 抑制须说明理由](../process/2026-09-13-lint-suppression-reasons.zh.md)——与本次同批加入的门禁。
