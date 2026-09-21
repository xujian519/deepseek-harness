# 专利域代码审阅 — Issue 清单（2026-09-21）

- 审阅报告：[`.agents/audits/2026-09-21-patent-domain-review.md`](2026-09-21-patent-domain-review.md)
- 基线：`master` 分支（2026-09-21 审阅当日）（工作树含 5 个未提交的 `structureFigureEnabled` 相关改动，与本清单无关）
- 追踪器现状：当前最大 Issue 编号 **#171**（`gh issue list --state all`）；本清单从 **#172** 起编号
- 范围：`packages/patent/` 全族 12 包（`src` 约 53k 行 / 286 文件；测试 214 文件 / 2751 用例）
- 门禁基线：`duplication`/`hygiene`/`test:docs`/`lint`/`typecheck` 全 PASS，`vitest run packages/patent` 全绿 —— 下列问题均为门禁当前看不见的结构性问题

## 汇总

| # | 标题 | Issue Type | Labels | 优先级 | 严重度 | 证据位置 |
|---|---|---|---|---|---|---|
| #172 | 专利域整族被排除在覆盖率**测量**之外（非仅阈值外） | Task | kind/techdebt, area/patent | P1 | 严重 | `vitest.config.ts:215,230` |
| #173 | 重复检测阈值高于域内所有真实克隆，专利域系统性失明 | Task | kind/techdebt, area/patent | P1 | 严重 | `.jscpd.json:2-4` |
| #174 | 两套数值范围语法分叉，同一文本两条生产路径结论相反 | Bug | kind/bug-fix, area/patent | P1 | 严重 | `patent-core/src/novelty/numeric-range.ts:85` ↔ `patent-tools/src/tool/validate-specification.ts:129` |
| #175 | `patent-teams` invariant 覆盖 7/9 事件类型，模块文档过度承诺 | Task | kind/techdebt, area/patent | P2 | 严重 | `patent-teams/src/invariant.ts:1-9,112-133` |
| #176 | `merge.ts` 的 `asArray` 文档与实现相反，existing 非数组被静默丢弃 | Bug | kind/bug-fix, area/patent | P3 | 中等 | `patent-core/src/graph/merge.ts:16-19,22-37` |
| #177 | `ipc-standards.yaml` 1782 行双副本 + 不可达候选 + 失效 `v8 ignore` | Task | kind/cleanup, area/patent | P3 | 中等 | `patent-core/src/ipc/ipc-standards-loader.ts:16-30` |
| #178 | 两处 `v8 ignore` 理由与被豁免代码事实相反 | Task | kind/cleanup, area/patent | P3 | 中等 | `patent-teams/src/service.ts:828,853` |
| #179 | `assertRendered` / `resolveInvention` 在同包各两份 | Task | kind/cleanup, area/patent | P3 | 中等 | `patent-tools/src/tool/generate-structure-figure.ts:151,163` ↔ `generate-patent-figure.ts:459,340` |
| #180 | 跨包 PDF 体三检与 `datePartOf` 双份，`jscpd:ignore` 只加一侧 | Task | kind/cleanup, area/patent | P3 | 中等 | `patent-tools/src/tool/patent-pdf-download.ts:336-345,170` ↔ `tool-literature/src/tool/paper-download.ts:112-120,82` |
| #181 | `tool-literature` 的网络预算无 `Config` 出口 | Task | kind/techdebt, area/patent | P3 | 中等 | `tool-literature/src/runtime/http.ts:70-72`、`network-fetch.ts:44-46`、`index.ts:52-76` |
| #182 | `loadIpcStandards(overridePath)` 的 override 自第二次调用起被静默忽略 | Bug | kind/bug-fix, area/patent | P3 | 中等 | `patent-core/src/ipc/ipc-standards-loader.ts:64-68` |
| #183 | FreeCAD real-render 子进程在并发/重负载下失败 | Bug | kind/bug-fix, area/patent | P2 | 中等 | `patent-tools/tests/figure-freecad-real-render.spec.ts:95`、`src/figure/freecad-structure-script.ts:374-376` |
| #184 | 四个多职责耦合文件与逻辑型长函数拆分 | Task | kind/techdebt, area/patent | P3 | 中等 | `patent-teams/src/service.ts`(1382)、`state.ts`(907)、`patent-core/src/evidence/engine.ts`(876)、`patent-tools/src/tool/validate-specification.ts`(842) |
| #185 | 专利域机械重复收敛批次（守卫 / `assertNever` / asset-location / `identify`） | Task | kind/cleanup, area/patent | P3 | 建议 | 见正文 |
| #186 | 专利域注释清扫：移植差异叙述与未来计划残留 | Task | kind/cleanup, area/patent | P3 | 建议 | `patent-data/src/ego-session.ts:209-210`、`patent-rule/src/asset-location.ts:4-8`、`patent-rule/src/runtime/patent-compliance.ts:33` |

