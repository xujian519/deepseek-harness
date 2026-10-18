# Patent Atoms 加固执行计划

- 日期：2026-10-18
- 范围：`packages/patent/patent-core/src/atoms` 及其 workflow/tool 消费方
- 依据：`.agents/audits/2026-10-17-patent-workflow-guideline-optimization-plan.md` 之后的只读审查结论
- 原则：先正确性、再契约、最后工程化；每个 P0 任务独立 PR，可独立回滚
- 当前状态：P0-01 至 P0-05、P1-01 至 P1-05、P2-01 至 P2-05 全部完成

## 目标

把 24 个内置 Atom 从“契约完整、测试通过”推进到“生产级正确性”：

1. 降级原因可见，确定性失败不重试，`_error` 不污染共享 state。
2. LLM JSON 边界按 `output_key` 正确解析，数组元素做类型校验。
3. 日期精度、证据形式等法律输入不再被静默误判。
4. 畸形 JSON 输入降级而不是抛 `TypeError`。
5. 补齐契约文档、覆盖率、生命周期与参数出口。

## 任务总览

| ID | 优先级 | 任务 | 状态 |
|---|---|---|---|
| P0-01 | P0 | 降级原因可见，区分终态与可重试失败 | 已完成 |
| P0-02 | P0 | 修复 `extract` 的 `output_key` 与 Schema 冲突 | 已完成 |
| P0-03 | P0 | 拒绝月级日期作为现有技术基准日 | 已完成 |
| P0-04 | P0 | 证据形式改为多标签检查 | 已完成 |
| P0-05 | P0 | 为畸形 JSON 状态加形状守卫 | 已完成 |
| P1-01 | P1 | 透传 `AbortSignal` 到 `callLLM` | 已完成 |
| P1-02 | P1 | 补齐 `outputSchema` 漏键 | 已完成 |
| P1-03 | P1 | 非法 `chart_mode` 与目标校验 | 已完成 |
| P1-04 | P1 | LLM 数组元素严格校验 | 已完成 |
| P1-05 | P1 | 注册表生命周期与 `StageError` 决策 | 已完成 |
| P2-01 | P2 | Atom 层覆盖率达到 100% | 已完成 |
| P2-02 | P2 | 收敛重复的 key 解析 | 已完成 |
| P2-03 | P2 | 暴露模型/重试/阈值参数 | 已完成 |
| P2-04 | P2 | 更新文档与文件头 | 已完成 |
| P2-05 | P2 | 快照与升级指南 | 已完成 |

## P0-01 降级原因可见，区分终态与可重试失败

**目标**：修复 F1。用户和模型能看到 `[WORKFLOW_DEGRADED] 原因`；确定性缺输入不再无意义重试；`_error` 不残留在共享 state。

**改动文件**

- `packages/patent/patent-workflow/src/workflow/executor.ts`
- `packages/patent/patent-core/src/atoms/handler.ts`
- `packages/patent/patent-core/src/atoms/index.ts`
- `packages/patent/patent-core/src/atoms/handlers/builtin/llm.ts`
- `packages/patent/patent-core/src/atoms/handlers/builtin/search.ts`
- `packages/patent/patent-workflow/tests/workflow-degradation.spec.ts`（新增）

**步骤**

1. 在 `handler.ts` 定义并导出 `DEGRADED_ERROR_KEY = '_error'`、`DEGRADED_RETRYABLE_KEY = '_retryable'`。
2. `degraded(atom, reason, options?: { retryable?: boolean })` 增加可选标记；确定性失败默认终态。
3. `callLlm` 的 LLM 调用失败标记 `retryable: true`；`search` 的检索异常标记 `retryable: true`；缺 provider、缺输入、JSON 解析失败保持终态。
4. executor 在执行 handler 后剥离 `_error` / `_retryable`，其余输出正常合并；诊断只作为阶段局部变量。
5. 终态 `_error`：立即生成 `[WORKFLOW_DEGRADED] ${原因}`，写入 `state[stage.id]`，不再重试。
6. 可重试 `_error`：保留错误信息重试；重试耗尽后输出 `[WORKFLOW_DEGRADED] ${原因}`。
7. 成功执行时不得残留上一轮的 `_error`。

**测试**

- 终态 `_error`：handler 只调用 1 次，输出含原因，`retries === 0`，state 无 `_error`。
- 可重试 `_error` 后成功：handler 调用 2 次，输出成功内容，`retries === 1`，state 无 `_error`。
- 可重试 `_error` 耗尽：handler 调用 `maxRetries + 1` 次，输出含原因，state 无 `_error`。
- 既有 executor 用例全部保持通过。

**完成标准**

- “无 provider 的 search 阶段”输出从空字符串变为带原因的 `[WORKFLOW_DEGRADED]`。
- 确定性失败不再触发 `maxRetries` 次调用。
- `pnpm exec vitest run packages/patent/patent-workflow/tests/workflow/executor.spec.ts packages/patent/patent-workflow/tests/workflow-degradation.spec.ts` 全绿。

**风险**：改变用户可见输出；需要快照更新，属于升级指南条目。

## P0-02 修复 `extract` 的 `output_key` 与 Schema 冲突

**目标**：修复 F2。`problems`、`effects`、`insight` 分键提取不再要求同时返回 `features`。

**改动文件**

- `packages/patent/patent-core/src/atoms/handlers/builtin/extract.ts`
- `packages/patent/patent-core/tests/extract-atom.spec.ts`（新增）

**步骤**

1. 按 `output_key` 构造 Schema：目标键为 `required`，其余键保留为可选；无 `output_key` 时默认 `required: ['features']`。
2. 提示词明确“只输出目标数组”，例如 `请严格输出 JSON：{ "problems": [...] }`。
3. 解析时只读取目标键；目标键缺失或非数组时返回可操作降级。
4. 目标数组元素做字符串校验（与 P1-04 共用 helper）。

**测试**

