# 专利域代码审阅报告（2026-09-21）

- 审阅对象：`packages/patent/` 全族 12 包 —— `patent-core`、`patent-tools`、`patent-workflow`、`patent-teams`、`patent-knowledge`、`patent-rule`、`tool-literature`、`patent-deadline`、`writing-patterns`、`methodology`、`patent-document`、`patent-data`
- 基线：`master` 分支（2026-09-21 审阅当日），工作树含 5 个未提交文件（`patent-tools/README*.md` 与 `tests/registration.spec.ts` 的工具计数 28→29、`packages/preset/agent-presets/presets/patent/agent.cordis.yml` 的 `structureFigureEnabled: true`）；5 项互洽，不构成本报告任何发现
- 规模：286 个 `src` 文件 / 约 53k 行 src（另有约 42k 行测试、214 个 spec 文件 / 2751 条用例）
- 审阅维度与权重：精简去重 40%、质量与契约 35%、优化建议 25%
- 证据形式：全部结论附 `文件:行号`；工具输出留存于 `.dsh/reports/patent-domain-review/`（该目录已 gitignore，不入版本库）
- 复现命令见文末「附录：方法与复现」

## 0. 本报告与既往记录的关系

本报告不重复已被裁定的项目。以下裁定经复核后仍然成立，**不作为发现**列出：

| 既往裁定 | 位置 | 复核结论 |
|---|---|---|
| browser-use PDF 下载通道已删除；`resolveGateRoute` JSDoc 已改写为现状；patent-tools 工具计数已对齐 | [`2026-08-30-patent-domain-breakpoint-cleanup`](../../.agents/notes/implemented/simplification/2026-08-30-patent-domain-breakpoint-cleanup.md) | 成立 |
| `sleep` 族四处「暂不下沉」 | `docs/TECH_DEBT.md` | 成立 |
| `asRecord` 已下沉 `@deepseek-ai/dsh-value`（`patent-core`、`patent-rule` 已收敛） | `docs/TECH_DEBT.md` | 成立；本报告不把 `writing-patterns/src/pattern-store.ts:348` 的 `asRecord` 计入重复（详见 §5） |
| `assertNever` 已改用共享版（`patent-teams` 本地副本已删） | `docs/TECH_DEBT.md` | 成立；§4-PDR-16 只针对该台账未列的另两处手写 `never` 断言 |
| `isENOENT` 已下沉（`patent-teams` 的 `isEnoent` 已收敛） | `docs/TECH_DEBT.md` | 成立 |
| `WorkflowStage.guidance` 与 `CheckerVerdict` 为刻意设计 | [`2026-09-03-patent-stage-guidance-and-checker-verdict`](../../.agents/notes/implemented/architecture/2026-09-03-patent-stage-guidance-and-checker-verdict.md) | 成立 |
| `PATENT_CASE_DOMAINS` 四类 job scope 为刻意设计 | [`2026-09-21-patent-rule-job-scope-domains`](../../.agents/notes/implemented/architecture/2026-09-21-patent-rule-job-scope-domains.md) | 成立 |

一处在**证据层被修正**，见 §4-PDR-01。

## 1. 门禁基线（本机实跑）

| 门禁 | 结果 | 备注 |
|---|---|---|
| `pnpm run duplication` | PASS | 全仓 0 克隆（见 §4-PDR-02：该结论对专利域不成立） |
| `pnpm run hygiene` | PASS | |
| `pnpm run test:docs` | PASS | |
| `pnpm run lint` | PASS | 0 warning / 0 error |
| `pnpm run typecheck` | PASS | 两编译面均绿 |
| `pnpm vitest run packages/patent` | PASS | 214 文件 / 2751 用例全绿（7s） |

基线是绿的。本报告的问题全部是**门禁看不见的结构性问题**，不是当前失败。

## 2. 总体评价

专利域的工程质量高于仓库平均：`src` 内 `any` 使用为 **0**；无 `TODO`/`FIXME`/`XXX` 标记残留；capability seam 三角完整；测试密度与领域复杂度相称（214 spec / 2751 用例，约 42k 行测试对 53k 行 src）；`patent-knowledge` 的 `shared/fts.ts`、`shared/fts-search.ts` 把 FTS5 降级阶梯正确抽取为共享原语，是正面样本。

最重的三个结构性问题：

1. **门禁恰恰在最需要信号的两处失明。** 专利域被整族排除在覆盖率**测量**之外（不只是阈值外，见 §4-PDR-01），而重复检测的阈值高于该域内所有真实克隆的长度（§4-PDR-02）。53k 行生产代码既无覆盖率数字，也无重复数字。
2. **同一语义存在多份实现，且已出现真实分叉。** 两套数值范围语法对同一句专利文本给出不同结论（§4-PDR-03）；两份 `assertRendered`/`resolveInvention`（§4-PDR-08）；跨包 PDF 体三检与 `datePartOf`（§4-PDR-09）；三份 asset-location 解析（§4-PDR-17）。
3. **注释在承担契约职责处已与代码事实不符。** `merge.ts` 的 `asArray` 文档与实现相反（§4-PDR-05）；两处 `v8 ignore` 的豁免理由描述的字段该代码根本不读（§4-PDR-07）；`patent-teams` invariant 的模块文档声称校验「every payload」，实际覆盖 7/9 事件类型（§4-PDR-04）。

## 3. 发现分级总览

| 编号 | 严重度 | 分类 | 标题 | 风险 | 工作量 |
|---|---|---|---|---|---|
| PDR-01 | 严重 | 结构优化 | 专利域整族被排除在覆盖率测量之外 | 中 | L |
| PDR-02 | 严重 | 重复 | 重复检测阈值高于域内所有真实克隆，专利域系统性失明 | 中 | M |
| PDR-03 | 严重 | 质量契约 | 两套数值范围语法分叉，同一文本两条生产路径结论相反 | 中 | M |
| PDR-04 | 严重 | 质量契约 / 冗余校验 | `patent-teams` invariant 覆盖 7/9 事件类型，文档过度承诺 | 低 | S |
| PDR-05 | 中等 | 质量契约 / 注释文档 | `merge.ts` 的 `asArray` 文档与实现相反，existing 非数组被静默丢弃 | 中 | S |
| PDR-06 | 中等 | 死码 / 重复 | `ipc-standards.yaml` 1782 行双副本 + 不可达候选 + 失效豁免理由 | 低 | S |
| PDR-07 | 中等 | 注释文档 | 两处 `v8 ignore` 理由与被豁免代码不符 | 低 | S |
| PDR-08 | 中等 | 重复 | `assertRendered` 与 `resolveInvention` 各两份（同包） | 低 | S |
| PDR-09 | 中等 | 重复 | 跨包 PDF 体三检与 `datePartOf` 双份，`jscpd:ignore` 只加一侧 | 低 | S |
| PDR-10 | 中等 | 硬编码参数 | `tool-literature` 的网络预算无 `Config` 出口 | 低 | S |
| PDR-11 | 中等 | 质量契约 | `loadIpcStandards(overridePath)` 的 override 自第二次调用起被静默忽略 | 低 | S |
| PDR-12 | 中等 | 结构优化 | FreeCAD real-render 子进程在并发/重负载下失败 | 中 | M |
| PDR-13 | 中等 | 上帝文件 | 四个多职责耦合文件与拆分边界 | 中 | L |
| PDR-14 | 中等 | 结构优化 | 38 个函数/方法超过 80 行，最大 317 行 | 低 | L |
| PDR-15 | 建议 | 重复 | 同包守卫重复 `isOptionalString` / 内联非空字符串判断 | 低 | S |
| PDR-16 | 建议 | 质量契约 | 两处闭合联合未使用共享 `assertNever` | 低 | S |
| PDR-17 | 建议 | 重复 / 结构优化 | 三份 asset-location 模块实现同一解析契约 | 低 | S |
| PDR-18 | 建议 | 结构优化 | `methodology` 8/8 组件的 `identify` 同构 | 低 | S |
| PDR-19 | 建议 | 注释文档 | 注释中的移植差异叙述与未来计划残留 | 低 | S |