---

### Issue #172: 专利域整族被排除在覆盖率测量之外（非仅阈值外）

```
P1 | 类型：Task | 来源：2026-09-21 专利域代码审阅（PDR-01）

## Problem

`vitest.config.ts:215` 的 `coverage.exclude` 数组包含 `vitest.config.ts:230` 的
`'packages/patent/*/src/**/*.{ts,tsx}'`。该 glob 位于 **exclude**（排除测量），不是
`coverage.thresholds.exclude`（排除阈值）。两者差别是实质性的：前者让文件不出现在
覆盖率报告里，后者只让文件免于 100% 判定但仍可看见。

后果：专利域 286 个 src 文件 / 约 53k 行生产代码**没有任何覆盖率数字**，而该族测试
密度已是全仓最密的几处之一（214 spec / 2751 用例）。家族级 glob 还意味着今天新增
`packages/patent/<新包>/` 会自动落在门禁之外。

## Evidence

实测（`pnpm vitest run --coverage --coverage.reporter=json-summary packages/patent`）：
`coverage-summary.json` 共 1627 个条目，其中来自 `packages/patent/*/src` 的为 **0**。

```ts
// vitest.config.ts:222-230
// Fork-local families not yet held to the per-file gate: patent domain
// plugins, the synapse live surface, the self-evolve family, and the
// agent-preset client. Their source carries GUI and patent-asset code
// without per-branch specs; registering them keeps the gate runnable.
// TODO(cov): cover or tighten per the coverage backlog in
// .agents/notes/proposed/bug-fix/2026-08-26-hygiene-gate-debt-and-conflict.md.
'packages/patent/*/src/**/*.{ts,tsx}',
```

该理由文本已过期：`.agents/notes/proposed/bug-fix/2026-08-26-hygiene-gate-debt-and-conflict.md`
记录登记时的 `patent-core` 为 75 src / 10 spec，现为 286 src / 214 spec（全族）。

## Suggested fix

1. 把家族级 glob 换成**按包条目**（12 条），逐包给出判定：
   - 补测到达标后移出 exclude，或
   - 登记为显式豁免，并在 exclude 注释里写明理由与**到期条件**
2. 改写 `vitest.config.ts:222-229` 的理由文本为事实
3. 补测优先级（分叉藏身概率 × 无 CI 信号）：
   ① `patent-tools/src/figure/**` 与 `patent-tools/src/tool/generate-*.ts`
   ② `patent-core/src/ipc/**`
   ③ `patent-teams/src/state.ts`（mailbox lease/TTL、锁与原子写分支）
   ④ `tool-literature/src/runtime/http.ts`（缓存命中/过期、Retry-After、pacing）
   ⑤ `patent-core/src/graph/merge.ts`（见 #176）
4. 与 `.agents/notes/proposed/bug-fix/2026-08-26-hygiene-gate-debt-and-conflict.md`
   的 coverage backlog 项 3 是同一项，更新该 note 而不是新建重复 note

## Labels

kind/techdebt, area/patent
```

### Issue #173: 重复检测阈值高于域内所有真实克隆，专利域系统性失明

```
P1 | 类型：Task | 来源：2026-09-21 专利域代码审阅（PDR-02）

## Problem

`.jscpd.json:2-4` 为 `minTokens: 60` / `minLines: 6` / `mode: mild`，高于专利域内
**所有**真实克隆的长度（实测最大 55 tokens），因此 `pnpm run duplication` 对该域恒报 0。
另有第二条失明机制：仓库用 `jscpd:ignore` 标记登记「承认但暂不收敛」的重复，但标记
**只加在一侧**——被标记一侧的内容被掩码后，整对不会被报出，标记从「登记豁免」退化为
「静默隐藏」。

## Evidence

```sh
# 现行配置：0 克隆
npx jscpd --config .jscpd.json packages/patent/patent-tools
# → 54 文件 / 80521 tokens / 0 克隆

# 降低阈值：同一棵树 113 克隆
npx jscpd --min-tokens 30 --min-lines 5 --mode mild --format typescript \
  --pattern "**/*.ts" --ignore "**/tests/**,**/tsdown.config.ts" \
  --reporters console --no-colors --exit-code 0 packages/patent
# → 283 文件 / 52696 行 / 113 克隆 / 866 行重复（1.64%），最大克隆 55 tokens
```

实测到的真实跨文件克隆（部分）：

```
patent-tools/src/tool/generate-patent-figure.ts [845:182-852:22]
  patent-tools/src/tool/generate-structure-figure.ts [300:96-307:22]
patent-tools/src/tool/patent-pdf-download.ts [172:1-177:19]
  tool-literature/src/tool/paper-download.ts [78:1-90:19]