- provider 只返回 `{ problems: ['问题1'] }`，`output_key: 'problems'` → `out.problems === ['问题1']`。
- 覆盖 `effects`、`insight`。
- provider 只返回 `{ features: [] }`，`output_key: 'problems'` → 返回 `_error`。

**完成标准**

- 上轮实测的 `{ problems: ['问题1'] }` 不再丢失。
- `merge` 阶段能收到 `problems`。

## P0-03 拒绝月级日期作为现有技术基准日

**目标**：修复 F3。`time-baseline` 和 `prior-art-filter` 不再把 `2023-05` 当作 `2023-05-01`。

**改动文件**

- `packages/patent/patent-core/src/atoms/handlers/builtin/time-baseline.ts`
- `packages/patent/patent-core/src/atoms/handlers/builtin/prior-art-filter.ts`
- `packages/patent/patent-core/tests/time-baseline-atom.spec.ts`
- `packages/patent/patent-core/tests/prior-art-filter-atom.spec.ts`

**步骤**

1. 引入 `isMonthOnlyDate`（或 `isPreciseDate` 的正向判定）。
2. `time-baseline` 的 `filing_date`、`priority_date` 若为月级，返回降级。
3. `prior-art-filter` 的 `reference_date`、`filing_date` 同理；`publicationDate` 的月末推定保留。
4. 错误文案说明需要 `yyyy-MM-dd`。

**测试**

- 月级 `filing_date`、`reference_date` → `_error` 包含“仅精确到月”。
- 具体日期仍正常；月级公开日仍按月末推定。
- 上轮“D1 公开日 2023-05-10 + filing 2023-05”不再被静默排除。

## P0-04 证据形式改为多标签检查

**目标**：修复 F4。一份“现有技术 + 外文 + 域外”证据同时检查公开日、中文译本、公证与认证。

**改动文件**

- `packages/patent/patent-core/src/atoms/handlers/builtin/evidence-check.ts`
- `packages/patent/patent-core/tests/evidence-check-atom.spec.ts`

**步骤**

1. 将 `EvidenceKind` 单值改为属性集合：`priorArt`、`foreignLanguage`、`overseas`、`witness`、`electronic`。
2. `classifyKinds` 用独立正则分别判定，不再按顺序短路。
3. `checkEntry` 按属性逐项运行适用检查。
4. `electronic` 至少输出“形式要件需人工核验”的待核项，不能静默通过。
5. 报告中的类型标签改为多标签拼接；单一类型格式保持不变。

**测试**

- 组合证据同时包含 `EVID-FORM-TRANSLATION` 与 `EVID-FORM-NOTARIZATION`。
- 单一外文、单一域外、单一证人既有断言不变。
- 电子数据产生待核项。

## P0-05 为畸形 JSON 状态加形状守卫

**目标**：修复 F7。`response-plan`、`chart`、`coverage` 在输入 `null`、`[]`、缺字段时降级，而不是抛 `TypeError`。

**改动文件**

- `packages/patent/patent-core/src/atoms/handlers/builtin/notice.ts`
- `packages/patent/patent-core/src/atoms/handlers/builtin/chart.ts`
- `packages/patent/patent-core/src/atoms/handlers/builtin/coverage.ts`
- `packages/patent/patent-core/tests/malformed-state.spec.ts`（新增）

**步骤**

1. `response-plan` 检查 `isRecord` 且 `rejectionTypes` 为数组。
2. `deriveOfficeActionTargets` 守卫 `citations` 数组。
3. `parseTargets` 逐项检查对象与 `id`，错误带下标。
4. `coverage` 移除 `as unknown as ClaimChart`，增加最小形状守卫。
5. 错误文案说明期望来源。

**测试**

- `office_action: 'null'`、`'[]'`、`'42'` → `_error`。
- `deriveOfficeActionTargets('null')` → `[]`。
- `claim_chart_doc: '{"mode":"infringement"}'` → `_error`。
- `chart_targets` 含 `null` → `_error` 包含下标。

## P1 任务

| ID | 任务 | 改动文件 | 验收 |
|---|---|---|---|
| P1-01 | 透传 `AbortSignal` | `llm.ts` | provider 收到同一 signal；abort 用例通过。 |
| P1-02 | 补齐 `outputSchema` | `chart.ts`、`notice.ts`、`stage-outputs.spec.ts` | `claim_chart_paths`、`patent_subject` 可被回退清理。 |
| P1-03 | 非法 `chart_mode` 与目标校验 | `chart.ts`、`chart-atom.spec.ts` | 非法 mode、null 条目、缺 id 均降级。 |
| P1-04 | LLM 数组严格校验 | `llm-json.ts`、`extract.ts`、`keywords.ts`、`draft.ts`、`compare.ts`、`novelty.ts` | 非字符串项带下标降级；无 `[object Object]`。 |
| P1-05 | 注册表生命周期与 `StageError` | `atom.ts`、`handler.ts`、两个消费包 | `register()` 返回 disposer；插件 dispose 后注册表回滚。 |

## P2 任务

| ID | 任务 | 改动文件 | 验收 |
|---|---|---|---|
| P2-01 | Atom 覆盖率 100% | 相关 spec、`vitest.config.ts` | 逐文件 100%；移除 patent-core 覆盖率排除项。 |
| P2-02 | 收敛 key 解析 | `citation.ts`、`time-baseline.ts`、`state-keys.ts` | 复用共享 helper；带空格配置键用例通过。 |
| P2-03 | 暴露参数 | 新增 `atoms/tunables.ts`、相关 handler | `temperature`、`max_retries`、`prompt_char_limit`、`groundedness_threshold` 可配；非法值降级。 |
| P2-04 | 更新文档 | `README.md`、`README.zh.md`、`README.i18n.yaml`、`atoms/index.ts` | 24 内置 + 6 工具侧；无“15 个”残留；`test:docs` 通过。 |
| P2-05 | 快照与升级指南 | `snapshots/session/patent-*`、`docs/upgrade-guide/` | 只接受预期差异；外部可感知变化有升级指南。 |