## 4. 发现详情

### PDR-01 专利域整族被排除在覆盖率测量之外

**证据**
- [`vitest.config.ts:209`](../../vitest.config.ts) `coverage.include = ['packages/*/*/src/**/*.{ts,tsx}']`
- [`vitest.config.ts:215`](../../vitest.config.ts) `coverage.exclude` 数组，内含 [`vitest.config.ts:230`](../../vitest.config.ts) `'packages/patent/*/src/**/*.{ts,tsx}'`
- 该条目所在注释块（`vitest.config.ts:222-229`）的理由原文是「GUI and patent-asset code without per-branch specs」，并指向 [`2026-08-26-hygiene-gate-debt-and-conflict`](../../.agents/notes/proposed/bug-fix/2026-08-26-hygiene-gate-debt-and-conflict.md) 的 coverage backlog（该 note 记录当时 `patent-core` 为 75 src / 10 spec）
- 实测：`pnpm vitest run --coverage --coverage.reporter=json-summary packages/patent` 产出的 `coverage-summary.json` 有 1627 个条目，其中来自 `packages/patent/*/src` 的为 **0**

**症状 → 根因 → 后果 → 修法**

症状是「整个族没有任何覆盖率数字」。这里必须修正一个常见误读：该 glob 位于 `coverage.exclude`（**排除测量**），而不是 `coverage.thresholds.exclude`（排除阈值）。两者的差别是实质性的——前者让文件**不出现在覆盖率报告里**，后者只让文件免于 100% 判定但仍可看见。实测的 0 个条目证明是前者。

根因是这条豁免当初为「跑得起来」而登记（该 note 原文即「registering them keeps the gate runnable」），而**家族级 glob** 的表达力使得后来补齐永远不需要改配置。后果有三层：① 286 个文件 / 53k 行没有任何覆盖率信号；② 今天新增一个 `packages/patent/<新包>/` 自动落在门禁之外；③ 该族的测试密度已经变成全仓最密的几处之一，理由文本已与事实不符，后续读者会继续引用一个失效判断。

修法：把家族级 glob 换成**按包条目**，并逐包给出判定——「补测到达标后移出」或「显式豁免 + 理由 + 到期条件」。补测优先级按「分叉藏身概率 × 无 CI 信号」排序：① `patent-tools/src/figure/**` 与 `patent-tools/src/tool/generate-*.ts`；② `patent-core/src/ipc/**`；③ `patent-teams/src/state.ts`（mailbox lease/TTL、锁与原子写分支）；④ `tool-literature/src/runtime/http.ts`（缓存命中/过期、`Retry-After`、pacing）；⑤ `patent-core/src/graph/merge.ts`（PDR-05 的初始状态用例）。判定与理由写入 `vitest.config.ts` 的 exclude 注释，不要只留在 Agent Note 里。

**消费者证据**：`grep -n "packages/patent" vitest.config.ts` → 唯一条目即 `:230`。

**影响面**：`vitest.config.ts`、`pnpm run check:ci:coverage`、CI 覆盖率作业；补测会新增 spec 与可能的 fixture。**风险** 中 · **工作量** L · **置信度** 高

**验证方式**：先对单包临时移除 exclude 观察缺口，再逐包收敛；全量 `pnpm run check:ci:coverage`。

### PDR-02 重复检测阈值高于域内所有真实克隆，专利域系统性失明

**证据**
- [`.jscpd.json:2-4`](../../.jscpd.json) `minTokens: 60`、`minLines: 6`、`mode: mild`；脚本 `duplication = jscpd --config .jscpd.json packages scripts`（`package.json`）
- 现行配置单独扫 `packages/patent/patent-tools`：**54 文件 / 80521 tokens / 0 克隆**
- 同一棵树在 `--min-tokens 30 --min-lines 5` 下：**283 文件 / 52696 行 / 113 克隆 / 866 行重复（1.64%）**，最大克隆 55 tokens
- 实测出的真实跨文件克隆（部分）：`patent-tools/src/tool/generate-patent-figure.ts[845:182-852:22] ↔ generate-structure-figure.ts[300:96-307:22]`；`patent-tools/src/tool/patent-pdf-download.ts[172:1-177:19] ↔ tool-literature/src/tool/paper-download.ts[78:1-90:19]`；`patent-tools/src/tool/patent-case-search.ts[140:117-148:76] ↔ patent-wiki-search.ts[117:104-125:76]`；`patent-tools/src/tool/patent-flexible-plan.ts[64:36-76:35] ↔ patent-workflow/src/flexible-plan.ts[33:27-41:35]`
- 单侧 `jscpd:ignore` 标记：`patent-workflow/src/invariant.ts`、`tool-literature/src/tool/paper-download.ts:106,123`、`patent-data/src/ego-session.ts` 有标记，其对端（`patent-teams/src/invariant.ts`、`patent-tools/src/tool/patent-pdf-download.ts`）无标记

**症状 → 根因 → 后果 → 修法**

症状是 `pnpm run duplication` 对一整域报 0，而降低阈值后同一棵树立刻报出 113 处。根因有二：① `minTokens: 60` 高于该域内**所有**克隆的实际长度（最大 55）；② 仓库用 `jscpd:ignore` 标记登记「承认但暂不收敛」的重复，但标记只加在一侧——被标记的一侧内容被掩码后，整对就不会被报出。后者让标记从「登记豁免」退化为「静默隐藏」。

后果是重复率门禁对专利域（以及任何使用单侧标记的对）给出假绿灯，而重复正是本报告另外 5 条发现（PDR-08/09/15/17/18）的共同载体。

修法（三选一，需与本报告其他收敛项配套落地）：① 先落地 PDR-08/09 的共享抽取，再考虑收紧阈值；② 把 `minTokens` 降到 30 并为专利域设白名单基线；③ 强制「跨包重复的两侧都加标记」并在标记文本里写明对称对象。任一方案都要配一条负例测试（注入 30-token 的跨文件重复必须失败），否则阈值会再次静默漂移。同时记录：`.jscpd.json:8-10` 的 `ignorePattern` 对标记无额外作用（检测器自身识别标记）。

**影响面**：`.jscpd.json` 语义变更会让全仓历史重复一次性浮现，需分批基线；`docs/TECH_DEBT.md` 补一条。**风险** 中 · **工作量** M · **置信度** 高