patent-tools/src/tool/patent-case-search.ts [140:117-148:76]
  patent-tools/src/tool/patent-wiki-search.ts [117:104-125:76]
patent-tools/src/tool/patent-flexible-plan.ts [64:36-76:35]
  patent-workflow/src/flexible-plan.ts [33:27-41:35]
```

单侧标记对：`patent-workflow/src/invariant.ts`、`tool-literature/src/tool/paper-download.ts:106,123`
有标记，其对端 `patent-teams/src/invariant.ts`、`patent-tools/src/tool/patent-pdf-download.ts` 无标记。

## Suggested fix

三选一（需与 #179/#180/#185 的收敛配套）：

1. 先落地共享抽取，再考虑收紧阈值
2. 把 `minTokens` 降到 30 并为专利域设白名单基线
3. 强制「跨包重复的两侧都加标记」，并在标记文本里写明对称对象

任一方案都要配一条**负例测试**：注入 30-token 的跨文件重复必须让门禁失败。
另注：`.jscpd.json:8-10` 的 `ignorePattern` 对标记无额外作用（检测器自身识别标记）。

## Labels

kind/techdebt, area/patent
```

### Issue #174: 两套数值范围语法分叉，同一文本两条生产路径结论相反

```
P1 | 类型：Bug | 来源：2026-09-21 专利域代码审阅（PDR-03）

## Problem

「数值范围」这一词表在两个模块各写一份，只共享了「单位归一」一条。同一句专利文本在
两条生产路径上得到互相矛盾的结论，而其中一条是新颖性判定的输入。

## Evidence

```ts
// patent-core/src/novelty/numeric-range.ts:85 —— 单位非必需；连接符含 - – — ~ ～ 至 到
const RANGE_PATTERN = /(\d+(?:\.\d+)?)\s*(?:[-–—~～]|至|到)\s*(\d+(?:\.\d+)?)/g
// :119
const DEGREE_UNITS = new Set(['℃', '°c', '°'])

// patent-tools/src/tool/validate-specification.ts:129 —— 要求尾随单位；连接符仅 ~ ～ 至 - —
const RANGE_PATTERN = new RegExp(
  `(\\d+(?:\\.\\d+)?)\\s*(?:${UNITS})?\\s*(?:[~～至\\-—])\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNITS})`,
  'g',
)
// :159 normalizeUnit 用 ['℃','°C','°']（无 °c）
```

- `温度 20℃ 至 90℃`：单位夹在数字与连接符之间 → novelty 侧 `RANGE_PATTERN` 不匹配，
  退化为 `PLAIN_NUMBER_PATTERN` 的两个强「数值点」；规格校验侧识别为一个区间
- `重量比 50-80`：规格校验侧要求尾随单位 → **完全不被识别**；novelty 侧识别

生产消费方：`patent-core/src/graph/domains/novelty.ts:86`（新颖性图节点）、
`patent-tools/src/tool/validate-specification.ts:207`（工具输出）。

## Suggested fix

1. 把连接符集、单位是否可选、单位归一（含 `℃/°C/°c/°`）收敛为 `patent-core` 的
   共享模块（如 `src/novelty/numeric-vocabulary.ts`，或由 `numeric-range.ts` 导出
   `RANGE_SYNTAX`）
2. `validate-specification.ts` 改为 import 并在其上叠加「必须带单位」的本地约束
3. 为 `20℃至90℃`、`50-80`、`20到90℃`、`25°c` 各加一条双解析器对拍用例

## Labels

kind/bug-fix, area/patent
```

### Issue #175: `patent-teams` invariant 覆盖 7/9 事件类型，模块文档过度承诺

```
P2 | 类型：Task | 来源：2026-09-21 专利域代码审阅（PDR-04）

## Problem

`patent-teams/src/invariant.ts:1-9` 的模块文档写「it validates **every payload on
load and on append**」，但 `:112-133` 的 switch 只有 7 个 case；`patent-teams/task-validated`
与 `patent-teams/task-gated`（两者都是生产事件）落入 `default: break`，完全不校验。

可证伪：向会话日志写入畸形 `patent-teams/task-validated` 载荷（如 `worker: 42,
valid: 'yes'`）再跑装载期校验，不会失败。

根因是 `install`（`:139-149`）把两半不同边界的事情写在一个文件里并统一声明：
`snapshotEvents()` 扫描（`:140-142`）坐在 durable 会话日志边界（必须校验）；
`internal/dispatch` 监听（`:144-148`）只观测同进程内由类型化生产者构造的载荷，
属同进程 typed 边界，其唯一可观测效果是把一条 `ignorable` 信息性记录降级为 warn 后
丢弃（`.agents/notes/implemented/bug-fix/2026-08-27-patent-teams-ignorable-session-events.md`
已裁定磁盘状态权威、事件可忽略）。

## Evidence

```ts
// patent-teams/src/event-types.ts:111-151 声明 9 个类型：
// team-created, member-added, member-removed, task-created, task-updated,
// task-validated, task-gated, message-sent, team-deleted