## 可验证检查清单

### 任务级

- [ ] P0-01：终态 `_error` 只调用一次；可重试失败按次数重试；输出含原因；state 无 `_error`。
- [ ] P0-02：`problems` / `effects` / `insight` 单键输出可写入 state。
- [ ] P0-03：月级基准日降级；具体日期与月级公开日不受影响。
- [ ] P0-04：组合证据同时触发翻译与公证检查。
- [ ] P0-05：畸形 JSON 全部降级，不抛 `TypeError`。
- [ ] P1-01：`AbortSignal` 到达 `provider.callLLM`。
- [ ] P1-02：回退清理删除 `claim_chart_paths` 与 `patent_subject`。
- [ ] P1-03：非法 `chart_mode` 不被静默改为 `invalidity`。
- [ ] P1-04：数组元素非字符串时降级，输出无 `[object Object]`。
- [ ] P1-05：disposer 只删除自己注册的对象。
- [x] P2-01：Atom 层逐文件 100% 覆盖。
- [x] P2-02：无新增重复克隆。
- [x] P2-03：参数默认值与非法值行为有测试。
- [x] P2-04：文档数量与注册表一致。
- [x] P2-05：快照仅预期差异，升级指南存在。

### 命令

```sh
# focused
pnpm exec vitest run packages/patent/patent-core
pnpm exec vitest run packages/patent/patent-workflow packages/patent/patent-tools

# 静态门禁
pnpm run typecheck
pnpm exec oxlint --config .oxlintrc.json packages/patent/patent-core/src/atoms

# 覆盖率（patent-core 目前被排除，先用 include/exclude 覆盖测量）
pnpm exec vitest run packages/patent/patent-core \
  --coverage \
  --coverage.include='packages/patent/patent-core/src/atoms/**/*.ts' \
  --coverage.exclude='**/node_modules/**' \
  --coverage.reporter=text \
  --coverage.thresholds.perFile=false \
  --coverage.thresholds.statements=0 \
  --coverage.thresholds.branches=0 \
  --coverage.thresholds.functions=0 \
  --coverage.thresholds.lines=0

# 快照与文档
pnpm run test:snapshot -t patent
pnpm run test:docs

# 合并前
pnpm run build:artifacts
pnpm run build:check
git diff --check
```

### 合并前

- [x] P0 专项用例在修复前可复现问题，修复后通过。
- [x] patent-core 全量测试通过。
- [x] patent-workflow / patent-tools 相关测试通过。
- [x] typecheck 5 个 gate 通过。
- [x] lint 0 warning / 0 error。
- [x] `grep -rn "as unknown" packages/patent/patent-core/src/atoms` 为空。
- [x] `grep -rn "TODO\|FIXME\|XXX" packages/patent/patent-core/src/atoms` 为空。
- [x] 受影响快照仅预期差异。
- [x] 外部可感知变化已写升级指南。
- [x] P2-01 后 patent-core 不再出现在 `vitest.config.ts` 覆盖率排除列表。
- [x] `pnpm run build:check` 通过（由 `pnpm run build` 覆盖）。

## PR 切分

| PR | 任务 | 主题 | 依赖 |
|---|---|---|---|
| PR-1 | P0-01 | 降级原因与重试语义 | 无 |
| PR-2 | P0-02 + P1-04 | LLM JSON 边界 | PR-1 可选 |
| PR-3 | P0-03 | 日期精度 | 无 |
| PR-4 | P0-04 | 证据形式多标签 | 无 |
| PR-5 | P0-05 + P1-02 + P1-03 | 状态 JSON 守卫与输出契约 | 可与 PR-2/4 并行 |
| PR-6 | P1-01 | 取消信号 | 无 |
| PR-7 | P1-05 | 注册表生命周期与死码 | 无 |
| PR-8 | P2-01 + P2-02 + P2-03 | 覆盖率、去重、参数化 | P0/P1 完成后 |
| PR-9 | P2-04 + P2-05 | 文档、快照、升级指南 | 所有可见变化完成后 |

## 执行记录

### 2026-10-18 P0-01

- 状态：已完成
- 基线：patent-core 66 文件 / 1,123 用例通过；typecheck 5 gate 通过；lint 0 warning / 0 error。
- 实现：
  - `handler.ts` 新增 `DEGRADED_ERROR_KEY` / `DEGRADED_RETRYABLE_KEY`，并从 `atoms/index.ts` 导出。
  - `degraded()` 支持 `{ retryable?: boolean }`；`callLlm` 与 `search` 的临时失败标记可重试。
  - `executor.ts` 剥离降级诊断，不写入共享 state；终态失败输出 `[WORKFLOW_DEGRADED] 原因` 且不重试；可重试失败按 `maxRetries` 重试；`lastError` 不再被空输出覆盖。
  - 新增 `packages/patent/patent-workflow/tests/workflow-degradation.spec.ts` 5 条用例。
- 验证：
  - `pnpm exec vitest run packages/patent/patent-workflow/tests/workflow/executor.spec.ts packages/patent/patent-workflow/tests/workflow-degradation.spec.ts` → 20 tests passed。
  - `pnpm exec vitest run packages/patent/patent-workflow packages/patent/patent-core` → 90 files / 1,396 tests passed。
  - `pnpm exec vitest run patent-tools 的 registration / workflow-run` → 59 tests passed。
  - `pnpm run typecheck` → 5 passed, 0 failed。
  - `pnpm exec oxlint` changed files → 0 warnings, 0 errors。
  - 真实 `search` 无 provider 探针：输出 `[WORKFLOW_DEGRADED] [search] 未配置检索器（provider.search 缺失）`，`retries: 0`。
  - 真实 `keywords` LLM 异常探针：调用 3 次，输出 `[WORKFLOW_DEGRADED] [keywords] LLM 调用失败: 网络中断`，`retries: 2`。