### PDR-03 两套数值范围语法分叉，同一文本两条生产路径结论相反

**证据**
- [`patent-core/src/novelty/numeric-range.ts:85`](../../packages/patent/patent-core/src/novelty/numeric-range.ts)：
  `const RANGE_PATTERN = /(\d+(?:\.\d+)?)\s*(?:[-–—~～]|至|到)\s*(\d+(?:\.\d+)?)/g` —— **单位非必需**，连接符含 `- – — ~ ～ 至 到`，单位在匹配片段之后另行读取（`:119` `DEGREE_UNITS = new Set(['℃', '°c', '°'])`）
- [`patent-tools/src/tool/validate-specification.ts:129`](../../packages/patent/patent-tools/src/tool/validate-specification.ts)：
  `RANGE_PATTERN` 用 `UNITS`（`:126`）拼装，**要求尾随单位**；连接符仅 `[~～至\-—]`（无 `到`、无 `–`）；单位归一用 `normalizeUnit`（`:159`）的 `['℃','°C','°']`（无 `°c`）
- 两侧均为生产路径：`patent-core/src/graph/domains/novelty.ts:86`（新颖性图节点）与 `validate-specification.ts:207`（工具输出）

**症状 → 根因 → 后果 → 修法**

症状是同一句「温度为 20℃ 至 90℃」在 novelty 侧被拆成两个强「数值点」（单位夹在数字与连接符之间，`RANGE_PATTERN` 不匹配，退化到 `PLAIN_NUMBER_PATTERN`），在规格校验侧被识别为一个区间；而「重量比 50-80」这类无单位区间在规格校验侧完全不被识别、在 novelty 侧被识别。根因是「数值范围语法」这一词表在两个模块各写一份，只共享了「单位归一」一条（`numeric-range.ts:119` 的注释也仅声明这一条一致）。

后果是同一专利文本在两条生产路径上给出互相矛盾的结论，且 novelty 侧是新颖性判定的输入——这是正确性问题，不只是风格问题。

修法：把连接符集、单位是否可选、单位归一（含 `℃/°C/°c/°`）收敛为 `patent-core` 的一个共享模块（例如 `src/novelty/numeric-vocabulary.ts`，或由 `numeric-range.ts` 导出 `RANGE_SYNTAX`），`validate-specification.ts` 改为 import 并在其上叠加「必须带单位」的本地约束；为四类语法（`20℃至90℃`、`50-80`、`20到90℃`、`25°c`）各加一条双解析器对拍用例。

**影响面**：`patent-core`（novelty 域节点与 spec）、`patent-tools`（`validate_specification` 输出、`patent_analysis_report` 汇聚）、`patent-workflow`（新颖性阶段结论）；工具输出文案可能变化。**风险** 中 · **工作量** M · **置信度** 高

**验证方式**：`pnpm exec vitest run packages/patent/patent-core/tests/novelty/numeric-range.spec.ts packages/patent/patent-tools/tests/validate-specification.spec.ts`

### PDR-04 `patent-teams` invariant 覆盖 7/9 事件类型，文档过度承诺

**证据**
- [`patent-teams/src/invariant.ts:1-9`](../../packages/patent/patent-teams/src/invariant.ts) 模块文档：「it validates **every payload on load and on append**」
- [`patent-teams/src/event-types.ts:111-151`](../../packages/patent/patent-teams/src/event-types.ts) 声明 **9** 个 `patent-teams/*` 类型；[`invariant.ts:112-133`](../../packages/patent/patent-teams/src/invariant.ts) 的 switch 只有 **7** 个 `case`，`patent-teams/task-validated` 与 `patent-teams/task-gated` 落入 `default: break`
- 两者都是生产事件：[`patent-teams/src/service.ts:821`](../../packages/patent/patent-teams/src/service.ts)（`task-gated`）、[`:863`](../../packages/patent/patent-teams/src/service.ts)（`task-validated`）

**症状 → 根因 → 后果 → 修法**

症状是「守卫」宣称覆盖全部载荷，实际有两个类型完全不校验。可证伪：向会话日志写入畸形 `patent-teams/task-validated` 载荷（例如 `worker: 42, valid: 'yes'`）再跑装载期校验，**不会失败**。

根因是 `install`（`invariant.ts:139-149`）把两半不同边界的事情写在一个文件里并统一声明：`snapshotEvents()` 扫描（`:140-142`）坐在 **durable 会话日志**边界，必须校验；`internal/dispatch` 监听（`:144-148`）只观测同进程内由类型化生产者在 `service.ts` 构造的载荷，属同进程 typed 边界，而它的唯一可观测效果是把一条 `ignorable` 信息性记录降级为 warn 后丢弃（[`2026-08-27-patent-teams-ignorable-session-events`](../../.agents/notes/implemented/bug-fix/2026-08-27-patent-teams-ignorable-session-events.md) 已裁定磁盘状态权威、事件可忽略）。

按「`./invariant` 只在比较可独立产生且可能分叉的观测时才有用」判定：append 半段不构成分叉观测比较（不存在第二个可独立产生、可能分叉的观测来源），装载期半段构成（durable 日志可被外部改写）。

修法：① 补 `task-validated` / `task-gated` 两个 validator，装载期覆盖补齐到 9 个类型；② 删除 `internal/dispatch` 分支，或保留但把文档改为「装载期校验；append 仅记录异常」；③ 测试头（`tests/invariant.spec.ts:5-6`）改为描述装载期校验集合；④ 与 `patent-workflow/src/invariant.ts` 的 install 骨架重复一并处理（该侧有 `jscpd:ignore` 且对侧无，见 PDR-02）。

**影响面**：`patent-teams`（invariant + spec）；`ui-patent-teams` 的 fold 测试无需变更。**风险** 低 · **工作量** S · **置信度** 高

### PDR-05 `merge.ts` 的 `asArray` 文档与实现相反，existing 非数组被静默丢弃

**证据**
- [`patent-core/src/graph/merge.ts:16-19`](../../packages/patent/patent-core/src/graph/merge.ts)：
  `/** 把单值转为数组（append/union 用）；已是数组原样返回。 */ function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }`
- `appendValue`（`:22-24`）用 `asArray(existing)` 后把 `value` 整体作为单元素追加；`unionValues`（`:27-37`）用 `asArray(existing)` 但把 incoming 非数组包装为 `[value]`
- 初始状态由调用方提供：`graph/engine.ts` 的 `run(initial: GraphState, …)`，`:263` 才进入 `mergeWithSchema`

**症状 → 根因 → 后果 → 修法**

症状是注释承诺「单值转数组」，实现把单值变成 `[]`；同一输入在两个 reducer 下处理方式相反。根因是归一化只做了一半：existing 侧假设历史值一定是数组（对 `append`/`union` 自身产生的值成立），对调用方 seed 的初始状态不成立。后果是一旦某 key 的初始值是非数组标量，`append`/`union` 会**静默丢弃**它（无警告、无断言），而 `last_write_wins`/`merge_map`/`fail_on_conflict` 不受影响——形成只在特定初始状态下出现的状态丢失。