// invariant.ts:112-133 的 switch 只覆盖 7 个（缺 task-validated / task-gated）

// 生产者（production）：
// patent-teams/src/service.ts:821  → 'patent-teams/task-gated'
// patent-teams/src/service.ts:863  → 'patent-teams/task-validated'
```

## Suggested fix

1. 补 `task-validated` / `task-gated` 两个 validator，装载期覆盖补齐到 9 个类型
2. 删除 `internal/dispatch` 分支；或保留但把模块文档改为「装载期校验；append 仅记录异常」
3. 测试头（`tests/invariant.spec.ts:5-6`）改为描述装载期校验集合
4. 与 `patent-workflow/src/invariant.ts` 的 install 骨架重复一并处理（见 #173）
5. 新增两条反例用例（畸形 `task-validated`、`task-created.worker: 42`）

## Labels

kind/techdebt, area/patent
```

### Issue #176: `merge.ts` 的 `asArray` 文档与实现相反，existing 非数组被静默丢弃

```
P3 | 类型：Bug | 来源：2026-09-21 专利域代码审阅（PDR-05）

## Problem

`patent-core/src/graph/merge.ts:16-19` 的注释承诺「把单值转为数组」，实现把单值变成 `[]`。
`appendValue`（`:22-24`）用 `asArray(existing)` 但把 incoming 整体作为单元素追加；
`unionValues`（`:27-37`）用 `asArray(existing)` 却把 incoming 非数组包装为 `[value]`。
同一输入在两个 reducer 下处理方式相反。

初始状态由调用方提供（`graph/engine.ts` 的 `run(initial: GraphState, …)`），因此
existing 侧「历史值一定是数组」的假设对 seed 的初始状态不成立。后果：某 key 的初始值
是非数组标量时，`append`/`union` 会**静默丢弃**它（无警告、无断言），而
`last_write_wins`/`merge_map`/`fail_on_conflict` 不受影响。

## Evidence

```ts
// patent-core/src/graph/merge.ts:16-19
/** 把单值转为数组（append/union 用）；已是数组原样返回。 */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
```

## Suggested fix

1. 改名为 `existingArray` 并把注释写成事实（「历史值非数组时视为空」），或
2. 在 reducer 首次写入时把非数组 existing 显式包装为 `[existing]`（与 `union` 的 incoming 侧对齐）
3. `tests/graph/merge.spec.ts` 增加「初始状态为标量」用例把语义钉住

## Labels

kind/bug-fix, area/patent
```

### Issue #177: `ipc-standards.yaml` 1782 行双副本 + 不可达候选 + 失效 `v8 ignore`

```
P3 | 类型：Task | 来源：2026-09-21 专利域代码审阅（PDR-06）

## Problem

`packages/patent/patent-core/assets/ipc-standards.yaml` 与
`packages/patent/patent-core/src/ipc/ipc-standards.yaml` 各 1782 行、sha 相同
（`1f2d9e4c8a2b`），是同一份数据的两个活副本：源运行读 `src/ipc/`，打包运行读 `assets/`。
改一份不会让任何测试发现另一份变旧。

`ipc-standards-loader.ts:16-30` 的三个候选中，`:18` 的 `../../../assets/` 解析到
`packages/patent/assets/`，该目录在两个布局下都不存在 —— **候选一恒不可达**。
挂在候选一与末尾 throw 上的两条 `v8 ignore` 理由（`:24`「the first candidate always
exists in the shipped package layout」、`:27`）与事实相反。

注意：不要得出「`src/ipc/` 是死副本」的结论。按 `import.meta.url` 解析，源树（`src/ipc/`）
命中候选三（`:20`），打包后的单文件 bundle（`lib/index.js`）命中候选二（`:19`）。

## Evidence

```sh
find packages/patent/patent-core -name ipc-standards.yaml   # 两份，行数与 sha 相同
# 源树布局存在性：packages/patent/assets/ 不存在；patent-core/src/assets/ 不存在；
#                 patent-core/src/ipc/ipc-standards.yaml 与 patent-core/assets/... 存在
# package.json files: ["lib/index.js","assets","lib/types/**/*.d.ts"] → lib/ 为单文件 bundle
```

## Suggested fix

1. 删除不可达的候选一（`:18`）与两条失效的 `v8 ignore`
2. 在 loader 文档里写明「源运行读 `src/ipc/`，打包运行读 `assets/`」
3. 加一条 spec 断言两份副本内容一致；或决定只保留一份并让源树也走 `../assets/`

## Labels

kind/cleanup, area/patent
```