- 未覆盖：图路径 `graph/domains/shared.ts` 的 `handlerNode` 仍会把 `_error` 写入图 state；属于同一契约的后续收敛项，留给 P1/P2 统一处理。

### 2026-10-18 P0-02

- 状态：已完成
- 实现：
  - `extract.ts` 按 `output_key` 构造 Schema，只把目标键设为 `required`；提示词给出目标键 JSON 形状。
  - 目标键模式只读取目标数组，缺失、非数组、含非字符串项或模型输出非 JSON 时返回可操作降级。
  - `llm-json.ts` 新增并导出 `parseJsonStringArray(value, label)` 严格校验 helper，供 P1-04 复用。
  - 无 `output_key` 时保持原全量模式与 `required: ['features']`。
  - 新增 `packages/patent/patent-core/tests/extract-atom.spec.ts` 9 条用例。
- 验证：
  - `pnpm exec vitest run packages/patent/patent-core/tests/extract-atom.spec.ts packages/patent/patent-core/tests/atoms.spec.ts packages/patent/patent-core/tests/atoms-coverage.spec.ts` → 69 tests passed。
  - `pnpm exec vitest run packages/patent/patent-core packages/patent/patent-workflow ...` → 93 files / 1,464 tests passed。
  - `pnpm run typecheck` → 5 passed, 0 failed。
  - `pnpm exec oxlint` changed files → 0 warnings, 0 errors。
  - 真实探针：`output_key: 'problems'` + 仅返回 `{ problems: ['问题1'] }` → `{"extraction_result":"...","problems":["问题1"]}`。

### 2026-10-18 P0-03

- 状态：已完成
- 实现：
  - `time-baseline.ts` 的 `readDate` 在 `parseDateFlexible` 前用 `isMonthOnlyDate` 拒绝月级申请日/优先权日，错误文案要求 `yyyy-MM-dd`。
  - `prior-art-filter.ts` 对 `reference_date` 与 `filing_date` 同样拒绝月级输入；月级公开日仍按月末推定，行为不变。
  - 更新两个模块的 JSDoc，明确月级输入无法确定边界时降级，而不是按月初/月末猜测。
- 测试：
  - `time-baseline-atom.spec.ts` 新增月级申请日与中文月级优先权日用例。
  - `prior-art-filter-atom.spec.ts` 新增月级截止日与月级申请日用例。
- 验证：
  - focused `time-baseline` + `prior-art-filter` → 33 tests passed。
  - `patent-core + patent-workflow` → 91 files / 1,407 tests passed。
  - `pnpm run typecheck` → 5 passed, 0 failed。
  - `pnpm exec oxlint` changed files → 0 warnings, 0 errors。
  - 真实探针：`filing_date: '2023-05'` → `[time-baseline] 申请日...仅精确到月...`；`reference_date: '2023-05'` → `[prior-art-filter] 现有技术截止日...仅精确到月...`。
- 行为变化：月级基准日从“按月初可用”变为“降级”，可能改变部分案件的新颖性结论；P2-05 需补升级指南。

### 2026-10-18 P0-04

- 状态：已完成
- 实现：
  - `evidence-check.ts` 的 `EvidenceKind` 单值分类改为 `EvidenceForms` 多标签属性集合。
  - `classifyForms` 分别识别现有技术、外文、域外、证人、电子数据，不再按顺序短路。
  - `checkEntry` 按每个命中的形式逐项运行译本、公证/认证、证人身份、公开日检查；电子数据新增 `EVID-FORM-ELECTRONIC` 待核项。
  - 报告类型标签改为多标签拼接，例如 `[现有技术/外文证据/域外证据]`；单一类型标签保持原样。
- 测试：
  - `evidence-check-atom.spec.ts` 新增复合证据用例，断言同时出现 `EVID-FORM-TRANSLATION`、`EVID-FORM-NOTARIZATION`、`EVID-FORM-LEGALIZATION`。
  - 新增电子数据待核用例；既有单一类型用例全部保持通过。
- 验证：
  - focused `evidence-check` → 32 tests passed。
  - `patent-core + patent-workflow` → 91 files / 1,409 tests passed。
  - `pnpm run typecheck` → 5 passed, 0 failed。
  - `pnpm exec oxlint` changed files → 0 warnings, 0 errors。
  - 真实探针：复合证据 `translated:false`、`notarized:false`、`legalized:false` → 未通过，三项规则同时出现；修复前报告“通过”。
- 行为变化：复合证据可能由“通过”变为“未通过”或“提示”；P2-05 需补升级指南。

### 2026-10-18 P0-05

- 状态：已完成
- 实现：
  - `notice.ts`：`office_action` 必须是 JSON 对象；逐项校验 `rejectionTypes` 取值域、`affectedClaims` 正整数与 `rejectionType` 取值域，错误带下标。
  - `response/plan.ts`：`buildResponsePlan` 改读 `ResponsePlanNotice`（`rejectionType` / `rejectionTypes` / `affectedClaims` 子集），避免为未消费字段伪造值。
  - `chart.ts`：`deriveOfficeActionTargets` 守卫非对象解析产出、`citations` 非数组、引用条目为 `null` 或缺文献号；`parseTargets` 要求条目为对象且 `id` 为非空字符串，错误带下标。
  - `coverage.ts`：移除 `as unknown as ClaimChart`，新增目标、要素、行映射的形状守卫；分别校验 `id`、`kind`、`elementId`、`targetId`、`mapping`，畸形文档降级并带下标。
  - `claim-chart/protocol/types.ts`：新增 `MAPPINGS` / `isMapping` 与 `ChartRowMatch` / `ChartTargetRef` / `ClaimElementRef` 窄读取类型；`all-elements.ts`、`equivalence.ts`、`conclusion.ts` 改用最小读取面，完整 `ClaimChart` 仍可直接传入。