修法：把函数改名为 `existingArray` 并把注释写成事实（「历史值非数组时视为空」），或在 reducer 首次写入时把非数组 existing 显式包装为 `[existing]`（与 `union` 的 incoming 侧对齐）；两种选择都应在 `tests/graph/merge.spec.ts` 增加「初始状态为标量」的用例把语义钉住。

**影响面**：`patent-core` 图引擎与所有用 `append`/`union` 的图（`patent-workflow` 阶段图）。**风险** 中 · **工作量** S · **置信度** 高

### PDR-06 `ipc-standards.yaml` 1782 行双副本 + 不可达候选 + 失效豁免理由

**证据**
- `packages/patent/patent-core/assets/ipc-standards.yaml` 与 `packages/patent/patent-core/src/ipc/ipc-standards.yaml`：各 1782 行，**sha 相同**（`1f2d9e4c8a2b`）
- [`ipc-standards-loader.ts:16-30`](../../packages/patent/patent-core/src/ipc/ipc-standards-loader.ts) 三个候选：`:18` `../../../assets/`、`:19` `../assets/`、`:20` `./ipc-standards.yaml`
- 存在性实测（源树布局）：`packages/patent/assets/ipc-standards.yaml` **不存在**（即 `:18` 的候选一）；`patent-core/src/assets/` **不存在**；`:20` 与 `assets/` 两处**存在**
- 打包布局：`package.json` `files: ["lib/index.js","assets","lib/types/**/*.d.ts"]`，`lib/` 为单文件 bundle（无 `lib/ipc/`）

**症状 → 根因 → 后果 → 修法**

必须修正一个容易得出的错误结论（子代理审阅曾如此判定）：**源树的 `src/ipc/ipc-standards.yaml` 并非死副本**。按 `import.meta.url` 解析，源树（`src/ipc/`）命中候选三（`:20`），打包后的单文件 bundle（`lib/index.js`）命中候选二（`:19`），两个平面各用一份，两份都是活的。

真正的问题有三：① **候选一（`:18`）在两个布局下都不存在**——它解析到 `packages/patent/assets/`，该目录不存在；② 挂在候选一与末尾 throw 上的两条 `v8 ignore` 理由（`:24`「the first candidate always exists in the shipped package layout」、`:27`）与事实相反，而注释在本仓承担契约职责；③ 同一份 1782 行数据在两处维护，**改一份不会让任何测试发现另一份变旧**（两条读路径各自读自己那一份）。

修法：删除不可达的候选一与两条失效的 `v8 ignore`；在 loader 文档里写明「源运行读 `src/ipc/`，打包运行读 `assets/`」这一事实；加一条 spec 断言两份副本内容一致（或断言 `src/ipc/` 下不存在副本，若决定只保留 `assets/` 一份并让源树也走 `../assets/`）。

**影响面**：`patent-core` 单包（一个候选删除 + loader 文档 + 一条新 spec）。**风险** 低 · **工作量** S · **置信度** 高

### PDR-07 两处 `v8 ignore` 理由与被豁免代码不符

**证据**
- [`service.ts:828-838`](../../packages/patent/patent-teams/src/service.ts)：`// v8 ignore start -- the task is still in a non-terminal status, so attempt/attemptId are always set`，但被豁免的返回体写的是 `attempt: task.attempt ?? 0` 与条件展开 `...task.attemptId === undefined ? {} : { attempt_id: task.attemptId }`——代码本身不依赖该断言
- [`service.ts:853-861`](../../packages/patent/patent-teams/src/service.ts)：`// v8 ignore start -- an updatable task always carries assignee/attempt/attemptId`，但被豁免的 `patent-teams/task-updated` 载荷**完全没有** `attempt`/`attemptId` 字段（只有 `status`/`assignee`/`output`）

**症状 → 根因 → 后果 → 修法**

症状是豁免理由与被豁免代码不对应。根因是理由描述的是另一个版本的载荷/返回体（或复制残留），无人复核。后果有二：① 读者会把「attempt/attemptId 恒有」当作契约，而 `invariant.ts:85-87` 正在校验这两个生产侧从不写出的可选字段——两处错误互相强化，形成「永不执行的分支 + 看似有校验」的假象；② 覆盖率豁免理由一旦失效，就无法判断该分支该不该补测。

修法：把两处理由改为本地事实并实际验证；验证不了就删除 `v8 ignore` 让门禁说话。同时决定 `invariant.ts` 侧 `attempt/attemptId` 是保留还是删除（取决于是否真有生产者）。**不做**：仅为消除 `v8 ignore` 而新增覆盖率专用测试。

**影响面**：`patent-teams` service/invariant 注释；该族仍在 exclude 内，删除 ignore 不会改变当前门禁结果。**风险** 低 · **工作量** S · **置信度** 高

### PDR-08 `assertRendered` 与 `resolveInvention` 各两份（同包）

**证据**
- [`generate-structure-figure.ts:151`](../../packages/patent/patent-tools/src/tool/generate-structure-figure.ts) 与 [`generate-patent-figure.ts:459`](../../packages/patent/patent-tools/src/tool/generate-patent-figure.ts)：`assertRendered` 的 JSDoc（「渲染失败统一映射：not_installed→setup_required / aborted→tool_aborted / 其余→tool_execution_failed。」）与四路映射完全相同，仅 outcome 类型名与 4 处工具名字面量不同
- `generate-structure-figure.ts:163` 与 `generate-patent-figure.ts:340`：`resolveInvention` 逐字相同
- 共享落点已存在：`patent-tools/src/figure/subprocess-render.ts`（模块文档声明两个渲染器「只在可执行文件解析、argv 与产物校验上不同，共用部分必须保持同一条判定语义」）
- 现行 `jscpd` 配置**报不出这一对**（PDR-02）

**症状 → 根因 → 后果 → 修法**

症状是同一错误契约写两遍；根因是两个工具分属不同文件、共享模块只抽了渲染语义没抽错误映射。后果是两处可独立漂移（历史上已发生一次同类收敛），且因为字面量不同，治理中的重复检测看不见它。

修法：在 `figure/subprocess-render.ts`（或同目录 `tool-error.ts`）导出按工具名参数化的共享函数：
```ts
export function assertRendered<T extends RenderOutcome>(outcome: T, tool: FigureToolName): asserts outcome is Extract<T, { ok: true }> {
  if (outcome.ok) return
  if (outcome.code === 'not_installed') throw new PatentToolError('setup_required', outcome.error, { tool })
  if (outcome.code === 'aborted') throw new PatentToolError('tool_aborted', `${tool} aborted`, { tool })
  throw new PatentToolError('tool_execution_failed', outcome.error, { tool })
}
```
`resolveInvention` 一并移入共享模块（两工具均已依赖 `patent-core`）。落地前先确认两个 outcome 类型的 `code` 联合等价（`rg -n "RenderOutcome" packages/patent/patent-tools/src/figure`）。

**影响面**：两个工具文件与 `figure/` 目录、`tests/structure-figure-tool.spec.ts` 与 figure 渲染器的错误映射断言；工具输出文案不变。**风险** 低 · **工作量** S · **置信度** 高

### PDR-09 跨包 PDF 体三检与 `datePartOf` 双份，`jscpd:ignore` 只加一侧

