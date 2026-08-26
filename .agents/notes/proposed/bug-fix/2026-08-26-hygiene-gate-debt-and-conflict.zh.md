# Agent Note: hygiene 门禁债务与自由化插件冲突

Status: proposed

[English](2026-08-26-hygiene-gate-debt-and-conflict.md) | 中文

## 问题

`feat/onboarding-rebrand-dsh-patent` 分支上的 pending 改动全部属于自演化家族(`packages/self-evolve/self-evolve-benchmark/` 以及为 `ctx.selfEvolveBenchmark` 重生成的目录/文档产物)。另一窗口报告了本次改动上两组门禁失败,并询问这些是既有债务还是本次引入:`hygiene` 门禁(knip + constraints)与全量 `test:coverage`。

这些失败在修复前必须先分类,因为归属不同。若某项属于另一窗口正在进行的自由化插件工作(dsh-im bundle 设计、external plugin integration、preset 切换),在此修复会撞车;若是无关债务,则可独立修理。

## 提案

本 note 记录根因分析与修复清单,待自由化插件窗口结束后,以一次协同变更统一实施。

### `hygiene` 失败的根因

**constraints — 一条错误,无关债务。** `packages/self-evolve/evaluation` 报 `expected a package here (no package.json found)`。该目录只含 `RUNBOOK.md`/`RUNBOOK.zh.md` — P1-10 离线评估的数据/文档目录,已由 `pnpm-workspace.yaml`(`- '!packages/self-evolve/evaluation'`)刻意排除。但 `scripts/check-workspace-constraints.ts` 的 `checkHierarchyShape()` 遍历 `packages/*/*` 时只跳过 `localArtifactDirs`(`node_modules`),从不读取 `pnpm-workspace.yaml` 里的 `!` 排除 glob,于是把被排除的目录误判为缺 manifest 的包。这是脚本与 workspace 排除规则不同步的债务,与 self-evolve-benchmark 改动无关。

**knip — 两项,归属不同。**

- `@deepseek-ai/dsh-fs`(`packages/memory/openviking` 的 unused devDependency):`src/` 与 `tests/` 均未 import,且 `package.json` 在 `dependencies` 与 `devDependencies` 里都声明了。确属冗余,无关债务;修复是删掉声明。
- `@xmanrui/dsh-im`(`packages/bundle/im` 的 unused dependency)与该包的 knip.json 配置 hints:`packages/bundle/im` 由 HEAD `3350947517 feat(bundle): integrate @xmanrui/dsh-im` 引入,属自由化插件工作。其 `src/index.ts` 是 `export {}` — 纯 patch 载体的静态包、无运行时 API;`@xmanrui/dsh-im` 只出现在 `cordis.patch.yml`(YAML)、README 与注释里,knip 的静态 TS 分析看不到 YAML 里的 `name:` 引用,于是报 dependency unused。该 bundle 也没有自己的 `knip.json`,落入根 knip.json 的 `packages/*/*` 默认规则,其 `tests/` entry/project pattern 在这个无测试包里匹配不到,同时触发 "Refine entry pattern (no matches)" 与 "Refine project pattern (no matches)" 两条 hints。`self-evolve-app`、`base`、`desktop-app`、`web-app` 等 bundle 已带 `ignoreDependencies: ["@deepseek-ai/.+"]`;`@xmanrui/dsh-im` 是外部包,需要单独的豁免。

### `test:coverage` 失败的根因

覆盖率门禁在 `vitest.config.ts` 用了 `coverage.perFile: true` + `statements/branches/functions/lines: 100`,要求每个 `src` 文件 100% 覆盖。失败包(`web/synapse`、`patent-*`、`self-evolve-basic`、`self-evolve-eval`、`client/ui-agent-preset`、`host/apiproxy`)的 src 树未被完全覆盖,且没进 vitest exclude 清单,于是走 per-file 100% 门禁。代表例:`packages/web/synapse` 有 6 个 `src` 文件对 5 个 spec;`packages/patent/patent-core` 有 75 个 `src` 文件对 10 个 spec。这些源码多为 GUI(`web/synapse`、`ui-agent-preset`、`apiproxy`)或专利资产,与已排除的 client-UI GUI 债务同类,只是还没登记进 `exclude`。这些包在 `master` 已存在,当前工作区未触碰它们,故为 pre-existing。

### 与自由化插件窗口的冲突

两条线共享一窄带文件并在此碰撞:`scripts/gen-cordis-catalog.ts`、`scripts/gen-doc-graphs.ts`、`packages/extensions/tool-cordis/src/api-catalog.ts`(生成产物,此处已改过),以及重生成的 `docs/config-catalog.*`、`docs/capability-seams.*`、`docs/subsystems/*`。生成器带字节级复现门禁(`--check`);自由化工作只要新增任何 `ctx.*` 服务或移动服务所属包名,就必须重跑这两个生成器并重写目录文档,落到与本 self-evolve 改动相同的文件上。运行时业务代码则不相交(`app-boot`、`plugin-market`、`agent-presets`、`self-evolve-benchmark` 不重叠)。

## 修复清单

待自由化插件窗口结束后,以一次协同变更、按依赖顺序实施:

1. `scripts/check-workspace-constraints.ts` — 让 `checkHierarchyShape()` 尊重 `pnpm-workspace.yaml` 的 `!` 排除 glob(用 `yaml.load` 读取,`scripts/gen-third-party-notices.ts` 已如此处理),或把这些数据目录加入显式豁免清单。
2. `packages/memory/openviking/package.json` — 从 knip 标记的那一节删除冗余的 `@deepseek-ai/dsh-fs` 声明。
3. `test:coverage` 失败确认为 pre-existing,本就超出本次修复范围;需另开债务变更,要么补覆盖、要么把这些包登记进 `vitest.config.ts` 的 `exclude`。

`@xmanrui/dsh-im` / `bundle/im` 的 knip 项归属自由化插件窗口:为 `packages/bundle/im` 补 knip 配置(自己的 `knip.json` 或根 `knip.json` 条目),豁免 `@xmanrui/dsh-im` 并修正 entry/project pattern,使其不再报 hints。此处不修,以免撞车。

## 备选方案

- **本次一并修复包括 `bundle/im`。** 否决:`bundle/im` 是另一窗口的活动区,此处编辑会撞车;`@xmanrui/dsh-im` 两项也非既有债务,而是另一窗口尚未落地的 bundle 设计的后果。
- **把所有 `hygiene` 失败当作 pre-existing 而忽略。** 否决:其中两项(constraints 的 evaluation、openviking 的 `dsh-fs`)是无关、确定、廉价的修复,不应继续腐化。
- **现在就修 `test:coverage` 失败。** 否决:它们横跨大量 GUI/patent 源文件(补覆盖或登记排除)且已确认为 pre-existing;作为独立债务变更保持本次修复聚焦。

## 验收标准

- 上述分析已记录,后续无需重新调查即可实施修复。
- 修复将 `@xmanrui/dsh-im` / `bundle/im` 的归属留给自由化插件窗口;本次不改这些文件。
- 修复落地前,`pnpm constraints` 与 `pnpm knip` 此处不作为交付结论;本 note 只记录根因与预期修复。

## 风险

- 两项修复(`check-workspace-constraints.ts`、`openviking` manifest)位于共享目录;若在自由化窗口仍编辑 `gen-*.ts` 或 bundle 目录时实施,可能造成窄文本冲突,故安排在窗口结束后。
- 若本次修复运行前自由化窗口改变了 `bundle/im` 的边界,记录的 `@xmanrui/dsh-im` 细节可能过期;届时修复应先重新核对。