- 测试：
  - 新增 `packages/patent/patent-core/tests/malformed-state.spec.ts` 15 条用例，覆盖 `office_action` 的 `null` / `[]` / `42`、非法驳回理由与权项、`claim_chart_doc` 缺字段与 `null` 条目、非法 `mapping`、`chart_targets` 的 `null` / 缺 `id`、`deriveOfficeActionTargets` 畸形输入。
  - 更新 `atoms-coverage.spec.ts` 中两条旧断言：无 `id` 的目标从“容忍并渲染未命名”改为带下标降级。
- 验证：
  - focused 16 files / 192 tests passed。
  - `patent-core + patent-workflow` → 92 files / 1,424 tests passed。
  - `patent-tools` 的 `engine-tools` / `registration` / `drafting-engine` / `patent-workflow-run` → 4 files / 130 tests passed。
  - `pnpm run typecheck` → 5 passed, 0 failed。
  - `pnpm exec oxlint` changed files → 0 warnings, 0 errors。
- 未覆盖：`patent-tools` 全量测试在本机被 figure real-render 用例长时间占用，已终止；改动路径由上述 4 个相关 spec 覆盖。
- 行为变化：`chart_targets` 条目缺 `id` 由“以空 id 继续”改为降级；畸形 `office_action` / `claim_chart_doc` 由抛 `TypeError` 改为 `_error`。P2-05 需评估升级指南条目。

### 2026-10-18 P1-01

- 状态：已完成
- 根因：`resolveLlmCall` 在 `provider.callLLM` 分支直接返回原函数，`callLlm` 收到的 `signal` 没有作为第三个参数传入；`provider.llm` 端口路径原本已透传。
- 实现：
  - `llm.ts` 的 `callLLM` 分支改为闭包包装，每次调用把调用方 `signal` 作为第三参数传给字符串接缝；`opts` 仍原样传递。
  - 新增 `packages/patent/patent-core/tests/llm-signal.spec.ts` 3 条用例：同一 `AbortSignal` 送达 `callLLM`、abort 后调用方降级、`provider.llm` 端口同样收到同一 signal。
- 验证：
  - focused `llm-signal` → 3 tests passed。
  - `patent-core + patent-workflow` → 93 files / 1,427 tests passed。
  - `pnpm run typecheck` → 5 passed, 0 failed。
  - `pnpm exec oxlint` changed files → 0 warnings, 0 errors。
  - `pnpm run build` → 9 passed, 0 failed。
- 行为变化：取消信号现在能到达 `provider.callLLM`；正常路径输出不变。

### 2026-10-18 P1-02

- 状态：已完成
- 根因：`clearStageOutputs` 按 atom 的全量 `outputSchema` 清理回退阶段产出；`claim-chart` 的条件输出 `claim_chart_paths` 与 `grounds` 的条件输出 `patent_subject` 未声明，回退重跑时旧值会残留。
- 实现：
  - `chart.ts` 的 `claimChartAtom.outputSchema` 追加 `claim_chart_paths`。
  - `notice.ts` 的 `groundsAtom.outputSchema` 追加 `patent_subject`。
  - `stage-outputs.spec.ts` 新增回退清理用例，使用出厂 atom 定义断言两类条件输出键都会被删除。
- 验证：
  - focused `stage-outputs` / `chart-atom` / `atoms-notice` → 3 files / 37 tests passed。
  - `patent-core + patent-workflow` → 93 files / 1,428 tests passed。
  - `pnpm run typecheck` → 5 passed, 0 failed。
  - `pnpm exec oxlint` changed files → 0 warnings, 0 errors。
  - `pnpm run build` → 9 passed, 0 failed。
- 行为变化：回退清理现在会删除这两个条件键；正常路径输出不变。

### 2026-10-18 P1-03

- 状态：已完成
- 根因：`chart_mode` 只在 `CHART_MODES` 内取值，非法值被静默替换为 `invalidity`；调用方的侵权/可专利性输入会按无效模式产出结论，且无任何告警。
- 实现：
  - `CHART_MODES` 改为 `readonly ChartMode[]`，新增 `isChartMode` 类型守卫。
  - 显式非法 `chart_mode` 降级，错误列出取值域；缺省与空白值仍使用 `invalidity`。
  - `atoms-coverage.spec.ts` 更新旧的“非法 mode 回退”断言为降级断言。
  - `chart-atom.spec.ts` 新增两条用例：非法 mode 不调用模型、空白 mode 使用缺省值。
  - 目标校验沿用 P0-05：非对象条目、缺 `id`、非法 `kind` 均带下标降级；对应用例在 `malformed-state.spec.ts` 与 `atoms-coverage.spec.ts`。
- 验证：
  - focused `chart-atom` / `atoms-coverage` / `malformed-state` → 3 files / 62 tests passed。
  - `patent-core + patent-workflow` → 93 files / 1,430 tests passed。
  - `pnpm run typecheck` → 5 passed, 0 failed。
  - `pnpm exec oxlint` changed files → 0 warnings, 0 errors。
  - `pnpm run build` → 9 passed, 0 failed。
- 行为变化：非法 `chart_mode` 由“静默按 invalidity 继续”改为 `[WORKFLOW_DEGRADED]`；P2-05 需评估升级指南条目。

### 2026-10-18 P1-04

- 状态：已完成
- 根因：多个 LLM 原子对数组只做 `Array.isArray` 后直接写入 state，或用 `map(String)` 转换；非字符串项会变成 `[object Object]`，非对象项会让下游按记录字段读取时崩溃。
- 实现：
  - `llm-json.ts` 新增并导出 `parseOptionalJsonStringArray`（缺失视为空数组，存在则严格校验）与 `parseJsonRecordArray`（对象数组，错误带下标）。
  - `keywords`：`keywords` 改为严格字符串数组。
  - `draft-claims`：`claims` 改为严格字符串数组，不再 `map(String)`。
  - `compare`：`claim_chart` 逐项要求对象且 `feature` 非空字符串，校验可选字段类型；`diff_features` 改为严格字符串数组。
  - `novelty`：`assessments` 逐项要求对象、`feature` 非空字符串与布尔 `disclosed`，校验可选字段类型。
  - `extract`：全量模式的 `features` 严格校验，`problems` / `effects` 存在时严格校验；缺失可选数组仍视为空数组。
  - 新增 `llm-array-validation.spec.ts` 9 条用例，并补充 `llm-json.spec.ts` 的 helper 用例。
  - 更新 `atoms-coverage.spec.ts` 中旧的宽容断言：缺必填数组或数组元素类型错误现在降级。