**证据**
- `patent-tools/src/tool/patent-pdf-download.ts:41` `PDF_MAGIC`、`:43` `MIN_PDF_BYTES = 500`、`:336-345` 的 Content-Type/最小字节/魔数三检（`failed(...)` 风格）
- `tool-literature/src/tool/paper-download.ts:20` `PDF_MAGIC`、`:22` `MIN_PDF_BYTES = 500`、`:112-120` 同一三检（`throw new Error(...)` 风格），`:105` 注释自述「与 patent_pdf_download 的 fetchPdfFallback 对称」，`:106`/`:123` 包裹 `jscpd:ignore-start/end`
- 第二对：`paper-download.ts:82` 与 `patent-pdf-download.ts:170` 的 `datePartOf`（同名同实现）
- 降低阈值后 jscpd 报出该对：`patent-pdf-download.ts[172:1-177:19] ↔ paper-download.ts[78:1-90:19]`

**症状 → 根因 → 后果 → 修法**

症状是「必须保持一致」的三条判定 + 一个日期片段各写两遍；根因是两工具错误风格不同（一侧 `throw`、一侧 `failed(...)`），各自演化。后果是允许集（Content-Type 判定、最小字节、魔数）与文案可独立漂移，而「对称」只靠注释与单侧标记维持——标记还让治理中的重复检测看不见它。

修法：抽 `verifyPdfBody(buf, contentType): { ok: true } | { ok: false; reason: string }` 与 `datePartOf` 到共享模块（放 `patent-core`，两包均已依赖或可依赖）；错误文案由调用方按各自风格包裹。若依赖方向不允许，则两侧都加标记并在标记文本里写明对称对象。

**影响面**：两个工具的下载路径与错误文案测试；下载结果结构不变。**风险** 低 · **工作量** S · **置信度** 高

### PDR-10 `tool-literature` 的网络预算无 `Config` 出口

**证据**
- `tool-literature/src/runtime/http.ts:70-72`：`DEFAULT_TIMEOUT_MS = 30_000`、`DEFAULT_CACHE_TTL_MS = 5 * 60_000`、`DEFAULT_RETRY = { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 15_000 }`（`:176`/`:203`/`:206` 作为 `??` 默认值消费）
- `tool-literature/src/network-fetch.ts:44-46`：`DEFAULT_BASE_DELAY_MS`、`DEFAULT_MAX_DELAY_MS`、`DEFAULT_RETRY_STATUSES`
- `tool-literature/src/index.ts:52-76`：`Config` 只有 6 个字段（4 个连接器开关 + `openalexMailto` + `semanticScholarApiKey`），**无任何超时/重试/缓存出口**；`literatureFetch` 的 `opts.timeoutMs`/`cacheTtlMs`/`retry` 在生产路径没有调用方设置

**症状 → 根因 → 后果 → 修法**

按「插件不硬编码可调参数」判定：30s 超时、5 分钟缓存、3 次/15s 上限的重试预算会随部署网络（代理、内网镜像、离线/限流环境）改变，且三者互相耦合（超时 × 重试 = 最坏延迟），属「随部署变化」而非「协议常量」。后果是部署无法调整：慢网整体失败，快网也吃满重试；离线部署无法缩短缓存或关闭重试。

修法：把 `timeoutMs`、`cacheTtlMs`、`retry`（`maxRetries`/`baseDelayMs`/`maxDelayMs`）提升为 `Config` 字段（现有 `DEFAULT_*` 作为默认值），由插件在构造时注入。若维护者认定它们是外部源配额的一部分，应在包 README 与 `Config` 注释里明确登记为固定规格并写出豁免理由。

**影响面**：`tool-literature`（`index.ts` Config + 注入链）与生成的配置目录（`docs/config-catalog.md`）。**风险** 低 · **工作量** S · **置信度** 中（取决于维护者对「协议常量」的界定）

### PDR-11 `loadIpcStandards(overridePath)` 的 override 自第二次调用起被静默忽略

**证据**
- [`ipc-standards-loader.ts:64-68`](../../packages/patent/patent-core/src/ipc/ipc-standards-loader.ts)：JSDoc 承诺 `@param overridePath - 可选：覆盖默认 YAML 资产路径。`，但 `let cachedIndex` 之后是 `if (cachedIndex) return cachedIndex`——`overridePath` 未纳入缓存键

**症状 → 根因 → 后果 → 修法**

症状是「先默认后 override」与「先 override 后默认」两种调用顺序在同一进程内产生不同结果，且首次调用决定全进程数据、无任何提示。根因是缓存键漏掉了一个影响结果的参数。生产路径不传 override（风险限于测试顺序敏感），但这是文档承诺与实现不符的契约缺陷，且顺序依赖会在测试并行时制造难复现的失败。

修法：只缓存默认路径——`if (overridePath === undefined && cachedIndex) return cachedIndex`；若确实需要按路径缓存，则把 `overridePath` 作为缓存键并显式声明进程内多份索引。

**影响面**：`patent-core` 一个模块与其两个 spec；生产行为不变。**风险** 低 · **工作量** S · **置信度** 高

### PDR-12 FreeCAD real-render 子进程在并发/重负载下失败

**证据**
- 基线：`pnpm vitest run packages/patent` → 214 文件 / 2751 用例全绿；随发行配置的覆盖率同样全绿
- 一次带覆盖率插桩的运行中，[`figure-freecad-real-render.spec.ts:95`](../../packages/patent/patent-tools/tests/figure-freecad-real-render.spec.ts) 失败：
  `OSError: Cannot copy file from /var/folders/…/T/dsh-freecadreal-t1V7N8/.freecad-structure-template.svg to /.freecad-structure-template.svg`，错误码 `render_failed`；同一条用例单独重跑**通过**
- 同一 failure 的首行是 `Failed to create '/Users/…/Caches/FreeCAD/v1-1/Cache/FreeCAD_Doc_<uuid>_<uuid>_916159'`
- 脚本内已有的缓解注释：[`freecad-structure-script.ts:374-376`](../../packages/patent/patent-tools/src/figure/freecad-structure-script.ts) 「TechDraw 重算时会把模板拷进『文档所在目录』；内存文档无文件名会解析到根目录（/）导致拷贝失败，故给文档一个 outputDir 内的文件名作为拷贝基准」——而实测失败的拷贝目标正是 `/`

**症状 → 根因 → 后果 → 修法**

症状是「单独跑通过、并发跑失败」，正是 `packages/AGENTS.md` 判定为 spec 缺陷的形态（「a spec that passes only when run alone is a defect in the spec」）。根因链的**第一环**已由错误文本证实在 FreeCAD 自身的缓存目录创建失败（`Failed to create …/Caches/FreeCAD/…`，疑似并发 `freecadcmd` 实例竞争同一缓存/临时路径）；缓存创建失败后文档失去文件名，模板拷贝目标退回 `/`，脚本内的 `doc.FileName = …` 缓解因此来不及生效。

后果有二：① 该 spec 是 `freecad-renderer.ts` 唯一的真实端到端覆盖，失败即整条链路无信号；② 由于 `patent/*/src` 已被排除出覆盖率测量（PDR-01），一次偶发失败不会留下任何持久记录。