### Issue #178: 两处 `v8 ignore` 理由与被豁免代码事实相反

```
P3 | 类型：Task | 来源：2026-09-21 专利域代码审阅（PDR-07）

## Problem

`patent-teams/src/service.ts` 有两处 `v8 ignore` 的理由与被豁免代码不符，而注释在本仓
承担契约职责，这类失效注释比缺注释更危险。

## Evidence

```ts
// service.ts:828 —— 理由称 attempt/attemptId 恒有
// v8 ignore start -- the task is still in a non-terminal status, so attempt/attemptId are always set
return {
  task_id: task.id,
  status: task.status,
  output: task.output,
  attempt: task.attempt ?? 0,                                  // 代码本身不依赖该断言
  ...task.attemptId === undefined ? {} : { attempt_id: task.attemptId },
  gated: true,
  gate_feedback: gate.feedback,
}
// v8 ignore stop

// service.ts:853 —— 理由称载荷恒带 attempt/attemptId，但载荷里没有这两个字段
// v8 ignore start -- an updatable task always carries assignee/attempt/attemptId
appendTeamEvent(…, 'patent-teams/task-updated', {
  teamId: …, taskId: …, status: task.status,
  ...task.assignee !== undefined ? { assignee: task.assignee } : {},
  ...task.output !== undefined ? { output: task.output } : {},
})
// v8 ignore stop
```

连锁影响：`invariant.ts:85-87` 正在校验这两个「生产侧从不写出」的可选字段，
与上述错误理由互相强化，形成「永不执行的分支 + 看似有校验」的假象。

## Suggested fix

1. 两处理由改为本地事实并实际验证；验证不了就删除 `v8 ignore` 让门禁说话
2. 同步决定 `invariant.ts` 侧 `attempt`/`attemptId` 保留还是删除（取决于是否真有生产者）
3. **不做**：仅为消除 `v8 ignore` 而新增覆盖率专用测试

## Labels

kind/cleanup, area/patent
```

### Issue #179: `assertRendered` / `resolveInvention` 在同包各两份

```
P3 | 类型：Task | 来源：2026-09-21 专利域代码审阅（PDR-08）

## Problem

同一错误契约在 `patent-tools` 内写了两遍：`assertRendered` 的 JSDoc 与四路映射完全相同，
仅 outcome 类型名与 4 处工具名字面量不同。共享落点已存在
（`figure/subprocess-render.ts` 的模块文档声明两个渲染器「共用部分必须保持同一条判定语义」）。
现行 `jscpd` 配置报不出这一对（见 #173）。

## Evidence

```ts
// generate-structure-figure.ts:151  ≡  generate-patent-figure.ts:459（差异仅类型名与 4 个字面量）
/** 渲染失败统一映射：not_installed→setup_required / aborted→tool_aborted / 其余→tool_execution_failed。 */
function assertRendered(outcome: …): asserts outcome is Extract<…, { ok: true }> {
  if (outcome.ok) return
  if (outcome.code === 'not_installed') throw new PatentToolError('setup_required', outcome.error, { tool: 'generate_structure_figure' })
  if (outcome.code === 'aborted') throw new PatentToolError('tool_aborted', '… aborted', { tool: 'generate_structure_figure' })
  throw new PatentToolError('tool_execution_failed', outcome.error, { tool: 'generate_structure_figure' })
}

// resolveInvention：generate-structure-figure.ts:163 ≡ generate-patent-figure.ts:340
```

## Suggested fix

1. 在 `figure/subprocess-render.ts`（或同目录 `tool-error.ts`）导出按工具名参数化的共享函数：

   ```ts
   export function assertRendered<T extends RenderOutcome>(
     outcome: T, tool: FigureToolName,
   ): asserts outcome is Extract<T, { ok: true }> {
     if (outcome.ok) return
     if (outcome.code === 'not_installed') throw new PatentToolError('setup_required', outcome.error, { tool })
     if (outcome.code === 'aborted') throw new PatentToolError('tool_aborted', `${tool} aborted`, { tool })
     throw new PatentToolError('tool_execution_failed', outcome.error, { tool })
   }
   ```

2. `resolveInvention` 一并移入共享模块（两工具均已依赖 `patent-core`）
3. 落地前确认两个 outcome 类型的 `code` 联合等价
   （`rg -n "RenderOutcome" packages/patent/patent-tools/src/figure`）

## Labels

kind/cleanup, area/patent
```

### Issue #180: 跨包 PDF 体三检与 `datePartOf` 双份，`jscpd:ignore` 只加一侧