- 验证：
  - focused `llm-array-validation` / `atoms-coverage` / `atoms` / `extract-atom` → 4 files / 78 tests passed。
  - `llm-json` → 11 tests passed。
  - `patent-core + patent-workflow` → 94 files / 1,442 tests passed。
  - `patent-tools` 的 eval / workflow-run / engine / drafting / registration / index / chain-executor / flexible-plan / plan-task → 9 files / 190 tests passed。
  - `pnpm run typecheck` → 5 passed, 0 failed。
  - `pnpm exec oxlint` changed files → 0 warnings, 0 errors。
  - `pnpm run build` → 9 passed, 0 failed。
- 行为变化：JSON 对象缺必填数组（`features` / `claims` / `claim_chart` / `assessments`）或数组元素类型错误时，由“保留原文或静默过滤”改为降级；非 JSON 文本仍保留原文兜底。P2-05 需评估升级指南条目。

### 2026-10-18 P1-05

- 状态：已完成
- 决策：
  - `AtomRegistry.register` / `StageHandlerRegistry.register` 返回 disposer；disposer 只删除“名称仍指向本次注册”的条目，重复调用幂等，旧 disposer 不删除后来者的覆盖。`RegisterAtom` 同样返回 disposer。
  - `registerBuiltinAtoms()` 保持全局共享注册：内置原子由 patent-core 提供给多个插件，归属核心而非单个插件；不做按插件撤销，避免一个插件卸载拆掉另一个插件的依赖。
  - patent-tools 自有的 6 个 atom/handler 改为 `ctx.effect` 注册，插件 dispose 时成组撤销。
  - 删除 `StageError`：预期失败统一走 `degraded()`，人工中断走 `InterruptStageError`；该类无调用点，属于遗留死代码。移除是预发布 API 变更，P2-05 需写升级指南。
- 实现：
  - `atom.ts` / `handler.ts` 的 `register()` 返回幂等 disposer，并记录“不删除后继”的契约。
  - `RegisterAtom` 返回 `globalAtomRegistry.register(atom)` 的结果。
  - `handler.ts` 模块头的错误模型改为“degraded 片段 / InterruptStageError / 其它异常由执行器处理”。
  - `patent-tools/src/index.ts` 新增 `registerPackageAtoms(ctx, pairs)`，用一个 `ctx.effect` 注册并成组撤销 6 个 atom 与 handler。
  - 新增 `patent-tools/tests/registration-dispose.spec.ts`，验证 dispose 后本包 atom/handler 消失、patent-core 内置保留。
  - `atoms.spec.ts` 新增注册表 disposer 语义用例；`atoms-coverage.spec.ts` 移除 `StageError` 构造用例。
- 验证：
  - focused registry / registration → 4 files / 73 tests passed。
  - `patent-core + patent-workflow` → 94 files / 1,443 tests passed。
  - `patent-tools` 的 registration / dispose / engine / workflow-run / workflow → 5 files / 84 tests passed。
  - `pnpm run typecheck` → 5 passed, 0 failed。
  - `pnpm exec oxlint` changed files → 0 warnings, 0 errors。
  - `pnpm run build` → 9 passed, 0 failed。
- 行为变化：`StageError` 不再导出；注册表新增 disposer。P2-05 需补升级指南。

### 2026-10-18 P2-01

- 状态：已完成
- 基线：`patent-core` 逐文件覆盖率 94.39% statements / 88.69% branches；Atom 层 269 处未覆盖，非 Atom 层约 130 处未覆盖；`vitest.config.ts` 将整个 `patent-core/src` 排除在覆盖率门禁外。
- 实现：
  - `vitest.config.ts` 移除 `packages/patent/patent-core/src/**/*.{ts,tsx}` 排除项，并把注释中的已达标包更新为 8 个；patent-core 于 2026-10-18 实测 100/127 个文件。
  - Atom 层补齐可达路径测试：`amendment-basis` 的行内标题、跨行权项、重复原文、空规范化文本与超长前缀匹配；`evidence-check` 的期限/日期类型、布尔字段、域外待核、单字符串关联理由；`prior-art-filter` 的非对象条目、非法字段、A24 未判定；`coverage` 的逐字段畸形文档；`conflicting-application` 的标题回退、缺公开日与目标日期键；`compare`/`novelty` 的可选字段与非 JSON 兜底；`problem-check` 的重复 diff、片段 JSON、短问题与无特征；`search` 的畸形条目与元数据回退；`pfe` 的长文本与空对象；`numeric-range` 的空白条目；`notice`/`chart`/`draft`/`time-baseline` 的缺失字段与回退路径。
  - 删除不可达防御分支：`amendment-basis` 的每键数组判定、越界 `??`、恒非空结果分支；`evidence-check` 的完整性/期限/报告错误分支改为执行器拒绝后的窄类型；`prior-art-filter` 的公开日结果改为判别联合；`conflicting-application` 的恒非空日期前缀；`claim-coverage` 的越界索引回退；`unity` 的重复文本索引；`checker/engine` 的恒真级别判断；`invalidity-conclusion` 的空要素判断；`chart` 的恒非空目标 id。
  - 修复真实缺陷：`loadClaimChart` 对缺 `gaps` 字段的旧文件补空数组，避免返回与 `ClaimChart` 类型不符的对象。
  - 为零散但不可达的守卫添加带理由的 `v8 ignore`（固定正则捕获组、矩阵原理编号、数值模式捕获组、证据引擎必然提供的 id）。
  - 新增 `packages/patent/patent-core/tests/pdf-download.spec.ts`，覆盖 PDF 三检与日期目录。