修法：先做确定性复现——用 `--maxWorkers`/连续两次并发运行固定该失败；确认是缓存路径竞争后，把 FreeCAD 的缓存/临时目录**按 spec 隔离**（每个 worker 独立 `TMPDIR` 或 FreeCAD 用户目录），或改为串行套件并在文件头写明理由。若确认是 FreeCAD 侧不可控竞争，则把该 spec 标记为需要显式 opt-in（保留 `skipIf` 语义但由 CI 变量开启），并在注释里登记「并发下不可靠」这一事实。

**影响面**：该 spec 与 `freecad-renderer.ts` 的调用参数；CI 若安装 FreeCAD 需要新的隔离约定。**风险** 中 · **工作量** M · **置信度** 中（失败已复现一次、根因链第一环有错误文本支持，但未做确定性并发复现）

### PDR-13 四个多职责耦合文件与拆分边界

**证据**（行数为当前树实测）

真问题（多职责）：
- `patent-teams/src/service.ts`（1382 行）：团队生命周期 + 任务状态机 + 契约校验/质量门 + 成员运行时 + 状态归档；PDR-07 的两处失效豁免正是这种牵制的产物
- `patent-teams/src/state.ts`（907 行）：团队持久化 + mailbox lease 协议 + 任务转移 + key 哈希 + 锁与原子写
- `patent-core/src/evidence/engine.ts`（876 行）：资产解析（含 `parseRuleSet`）与 `EvidenceEngine` 两类职责
- `patent-tools/src/tool/validate-specification.ts`（842 行）：约 8 个独立 checker + 自带数值词表（PDR-03）

可接受（体量大但单一职责，**不应拆**）：`patent-core/src/ipc/ipc-classifier.ts`（809 行，约 700 行数据表 + 逻辑）、`patent-deadline/src/statutes.ts`（765 行，法定期限数据 + `evaluateDeadlines`）、`patent-tools/src/figure/leader-line.ts`（906 行，纯几何）、`patent-tools/src/figure/dot-builder.ts`（672 行，DOT 构建 + 标号分配）

**症状 → 根因 → 后果 → 修法**

症状是「文件大」，但只有前四个是**多职责**（改 A 必须读懂 B 的状态与错误语义）。根因是功能按「入口」聚合而非按「变化原因」聚合。后果是一次改动的影响面无法收敛，锁序/超时/门禁语义互相牵制。

修法（按收益排序）：① `state.ts` 抽出 `team-lock.ts`（`withTeamLock`/`atomicWriteText`/`replaceFileAtomicOrDirect`）与 `mailbox.ts`（lease/TTL/投递状态）；② `service.ts` 抽出 `task-ops.ts`（claim/update/validate/gate 分支）与 `member-runtime.ts`；③ `evidence/engine.ts` 把 `parseRuleSet` 及其校验搬到 `evidence/rule-set.ts`；④ `validate-specification.ts` 按 checker 拆文件并把数值词表并入 PDR-03 的共享模块。

**影响面**：`patent-teams`（service/state 及其 spec）、`patent-core`（evidence 测试）、`patent-tools`（validate-specification 与 figure 测试）；纯搬移时测试与快照应保持绿。**风险** 中 · **工作量** L · **置信度** 中

**验证方式**：每步后 `pnpm exec vitest run packages/patent` + `pnpm run typecheck`；结构变化不产生行为差异时 `pnpm run duplication` 仍应为 0。

### PDR-14 38 个函数/方法超过 80 行，最大 317 行

**证据**（花括号配对实测，覆盖 1618 个函数/方法；`src` 全族）

| 行数 | 位置 | 名称 |
|---|---|---|
| 317 | `patent-teams/src/tools.ts:95` | `registerPatentTeamsTools` |
| 298 | `patent-deadline/src/statutes.ts:201` | `evaluateDeadlines` |
| 264 | `patent-workflow/src/worker-contract.ts:228` | `defaultPatentWorkers` |
| 237 | `patent-tools/src/tool/generate-patent-figure.ts:802` | `createGeneratePatentFigureTool` |
| 210 | `patent-teams/src/scheduler.ts:119` | `installTeamScheduler` |
| 193 | `patent-core/src/graph/domains/inventiveness.ts:103` | `buildInventivenessGraph` |
| 184 | `patent-tools/src/tool/validate-specification.ts:388` | `validateSpecification` |

**症状 → 根因 → 后果 → 修法**

需要区分两类：`createXTool` 形态的长函数主体是 schema 与注册样板，逻辑分支少、阅读成本主要来自字面量体积，收益低；**逻辑型**长函数才是真问题——`evaluateDeadlines`(298)、`buildInventivenessGraph`(193)、`registerPatentTeamsTools`(317)、`installTeamScheduler`(210)、`validateSpecification`(184)。

修法：仅对逻辑型长函数抽取具名步骤函数（每个步骤一个新名字即一处职责边界），不为降低行数而拆散 schema 字面量。优先级与 PDR-13 合并处理：`evaluateDeadlines` 与 `validateSpecification` 在 PDR-13 的拆分中一并落地。

**风险** 低 · **工作量** L · **置信度** 高

### PDR-15 同包守卫重复

**证据**：`patent-teams/src/invariant.ts:28` 与 `patent-teams/src/state.ts:707` 的 `isOptionalString` 定义逐字相同；`invariant.ts:23` 的 `isNonEmptyString` 与 `state.ts:719-723`/`:758-765` 内联的 `typeof x === 'string' && x.trim() !== ''` 判断重复。共享包 `@deepseek-ai/dsh-value` 的导出面不含字符串谓词，因此不能按 `asRecord` 那样下沉。

**修法**：新建 `patent-teams/src/guards.ts` 导出 `isNonEmptyString`/`isOptionalString`，`state.ts` 的内联判断替换为调用，`invariant.ts` 从该模块导入（伴生插件允许依赖本包 `src`）。

**风险** 低 · **工作量** S · **置信度** 高 · **验证**：`pnpm exec vitest run packages/patent/patent-teams/tests`

### PDR-16 两处闭合联合未使用共享 `assertNever`

**证据**：`patent-core/src/graph/merge.ts:85` 与 `patent-core/src/checker/engine.ts:240` 都是手写 `const exhaustive: never = <值>; throw new Error(...)`。仓库其余闭合联合 switch 均以共享 `assertNever` 收尾；`docs/TECH_DEBT.md` 已记录 `assertNever` 收敛，但未覆盖这两处。

**修法**：改用 `assertNever`；若必须保留 `GraphMergeError` 领域错误类型（已有测试断言），则在 `assertNever` 之后补一行转换，或就地加注释登记为例外。不要维持现状的沉默偏离。

**风险** 低 · **工作量** S · **置信度** 高 · **验证**：`pnpm exec vitest run packages/patent/patent-core/tests`

### PDR-17 三份 asset-location 模块实现同一解析契约