```
P3 | 类型：Task | 来源：2026-09-21 专利域代码审阅（PDR-09）

## Problem

两个下载工具各自实现同一套「PDF 体三检」（Content-Type / 最小字节 / 魔数）与同一个
`datePartOf`。保留一致性只靠注释与单侧 `jscpd:ignore` 标记维持，而单侧标记还让重复
检测看不见它（见 #173）。

## Evidence

```
patent-tools/src/tool/patent-pdf-download.ts:41   PDF_MAGIC = '%PDF-'
patent-tools/src/tool/patent-pdf-download.ts:43   MIN_PDF_BYTES = 500
patent-tools/src/tool/patent-pdf-download.ts:336-345  三检（failed(...) 风格）
patent-tools/src/tool/patent-pdf-download.ts:170  datePartOf

tool-literature/src/tool/paper-download.ts:20    PDF_MAGIC = '%PDF-'
tool-literature/src/tool/paper-download.ts:22    MIN_PDF_BYTES = 500
tool-literature/src/tool/paper-download.ts:112-120  同一三检（throw 风格），
  :105 注释自述「与 patent_pdf_download 的 fetchPdfFallback 对称」，:106/:123 单侧 jscpd:ignore
tool-literature/src/tool/paper-download.ts:82    datePartOf
```

降低阈值后 jscpd 报出该对：`patent-pdf-download.ts[172:1-177:19] ↔ paper-download.ts[78:1-90:19]`。

## Suggested fix

1. 抽 `verifyPdfBody(buf, contentType): { ok: true } | { ok: false; reason: string }`
   与 `datePartOf` 到共享模块（放 `patent-core`，两包均已依赖或可依赖）
2. 错误文案由调用方按各自风格包裹
3. 若依赖方向不允许，则两侧都加标记并在标记文本里写明对称对象

## Labels

kind/cleanup, area/patent
```

### Issue #181: `tool-literature` 的网络预算无 `Config` 出口

```
P3 | 类型：Task | 来源：2026-09-21 专利域代码审阅（PDR-10）

## Problem

按 AGENTS.md「No hardcoded tunables in plugins」判定：30s 超时、5 分钟缓存、3 次/15s
上限的重试预算会随部署网络（代理、内网镜像、离线/限流环境）改变，且三者互相耦合
（超时 × 重试 = 最坏延迟），属「随部署变化」而非「协议常量」。当前 `Config` 无任何出口，
部署无法调整：慢网整体失败，快网也吃满重试，离线部署无法缩短缓存或关闭重试。

## Evidence

```ts
// tool-literature/src/runtime/http.ts:70-72
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_CACHE_TTL_MS = 5 * 60_000
const DEFAULT_RETRY: NetworkRetryOptions = { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 15_000 }
// :176/:203/:206 以 `??` 默认值消费，生产路径无调用方设置 opts.timeoutMs/cacheTtlMs/retry

// tool-literature/src/network-fetch.ts:44-46
const DEFAULT_BASE_DELAY_MS = 1000
const DEFAULT_MAX_DELAY_MS = 30_000
const DEFAULT_RETRY_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504])

// tool-literature/src/index.ts:52-76  Config 仅 6 个字段（4 个连接器开关 + openalexMailto + semanticScholarApiKey）
```

## Suggested fix

1. 把 `timeoutMs`、`cacheTtlMs`、`retry`（`maxRetries`/`baseDelayMs`/`maxDelayMs`）
   提升为 `Config` 字段，现有 `DEFAULT_*` 作为默认值，由插件在构造时注入
2. 若维护者认定它们是外部源配额的一部分，则在包 README 与 `Config` 注释里明确登记为
   固定规格并写出豁免理由
3. 再生 `docs/config-catalog.md`

## Labels

kind/techdebt, area/patent
```

### Issue #182: `loadIpcStandards(overridePath)` 的 override 自第二次调用起被静默忽略