- 验证：
  - `pnpm exec vitest run packages/patent/patent-core` → 71 files / 1,264 tests passed。
  - 覆盖率（per-file 100% 阈值，include 全部 `patent-core/src`）→ 0 处未覆盖，`All files 100 / 100 / 100 / 100`。
  - `pnpm exec vitest run packages/patent/patent-workflow` → 24 files / 273 tests passed。
  - `patent-tools` 相关 13 files / 245 tests passed（全量仍被 figure real-render 用例长时间占用，按既有记录跳过）。
  - `pnpm run typecheck` → 5 passed, 0 failed。
  - `pnpm exec oxlint` changed files → 0 warnings, 0 errors。
  - `pnpm run build` → 9 passed, 0 failed。
- 行为变化：`loadClaimChart` 现在为缺 `gaps` 的旧文件返回 `gaps: []`；其余为测试与死分支清理，正常路径输出不变。

### 2026-10-18 P2-02

- 状态：已完成
- 根因：`citation.ts` 的 `resolveRefTextKeys` / `resolvePriorArtKey` 与 `time-baseline.ts` 的 `resolveDateKey` 分别复述了 `state-keys.ts` 中 `resolveKeyList` / `resolveConfiguredKey` 的同一套语义（缺省回退、非空字符串校验、保留原样空格）。
- 实现：
  - `citation.ts` 删除两个本地解析函数，改用 `resolveKeyList(state, 'ref_text_keys', DEFAULT_CITATION_REF_TEXT_KEYS)` 与 `resolveConfiguredKey(state, 'prior_art_key', DEFAULT_CITATION_PRIOR_ART_KEY)`。
  - `time-baseline.ts` 删除 `resolveDateKey`，改用 `resolveConfiguredKey` 解析 `filing_date_key` / `priority_date_key`。
  - 两个 spec 各新增“配置键保留首尾空格”用例，固定共享 helper 的“不 trim 键名”语义。
  - `scripts/duplication-baseline.json` 通过 `duplication:baseline` 移除一条已不再报告的 `compare.ts` 自身克隆记录；本次仅删除陈旧项，未接受新克隆。
- 验证：
  - focused `citation-check` / `time-baseline` → 2 files / 25 tests passed。
  - `patent-core` 全量 → 1,266 tests passed；覆盖率保持 `All files 100 / 100 / 100 / 100`。
  - `pnpm run duplication` → 0 repo-wide clones；82 tightened-domain pairs 与基线一致。
  - `pnpm run typecheck` → 5 passed, 0 failed。
  - `pnpm exec oxlint` changed files → 0 warnings, 0 errors。
  - `pnpm run build` → 9 passed, 0 failed。
- 行为变化：无；合法的带空格配置键继续按原样读取，非法配置仍在同一位置降级。

### 2026-10-18 P2-03

- 状态：已完成
- 根因：温度、提示词截断长度、claim-chart 重做次数与 groundedness 低分阈值分散为 handler 内常量；部署方无法从 stage params 调整，阈值还同时写在提示词与过滤逻辑中。
- 实现：
  - 新增 `packages/patent/patent-core/src/atoms/tunables.ts`：
    - `readTemperature`（0-2）、`readMaxRetries`（0-10 整数）、`readPromptCharLimit`（正整数）、`readGroundednessThreshold`（0-1）四个单项读取器。
    - `readAtomTunables` 一次读取 handler 所需字段，返回首个非法值的降级原因；`promptLimitConfigured` 区分“显式配置”与“handler 默认”，让同一 handler 的多个文本块各自保留默认上限。
    - `DEFAULT_GROUNDEDNESS_THRESHOLD = 0.6` 作为共享默认值；`GROUNDEDNESS_THRESHOLD` 继续导出并指向同一值。
  - `extract`、`draft-claims`、`compare`、`novelty`、`keywords`、`reasoning`、`groundedness`、`claim-chart` 在调用模型前读取参数；非法值返回 `degraded` 且不调用模型。
  - `temperature` 覆盖各 handler 原有默认（0/0.1/0.2）。
  - `prompt_char_limit` 覆盖每个 prompt 数据块的上限；未配置时保留既有分块默认（例如 compare 的权利要求 4000、现有技术 6000，draft 的分析结果 8000、新颖性结论 2000）。
  - `max_retries` 用于 `claim-chart` 的校验重做循环；工作流执行器的重试次数仍由 manifest `validation.maxRetries` 配置。
  - `groundedness_threshold` 同时驱动低分过滤与提示词中的分数分界，避免提示与判定不一致。
  - `compare.ts` 的两个 `parseLlmJson` 回调提取为模块级解析函数，消除新的同文件克隆。
- 测试：
  - 新增 `packages/patent/patent-core/tests/atom-tunables.spec.ts` 29 条用例：四个读取器的缺省/合法/类型/非有限值/越界路径；8 个 handler 的非法 `temperature` 与 `prompt_char_limit` 降级；chart 的非法 `max_retries`；groundedness 的非法阈值；温度透传、提示词截断、`max_retries=0` 与阈值 0.9 的行为。
- 验证：
  - `patent-core` 全量 → 1,295 tests passed；覆盖率保持 `All files 100 / 100 / 100 / 100`。
  - `pnpm run duplication` → 0 repo-wide clones；82 对收紧域克隆与基线一致。
  - `pnpm run typecheck` → 5 passed, 0 failed。
  - `pnpm exec oxlint` changed files → 0 warnings, 0 errors。
  - `patent-workflow` → 24 files / 273 tests passed。
  - `patent-tools` 相关 8 files / 178 tests passed。
  - `pnpm run build` → 9 passed, 0 failed。
- 行为变化：未设置新参数时输出与调用参数完全不变；显式设置非法值时由原先被忽略改为降级。

### 2026-10-18 P2-04