**证据**
- `patent-deadline/src/asset-location.ts`（29 行）与 `writing-patterns/src/asset-location.ts`（29 行）：模块文档、`ASSETS_*_URL = new URL('../assets/<x>/', import.meta.url)`、`return dir !== undefined && dir.trim() !== '' ? resolve(dir) : fileURLToPath(URL)` 三段逐字同构，仅常量名与函数名不同
- `patent-rule/src/asset-location.ts`（72 行）：同一契约的扩展版（多出 `candidateRuleDirs`/`candidatePackDirs`）
- 相关但不对称：`patent-core/src/ipc/ipc-standards-loader.ts:18-20` 用三候选、`patent-document/src/document/templateResolver.ts:24-25` 用两候选——候选数实际由「模块在 `src/` 下的深度」导出，这一不对称可解释，但未在任何地方写明

**修法**：把「显式覆盖优先，否则 `../assets/<name>/`」抽为一个共享原语（放 `@deepseek-ai/dsh-util-values` 或 `patent-core`），三处改为一行的调用；同时把「候选数取决于模块深度」这条规则写进原语文档，供 `patent-core`/`patent-document` 的多候选站点引用。

**风险** 低 · **工作量** S · **置信度** 高

### PDR-18 `methodology` 8/8 组件的 `identify` 同构

**证据**：`methodology/src/runtime/components/` 下 8 个组件文件的 `identify(context)` 全部是 `return keywordScore(context, TRIGGERS)`（实测 8/8），差异只在各文件的 `TRIGGERS` 常量与 `execute` 返回的 prompt 文本。

**修法**：把 `identify` 提升为 `MethodologyComponent` 的默认实现（工厂函数或注册表在装配时补默认值），组件文件只声明 `name`/`description`/`category`/`applicableDomains`/`TRIGGERS`/`execute`。属于机械收敛，不改变模型可见文本。

**风险** 低 · **工作量** S · **置信度** 高

### PDR-19 注释中的移植差异叙述与未来计划残留

**证据**（逐条甄别后的真问题，不是全部「与上游」字样）
- `patent-data/src/ego-session.ts:209-210`：`jscpd:ignore-start — platform command resolution kept per-domain (browser-backend carries its own copy); the shared home is a future util-group extraction.` —— **未来计划残留**（对端确实存在：`packages/browser/browser-backend/src/ego-backend.ts:51`）
- `patent-rule/src/asset-location.ts:4-8`：以「与 Sati 的 asset-location.js 不同，本实现放弃 … 语义」开篇——**变更叙事**，读者需要的是当前契约（覆盖项与解析基准）
- `patent-rule/src/runtime/patent-compliance.ts:33`：「`assets/patent-rules/` 原始资产未随移植带入本仓，故各文件头部注释描述的生成流程在本仓不适用」——**外部来源叙述**混入契约位

**不判定为问题**：资产来源标注（如 `RuleLoader.ts:461` 说明 `assets/rules/patent/nuo-*.yaml` 是上游生成物的逐字镜像、`methodology` 各组件的「Ported from Sati's …」）——在本仓是可维护事实（再同步时的对端位置），保留。

**修法**：把上述三类改为现状陈述或删除；「未来要搬到哪」不属于注释。建议并入一次性的注释清扫，不单独立项。

**风险** 低 · **工作量** S · **置信度** 中

## 5. 已排除项（考虑过但按仓库规范否决）

| 候选 | 否决理由 |
|---|---|
| `writing-patterns/src/pattern-store.ts:348` 的 `asRecord(value, source, field)` | durable YAML 资产边界校验：抛带来源标签的 `PatternAssetError` 并拒绝数组，语义与 `dsh-value.asRecord` 的静默收窄既非子集也非超集，不是副本 |
| `patent-core/src/evidence/engine.ts:456` 的 `asStringArray`、`patent-rule/src/runtime/RuleLoader.ts:85` 的 `isRecordOfStrings` | 均为规则资产/模型 JSON 边界的归一化（规范允许校验），且两者形态不同（记录值数组 vs 字符串数组），合并无收益 |
| `patent-knowledge` 的 `src/shared/kg/row-mapper.ts` 与 `src/legal/row-mapper.ts` | 映射不同的表与 DTO（`kg_nodes` → `KgNode`；`law` 联查 → `LawRecord`），无共享词汇 |
| `RuleLoader.ts`(557) 与 `wiki-card-loader.ts`(462) 的加载器重复 | 资产格式与校验目标不同（规则卡 / 维基卡 / SQLite store），无共同 seam，强行统一会引入跨域 schema |
| 跨包 HTTP/重试重复（4 个 connector、`network-fetch.ts`、`runtime/http.ts`、`subprocess-runner.ts`） | 重试/退避/超时/缓存只有一份实现；下载工具复用 `networkFetch`；`subprocess-runner` 属子进程生命周期而非 HTTP |
| 3 处 `describe.skipIf`（`figure-graphviz-real-render.spec.ts:62,190`、`figure-freecad-real-render.spec.ts:72`） | 合法的外部二进制能力探测。真正的问题是 PDR-01/PDR-12（CI 不见该路径、并发下不可靠），不是跳过本身 |
| `patent-data/src/ego-session.ts:16-19`、`subprocess-runner.ts:12-15` 的 `DEFAULT_*` | 库级默认且逐次调用可被工具输入覆盖，不构成静默硬编码 |
| `patent-tools/src/tool/patent-pdf-download.ts:32-47` 的 UA/`PDF_MAGIC`/`MIN_PDF_BYTES` | UA 是 CDN 行为规格、魔数与最小字节是内容格式不变量、超时有工具输入出口 |
| `svg-annotate.ts:44` 的 `DEFAULT_SVG_MAX_BYTES`、`dot-builder.ts:56` 的 `DEFAULT_NUMERAL_STEP` | 前者是安全不变量，后者有 `numeral_step` 工具输入可覆盖 |
| `writing-patterns/src/index.ts:68,71` 的 `DEFAULT_MATCH_LIMIT`/`DEFAULT_SECTION_ORDER` | 二者已是 `Config` 字段（`:90`/`:93`）的默认值，已满足规范 |
| `ipc-standards-loader.ts:96-107` 查询侧 `toUpperCase()` 与 `bySection` 键不归一 | 现有 YAML 的 `ipcSection` 全为大写 A–H，无实际影响，仅记录潜在不对称 |
| `.jscpd.json:8-10` 的 `ignorePattern` | 检测器自身识别 `jscpd:ignore` 标记（无该配置亦生效），条目冗余但无害 |
| `patent-teams/src/service.ts:1265-1295` 团队侧 rule-gate `needsApproval → bounce` 与工具侧语义不同 | 有就地注释说明的设计选择，无契约违约证据 |
| 本次 5 个未提交改动 | 计数 28→29 与 README/`tool-catalog`/registration 测试、`structureFigureEnabled` 与 `config-catalog`/preset 注释均自洽 |

## 6. 无法判定项