```
P3 | 类型：Bug | 来源：2026-09-21 专利域代码审阅（PDR-11）

## Problem

`patent-core/src/ipc/ipc-standards-loader.ts:64` 的 JSDoc 承诺
`@param overridePath - 可选：覆盖默认 YAML 资产路径。`，但 `:68` 的
`if (cachedIndex) return cachedIndex` 未把 `overridePath` 纳入缓存键。同进程内
「先默认后 override」与「先 override 后默认」产生不同结果，且首次调用决定全进程数据、
无任何提示。

生产路径不传 override，风险限于测试顺序敏感；但这是文档承诺与实现不符的契约缺陷，
顺序依赖会在测试并行时制造难复现的失败。

## Evidence

```ts
// patent-core/src/ipc/ipc-standards-loader.ts:67-68
export function loadIpcStandards(overridePath?: string): IpcStandardsIndex {
  if (cachedIndex) return cachedIndex
  const path = resolveStandardsPath(overridePath)
```

## Suggested fix

只缓存默认路径：

```ts
if (overridePath === undefined && cachedIndex) return cachedIndex
```

若确实需要按路径缓存，则把 `overridePath` 作为缓存键并显式声明进程内多份索引。
新增「override 两次不同路径」用例。

## Labels

kind/bug-fix, area/patent
```

### Issue #183: FreeCAD real-render 子进程在并发/重负载下失败

```
P2 | 类型：Bug | 来源：2026-09-21 专利域代码审阅（PDR-12）

## Problem

`figure-freecad-real-render.spec.ts` 单独运行通过，在带覆盖率插桩的并发运行中失败。
这正是 packages/AGENTS.md 判定为 spec 缺陷的形态（「a spec that passes only when run
alone is a defect in the spec」）。该 spec 是 `freecad-renderer.ts` 唯一的真实端到端覆盖，
而 `patent/*/src` 已被排除出覆盖率测量（见 #172），因此偶发失败不会留下任何持久记录。

## Evidence

```
# 基线全绿：pnpm vitest run packages/patent → 214 文件 / 2751 用例通过
# 带覆盖率插桩的一次运行中：
FAIL packages/patent/patent-tools/tests/figure-freecad-real-render.spec.ts:95
  AssertionError: expected { ok: false, … } to deeply equal { ok: true, … }
  { "code": "render_failed",
    "error": "FreeCAD 结构投影失败（退出码 1）：Failed to create
      '/Users/…/Caches/FreeCAD/v1-1/Cache/FreeCAD_Doc_<uuid>_<uuid>_916159'
     … OSError: Cannot copy file from /var/folders/…/T/dsh-freecadreal-t1V7N8/
      .freecad-structure-template.svg to /.freecad-structure-template.svg" }
# 同一条用例单独重跑：通过
```

脚本内已有缓解注释 `src/figure/freecad-structure-script.ts:374-376`：
「TechDraw 重算时会把模板拷进『文档所在目录』；内存文档无文件名会解析到根目录（/）
导致拷贝失败，故给文档一个 outputDir 内的文件名作为拷贝基准」—— 而实测失败的拷贝
目标正是 `/`。

## Suggested fix

1. 先做确定性复现：用 `--maxWorkers` 或连续两次并发运行固定该失败
2. 确认是 FreeCAD 缓存/临时目录竞争后，把 FreeCAD 的缓存与临时目录**按 spec 隔离**
   （每 worker 独立 `TMPDIR` 或 FreeCAD 用户目录），或改为串行套件并在文件头写明理由
3. 若确认是 FreeCAD 侧不可控竞争，则改为由 CI 变量显式开启，并在注释里登记
   「并发下不可靠」这一事实

## Labels

kind/bug-fix, area/patent
```

### Issue #184: 四个多职责耦合文件与逻辑型长函数拆分

```
P3 | 类型：Task | 来源：2026-09-21 专利域代码审阅（PDR-13 / PDR-14）

## Problem

四个文件是**多职责**聚合（改 A 必须读懂 B 的状态与错误语义），而非单纯的体量大。
另实测全族 1618 个函数/方法中 38 个超过 80 行，其中逻辑型的最大者为
`registerPatentTeamsTools`(317)、`evaluateDeadlines`(298)、`installTeamScheduler`(210)。

## Evidence

真问题（多职责）：

| 文件 | 行数 | 混在一起的职责 |
|---|---|---|
| `patent-teams/src/service.ts` | 1382 | 团队生命周期 + 任务状态机 + 契约校验/质量门 + 成员运行时 + 状态归档 |
| `patent-teams/src/state.ts` | 907 | 团队持久化 + mailbox lease 协议 + 任务转移 + key 哈希 + 锁与原子写 |
| `patent-core/src/evidence/engine.ts` | 876 | 资产解析（含 `parseRuleSet`）+ `EvidenceEngine` |
| `patent-tools/src/tool/validate-specification.ts` | 842 | 约 8 个独立 checker + 自带数值词表（见 #174） |

**不应拆**（体量大但单一职责）：`patent-core/src/ipc/ipc-classifier.ts`(809，约 700 行数据表)、
`patent-deadline/src/statutes.ts`(765，法定期限数据 + `evaluateDeadlines`)、
`patent-tools/src/figure/leader-line.ts`(906，纯几何)、
`patent-tools/src/figure/dot-builder.ts`(672，DOT 构建 + 标号分配)。

## Suggested fix

按收益排序，每步一个提交：

1. `state.ts` 抽出 `team-lock.ts`（`withTeamLock`/`atomicWriteText`/`replaceFileAtomicOrDirect`）
   与 `mailbox.ts`（lease/TTL/投递状态）
2. `service.ts` 抽出 `task-ops.ts`（claim/update/validate/gate 分支）与 `member-runtime.ts`
3. `evidence/engine.ts` 把 `parseRuleSet` 及其校验搬到 `evidence/rule-set.ts`
4. `validate-specification.ts` 按 checker 拆文件，数值词表并入 #174 的共享模块
5. `evaluateDeadlines` 与 `validateSpecification` 抽取具名步骤函数
6. **不**为降低行数而拆散 `createXTool` 的 schema 字面量

每步后 `pnpm vitest run packages/patent` + `pnpm run typecheck`。

## Labels

kind/techdebt, area/patent
```

### Issue #185: 专利域机械重复收敛批次（守卫 / `assertNever` / asset-location / `identify`）

```
P3 | 类型：Task | 来源：2026-09-21 专利域代码审阅（PDR-15/16/17/18）

## Problem

四项同源的小规模机械收敛，共享同一验收标准（行为不变 + 不再重复）。可拆为 4 个提交。

## Evidence

1. **同包守卫重复**：`patent-teams/src/invariant.ts:28` 与 `patent-teams/src/state.ts:707`
   的 `isOptionalString` 定义逐字相同；`invariant.ts:23` 的 `isNonEmptyString` 与
   `state.ts:719-723`/`:758-765` 内联的 `typeof x === 'string' && x.trim() !== ''` 重复。
   `@deepseek-ai/dsh-value` 的导出面不含字符串谓词，不能按 `asRecord` 那样下沉。

2. **两处闭合联合未用共享 `assertNever`**：`patent-core/src/graph/merge.ts:85` 与
   `patent-core/src/checker/engine.ts:240` 都是手写 `const exhaustive: never = <值>; throw …`。
   仓库其余站点均已收敛（`docs/TECH_DEBT.md` 记录了该收敛，但未列这两处）。

3. **三份 asset-location**：`patent-deadline/src/asset-location.ts`(29) 与
   `writing-patterns/src/asset-location.ts`(29) 的模块文档与实现三段逐字同构，
   仅常量名与函数名不同；`patent-rule/src/asset-location.ts`(72) 是同一契约的扩展版。
   相关不对称：`patent-core/src/ipc/ipc-standards-loader.ts:18-20` 用三候选、
   `patent-document/src/document/templateResolver.ts:24-25` 用两候选——候选数实际由
   「模块在 `src/` 下的深度」导出，但未在任何地方写明。

4. **`methodology` 的 `identify` 同构**：`src/runtime/components/` 下 8/8 组件的
   `identify(context)` 都是 `return keywordScore(context, TRIGGERS)`。

## Suggested fix

1. 新建 `patent-teams/src/guards.ts` 导出 `isNonEmptyString`/`isOptionalString`，
   `state.ts` 的内联判断替换为调用，`invariant.ts` 从该模块导入
2. 两处改用共享 `assertNever`；若必须保留 `GraphMergeError` 领域错误类型（已有测试断言），
   则在 `assertNever` 之后补一行转换，或就地加注释登记为例外
3. 抽「显式覆盖优先，否则 `../assets/<name>/`」为共享原语，并把「候选数取决于模块深度」
   写进原语文档供多候选站点引用
4. 把 `identify` 提升为 `MethodologyComponent` 的默认实现，组件只声明
   `name`/`description`/`category`/`applicableDomains`/`TRIGGERS`/`execute`
   （不改变模型可见文本）

## Labels

kind/cleanup, area/patent
```

### Issue #186: 专利域注释清扫：移植差异叙述与未来计划残留

```
P3 | 类型：Task | 来源：2026-09-21 专利域代码审阅（PDR-19）

## Problem

三处注释记录了「从哪来、以后要搬到哪、与上一版有何不同」，属于变更叙事而非当前契约。
读者需要的是当前契约（覆盖项与解析基准），不是演进史。

## Evidence

```
patent-data/src/ego-session.ts:209-210
  jscpd:ignore-start — platform command resolution kept per-domain
  (browser-backend carries its own copy); the shared home is a future util-group extraction.
  → 未来计划残留（对端确实存在：packages/browser/browser-backend/src/ego-backend.ts:51）

patent-rule/src/asset-location.ts:4-8
  「与 Sati 的 asset-location.js 不同，本实现放弃 … 语义」
  → 变更叙事

patent-rule/src/runtime/patent-compliance.ts:33
  「assets/patent-rules/ 原始资产未随移植带入本仓，故各文件头部注释描述的生成流程在本仓不适用」
  → 外部来源叙述混入契约位
```

**不判定为问题、应保留**：资产来源标注（如 `RuleLoader.ts:461` 说明
`assets/rules/patent/nuo-*.yaml` 是上游生成物的逐字镜像、`methodology` 各组件的
「Ported from Sati's …」）—— 在本仓是可维护事实（再同步时的对端位置）。

## Suggested fix

1. 上述三处改为现状陈述或删除；「未来要搬到哪」不属于注释
2. 保留资产来源标注
3. 并入一次性的注释清扫，不单独立项

## Labels

kind/cleanup, area/patent
```