- 状态：已完成
- 根因：`patent-core` 的英文/中文 README 与 `atoms/index.ts` 文件头仍写“15 个/fifteen 内置 handler”，且只列出早期 15 个原子；实际 `registerBuiltinAtoms()` 注册 24 个，`patent-tools` 另注册 6 个包内原子。
- 实现：
  - `README.md` / `README.zh.md` 的 frontmatter 描述与 Summary/概述改为 24 个内置 handler。
  - Atoms 引擎段按职责列出全部 24 个原子（11 个模型/检索阶段 + 13 个确定性法律检查），并写明 `patent-tools` 以插件 effect 另注册 `slop-gate`、`draft-specification`、`spec-check`、`response-check`、`eligibility`、`legal-gaps` 6 个包内原子。
  - `src/atoms/index.ts` 文件头改为 24 个内置原子的分组清单，`registerBuiltinAtoms` JSDoc 标明数量；同时说明工具侧另注册 6 个。
  - `README.i18n.yaml` 通过 `pnpm run verify-translation-pairing --write packages/patent/patent-core/README.md` 重新记录双语段落哈希。
  - `docs/TECH_DEBT.md` 的 `lint.v8-ignore` 计数由 1166 更新为 1178，并记录本次覆盖率收口新增的带理由豁免；`structure.long-functions` 保持 186：把 `claim-chart` 执行器的目标源预读与目标清单渲染拆成模块级函数，避免本次改动新增超长函数。
- 验证：
  - `pnpm run verify-tech-debt-counters` → 5 declared counters match。
  - `pnpm run test:docs` → 29 passed, 0 failed（本机预存的被忽略生成目录 `litho.docs/patent/README.md` 会被 translation pairing 扫到；验证时临时移出、跑完恢复，仓库未改动该目录）。
  - `patent-core` 全量 → 1,295 tests passed；覆盖率保持 `All files 100 / 100 / 100 / 100`。
  - `pnpm run duplication` → 0 repo-wide clones；82 对收紧域克隆与基线一致。
  - `pnpm run typecheck` → 5 passed, 0 failed。
  - `pnpm exec oxlint` changed files → 0 warnings, 0 errors。
  - `pnpm run build` → 9 passed, 0 failed。
- 行为变化：无；仅文档、文件头与结构计数更新。

### 2026-10-18 P2-05

- 状态：已完成
- 快照：
  - `pnpm run test:snapshot -t patent` → 11 个 `snapshots/session/patent-*` 场景全部通过，215 个非 patent 用例跳过。
  - 默认路径的输出未变化，因此没有需要接受的快照差异，也未改动 `snapshots/session/patent-*`。
  - 未新增降级快照：`[WORKFLOW_DEGRADED]` 是执行器生成的确定性文本，`workflow-degradation.spec.ts` 已覆盖终态、重试成功、重试耗尽与部分结果四条路径；现有 11 个 patent 会话都是成功路径，新增 authored 降级会话只会复制执行器断言，不增加模型可见知识。
- 升级指南：根 `package.json` 版本为 `0.2.1-rc.2`，新增 4 个条目，每个含 `guide.md`、`guide.zh.md` 与 `guide.i18n.yaml`：
  - `patent-atom-fail-closed`：月级日期、复合证据、畸形 JSON、非法 `chart_mode`、严格 LLM 数组与非法调参改为降级。
  - `patent-workflow-degradation-output`：失败阶段输出 `[WORKFLOW_DEGRADED] <原因>`；终态失败不重试，临时失败按 `maxRetries` 重试；`_error`/`_retryable` 不进入共享 state。
  - `patent-core-registry-disposers`：注册表与 `RegisterAtom` 返回 disposer；`StageError` 移除；插件卸载回滚包内原子。
  - `patent-claim-chart-legacy-gaps`：`loadClaimChart` 对缺 `gaps` 的旧文件返回 `[]`。
- 验证：
  - `pnpm run verify-upgrade-guides` → 全部合规。
  - `pnpm run verify-translation-pairing` → 1,374 对，全部一致。
  - `pnpm run verify-md-links` → 2,738 个文件，相对链接与锚点全部可解析。
  - `pnpm run test:docs` → 29 passed, 0 failed（验证时临时移出被忽略的 `litho.docs/`，跑完恢复）。
- 行为变化：仅文档；默认路径的会话输出未变。

### 2026-10-18 审查修复

- 状态：已完成
- `evidence-check` 月级公开日：比较日期改为月末（`Date.UTC(year, month + 1, 0)`），与报告文案及 `prior-art-filter` 一致；新增截止日为月中（`2024-06-15`）的负向用例，确认 `EVID-TIME-NOT-PRIOR-ART` 阻断。
- 调参文档：`patent-core` 中英文 README 的 Atoms 段新增键、类型、默认值与适用范围表；`tunables.ts` 的 `prompt_char_limit` JSDoc 收窄为“prompt 中引用的来源文本”，不再声称覆盖每个数据块。
- 计数与指南：`vitest.config.ts` 的 patent-core 文件数由 127 更新为 128；`patent-atom-fail-closed` 指南补充 `product` 是 `accused-product` 的合法别名，并直接列出全部 mapping 取值，不再引用未导出的 `MAPPINGS`。
- 注册表 disposer：`AtomRegistry` / `StageHandlerRegistry` 为每次注册生成独立令牌；即使重复注册同一对象，旧 disposer 也不会删除后继。新增同对象重复注册用例。
- 测试清理：`registration-dispose.spec.ts` 用 `try/finally` 保证断言失败时仍释放插件 effect。
- 快照理由：在 P2-05 记录中写明降级输出由 `workflow-degradation.spec.ts` 覆盖，新增 authored 降级会话不会增加模型可见知识，因此不改 `snapshots/session/patent-*`。
- 验证：`patent-core` 1,297 tests passed、覆盖率 100%；`patent-workflow` 与 tools 相关 27 files / 304 tests passed；`typecheck` 5/5；`oxlint` 0/0；`duplication` 0 克隆；`build` 9/9；`test:docs` 29/29。