1. **覆盖率缺口的具体量化**：因该族被排除出测量（PDR-01），只有「逐包移出 exclude 后重跑」才能得到每文件缺口。本报告给出的是补测优先级，不是量化结论。
2. **打包产物内的资产解析**：PDR-06 中「源树命中候选三、打包命中候选二」由 `files`/`exports`/单文件 bundle 与路径解析推导，严格证据需 `pnpm build` 后实跑 `loadIpcStandards()`（本次未构建）。
3. **PDR-12 的确定性复现**：失败已出现一次、根因链第一环有错误文本支持，但未做 `--maxWorkers` 固定条件下的重复复现；「FreeCAD 缓存路径竞争」是当前最强假设而非已证结论。
4. **`.jscpd.json` 的 `mode` 归一效果**：实测本机 jscpd 5.0.12 下 `strict`/`mild`/`weak` 产出同一克隆集；是否为该构建特有行为需换版本对比（未验证）。本报告的 PDR-02 结论不依赖 `mode`，只依赖阈值与标记事实。
5. **`patent-knowledge` / `patent-rule` / `patent-deadline` / `methodology` / `patent-document` 的逐函数审阅深度**：这五包完成了消费者、重复、硬编码参数与结构扫描（结论见 §5 与阴性结果），未做到与 `patent-core`/`patent-tools` 同等深度的逐函数审阅。报告基于「无强候选」给出，不代表已穷尽。
6. **阴性结果声明**：`patent-knowledge` 未发现强候选——`src/shared/fts.ts`、`src/shared/fts-search.ts` 把 FTS5 降级阶梯正确抽为共享原语（`runFtsSearch` 供 legal 与 case-law 两条检索共用），是正面样本；两份 `row-mapper.ts` 已排除。`methodology`、`patent-document` 同样未发现强候选。

## 7. 改造计划

### 批 A —— 低风险、行为不变（可合并为一个 PR）

| 项 | 动作 | 验证 |
|---|---|---|
| PDR-15 | 抽出 `patent-teams/src/guards.ts` | `vitest run packages/patent/patent-teams/tests` |
| PDR-16 | 两处改用共享 `assertNever` | `vitest run packages/patent/patent-core/tests` |
| PDR-08 | 抽 `assertRendered`/`resolveInvention` 到共享模块 | `vitest run packages/patent/patent-tools/tests` |
| PDR-09 | 抽 `verifyPdfBody`/`datePartOf` 到共享模块 | `vitest run packages/patent/tool-literature/tests packages/patent/patent-tools/tests` |
| PDR-17 | 抽 asset-location 原语 | 三个包的 tests |
| PDR-18 | `identify` 提升为默认实现 | `vitest run packages/patent/methodology/tests` |
| PDR-05 | 对齐 `asArray` 语义与文档 + 新增标量初始状态用例 | `vitest run packages/patent/patent-core/tests/graph` |
| PDR-06 | 删不可达候选与失效 `v8 ignore` + 双副本一致性断言 | `vitest run packages/patent/patent-core/tests` |
| PDR-07 | 修正两处理由（或删除 ignore） | `vitest run packages/patent/patent-teams/tests` |
| PDR-11 | override 只缓存默认路径 | `vitest run packages/patent/patent-core/tests` |
| PDR-19 | 注释清扫 | `pnpm run lint` |
| PDR-04 | 补 2 个 validator + 收敛 append 半段 + 修正文档与测试头 | `vitest run packages/patent/patent-teams/tests` |

批 A 完成后必须复跑：`pnpm run duplication`（预期仍 0，因为抽出的共享函数本身不构成克隆）、`pnpm run lint`、`pnpm run typecheck`。

### 批 B —— 中风险（抽象折叠与结构收敛）

- PDR-03 数值范围共享词表（含四类语法对拍用例）——**建议最先做**，它是唯一已产生正确性分叉的项
- PDR-10 `tool-literature` 网络预算转 `Config`（含 `docs/config-catalog.md` 再生）
- PDR-13 上帝文件拆分（按 ① → ④ 顺序，每步一个提交）
- PDR-14 逻辑型长函数抽取（与 PDR-13 合并落地）
- PDR-12 FreeCAD spec 的并发隔离

### 批 C —— 需 Agent Note 的结构性改造

- PDR-01 覆盖率门禁：拆家族级 glob 为按包条目 + 逐包判定（见 §8 的 Agent Note 归属）
- PDR-02 重复检测：阈值与单侧标记策略 + 负例测试
- PDR-13 的 `patent-teams` 状态与服务分解（跨多个 spec，需要耐久决策记录）

### 验证矩阵（每批必跑）

| 门禁 | 命令 |
|---|---|
| 包级测试 | `pnpm vitest run packages/patent`（214 文件 / 2751 用例） |
| lint | `pnpm run lint` |
| 类型 | `pnpm run typecheck` |
| 重复 | `pnpm run duplication` |
| 文档 | `pnpm run doc-sync`（改 README/JSDoc/Agent Note 时） |
| 依赖 | `pnpm run hygiene`（改 `package.json` 时） |
| 模型可见输出 | `pnpm run test:snapshot -t patent`（任何改变工具输出/提示文本的改动；`snapshots/session/patent-*` 现存 8 组） |

## 8. Issue 与台账关联

- Issue 清单（含可直接粘贴的正文）：[`.agents/audits/2026-09-21-patent-domain-review-manifest.md`](2026-09-21-patent-domain-review-manifest.md)
- 台账：`docs/TECH_DEBT.md` 新增 `## 2026-09-21 更新(专利域代码审阅)` 一节
- Agent Note 归属：
  - PDR-01 → 更新既有 [`2026-08-26-hygiene-gate-debt-and-conflict`](../../.agents/notes/proposed/bug-fix/2026-08-26-hygiene-gate-debt-and-conflict.md)（该 note 的 coverage backlog 项 3 就是本项，不新建重复 note）
  - PDR-03 → 新建 `proposed/bug-fix/2026-09-21-patent-numeric-range-shared-vocabulary.md`
  - PDR-02 → 新建 `proposed/process/2026-09-21-duplication-detection-below-threshold.md`
  - PDR-13 → 新建 `proposed/architecture/2026-09-21-patent-teams-state-service-decomposition.md`

## 附录：方法与复现

```sh
# 门禁基线
pnpm run duplication && pnpm run hygiene && pnpm run test:docs && pnpm run lint && pnpm run typecheck

# 专利域测试基线（214 文件 / 2751 用例）
pnpm vitest run packages/patent

# 覆盖率实测（证明该族未被测量：summary 中 packages/patent 条目为 0）
pnpm vitest run --coverage --coverage.reporter=json-summary \
  --coverage.reportsDirectory=.dsh/reports/patent-domain-review/coverage packages/patent

# 重复实测（现行配置 0 克隆 vs 降阈值 113 克隆）
npx jscpd --config .jscpd.json packages/patent/patent-tools
npx jscpd --min-tokens 30 --min-lines 5 --mode mild --format typescript \
  --pattern "**/*.ts" --ignore "**/tests/**,**/tsdown.config.ts" \
  --reporters console --no-colors --exit-code 0 packages/patent
```

工具输出留存于 `.dsh/reports/patent-domain-review/`：`baseline/`（门禁与测试日志、覆盖率摘要）、`scan/`（各扫描线结果，含 `a-jscpd-30.txt` 全量克隆清单）。

静态基线：`src` 内 `any` 0 处、`TODO/FIXME/XXX` 0 处、`describe.skipIf` 3 处（均为外部二进制探测）、286 个 src 文件 / 约 53k 行、>400 行文件 30 个 / >200 行文件 85 个、函数/方法 1618 个（>80 行者 38 个）。
