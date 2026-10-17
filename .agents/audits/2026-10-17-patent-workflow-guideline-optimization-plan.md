# 专利工作流审查指南优化 — 任务清单与检查清单（2026-10-17）

- 基线：`master` 工作树（2026-10-17）。本清单只描述待办工作，不含任何行为变更。
- 范围：`packages/patent/patent-workflow` 的 8 个内置 manifest、`packages/patent/patent-core/src/graph/domains` 的 4 个域图、`patent-core`/`patent-tools` 中已存在但未接线的确定性检查器。
- 调研依据：《专利审查指南》与 `packages/patent/patent-law/assets/law/cn-examination-guidelines.yaml`（`revision: 2023 年修订版（2024-01-20 施行）`；2026 年版 2026-01-01 施行的差异见 §4 G-02）。
- 已知依赖缺陷：数值范围解析存在两套实现且结论分叉（`patent-core/src/novelty/numeric-range.ts` ↔ `patent-tools/src/tool/validate-specification.ts`），见 `.agents/audits/2026-09-21-patent-domain-review-manifest.md` #174 与 `2026-09-23-issue-triage-and-execution-plan.md` §6。
- 用途：按批推进，每批完成后回写本文「执行状态」列。

## 1. 结论（四类缺口）

1. **法定阶段缺失**：新颖性缺时间基准与抵触申请；披露缺 A2/A5/A25 客体与 A26.3/A26.4/A31 校验；可专利性缺客体与撰写校验；OA 缺 A26.3 表述位置、理由覆盖与 A33 修改依据；无效缺请求书形式要件与证据规则；复审缺审查范围；侵权缺现有技术抗辩。
2. **既有确定性能力未接线**：`validateSpecification`、`spec-claim-coverage`、`checkClaimUnity`、`numeric-range`、`enablement` 图、`citation-check`、`patent-rule` 的 `PR-OA-007/008/009` 都已存在，但没有任何 manifest 引用。
3. **程序缺口**：无效请求书形式、证据关联性、专利权人修改限制、复审范围、OA 理由覆盖与修改依据均未进入工作流。
4. **指南版本与证据治理**：随包指南正文是 2023 修订版，2026 版已施行且至少 3 个索引节是旧文本；工作流结论没有证据台账，引用的对比文件无法从会话日志重建。

## 2. 优先级与原则

- **P0 = 阻断**：不做会导致后续批量固化错误法律前提。
- **P1 = 正确性**：接线后改变结论，必须附正反例与键控快照。
- **P2 = 覆盖**：补阶段，不改变已有判定语义。

原则：

1. 先接既有能力，后写新原子；每个 S 项必须标注「包装既有 / 新能力」。
2. 先做指南版本治理与基线快照，再改任何 manifest。
3. 垂直切片交付：原子 + 第一个消费它的阶段 + 正反例断言 + 快照同一 PR；仅当原子被 ≥2 个 manifest 消费时才拆「契约注册」前置 PR。
4. 法律正确性可验收：每个新阶段配 1 正例 + 1 反例，反例必须走拒绝路径。
5. Model-visible ⟺ logged：证据台账与法律缺口必须落入 `SessionEventMap` 并更新双 SDK 投影。

## 3. 任务总览

| ID | 标题 | 类型 | 优先级 | 依赖 | 执行状态 |
|---|---|---|---|---|---|
| G-01 | 基线快照 | 基线 | P0 | — | 已完成（2026-10-17） |
| G-02 | 2026 版指南治理元数据 | 资产/治理 | P0 | — | 部分完成（2026-10-17，PR-1z）：3 个已确认过时节已按 2026 修改对照表转录为 `versions` 覆盖；`verifyCitation` 支持按版本选择；其余节仍为 2023 文本，2026 合订全文未随包 |
| G-03 | `guidelineRevision` 加载期校验 | 契约 | P0 | G-02 | 已完成（2026-10-17） |
| G-04 | 数值范围解析分叉收敛 | 修复 | P0 | — | 已完成（2026-09-24 合入） |
| S-01 | `time-baseline` 原子 | 包装既有 | P1 | G-01 | 已完成（2026-10-17，PR-1c） |
| S-02 | `prior-art-filter` 原子 | 新能力+既有 | P1 | S-01 | 已完成（2026-10-17，PR-1d） |
| S-03 | `conflicting-application` 原子 | 新能力 | P1 | S-01 | 已完成（2026-10-17，PR-1e） |
| S-04 | `eligibility` 原子 | 包装既有 | P2 | G-01 | 已完成（2026-10-17，PR-1k） |
| S-05 | `numeric-range` 原子 | 包装既有 | P1 | G-04 | 已完成（2026-10-17，PR-1f） |
| S-06 | `spec-check` 原子 | 包装既有 | P1 | G-01 | 已完成（2026-10-17，PR-1a） |
| S-07 | `problem-check` 原子 | 新能力 | P1 | — | 已完成（2026-10-17，PR-1g） |
| S-08 | `citation-check` 原子 | 包装既有 | P1 | — | 已完成（2026-10-17，PR-1b） |
| S-09 | `evidence-check` 原子 | 新能力组合 | P1 | — | 已完成（2026-10-17，PR-1j） |
| S-10 | `response-check` 原子 | 包装既有 | P1 | — | 已完成（2026-10-17，PR-1h） |
| S-11 | `amendment-basis` 原子 | 新能力 | P1 | — | 已完成（2026-10-17，PR-1i） |
| W-01 | 新颖性 manifest 接线 | 接线 | P1 | S-01/02/03/05/08 | 已完成（2026-10-17，PR-1v）：S-01/S-02/S-03/S-05/S-08 与 R-03 `legal-gaps` 全部接线；检索改为 `search` 原子并新增关键词阶段 |
| W-02 | 披露 manifest 接线 | 接线 | P1 | S-01/02/04/06/08 | 已完成（2026-10-17，PR-1o/PR-1y）：S-01/S-02、S-06 spec+claims 模式、S-08、S-04 与 R-03 `legal-gaps` 全部接线；新增说明书草案原子后 A26.3 纳入汇总 |
| W-03 | 创造性 manifest 接线 | 接线 | P1 | S-01/02/07/08 | 已完成（2026-10-17，PR-1v）：S-01/S-02/S-07/S-08 与 R-03 `legal-gaps` 全部接线 |
| W-04 | 可专利性 manifest 接线 | 接线 | P1 | S-01/02/04/06 | 已完成（2026-10-17，PR-1o/PR-1x/PR-1y）：S-04、S-06 spec+claims 模式、R-03、S-01/S-02 全部接线；claim-chart 可从过滤后的 `prior_art` 派生对比文件 |
| W-05 | OA 答复 manifest 接线 | 接线 | P1 | S-10/11 | 已完成（2026-10-17，PR-1m）：S-10/S-11/R-03 均已接 |
| W-06 | 无效 manifest 接线 | 接线 | P2 | S-08/09 | 已完成（2026-10-17，PR-1n）：S-09、S-08 与 R-03 `legal-gaps` 已接 |
| W-07 | 复审 manifest 接线 | 接线 | P2 | S-08/09 | 已完成（2026-10-17，PR-1n）：S-09、S-08 与 R-03 `legal-gaps` 已接 |
| W-08 | 侵权 manifest 接线 | 接线 | P2 | S-08 | 部分完成（2026-10-17，PR-1n）：R-03 `legal-gaps` 已接；claim-construction、equivalence-check、prior-art-defense 待做 |
| C-01 | 原子契约注册 | 契约 | P1 | 各 S 项 | 已完成（2026-10-17，PR-1w）：S-01..S-11 均有 Atom 契约与 StageHandler；完整组合注册表与 manifest 引用集合由 `registration.spec.ts` 断言 |
| C-02 | 依赖契约测试 | 测试 | P1 | S-03 | 已完成（2026-10-17，PR-1e）：`conflicting-application` 不消费检索；`citation-check` 读取 `prior_art` + `conclude` |
| C-03 | SessionEventMap 新成员 | 契约 | P0 | R-01/03 | 已完成（2026-10-17，PR-1s）：`patent/workflow-run`、`patent/evidence-ledger`、`patent/legal-gaps` 在 service 与 `patent_workflow_run` 路径统一由 `appendWorkflowRunEvents` 写出 |
| C-04 | 加载期版本校验失败即失败 | 契约 | P0 | G-03 | 已完成（随 G-03） |
| C-05 | recap 模式降级与持久化 | 契约 | P1 | 各 W 项 | 已完成（2026-10-17，PR-1u）：recap 全 manifest 的原子阶段缺省输出按 degraded 记录并持久化；`patent_workflow_run` graph 路径有降级标记时 `completed=false`，与 manifest 路径一致 |
| C-06 | 阶段数/预算 Config | 契约 | P2 | — | 已完成（2026-10-17，PR-1w）：`workflowStageBudget` / `workflowLlmStageBudget` 为 Config 字段，加载期按 manifest 校验 |
| R-01 | 证据台账接线 | 基础设施 | P1 | — | 已完成（2026-10-17，PR-1p）：运行结果 `evidenceLedger` + `patent/evidence-ledger` 事件（service 与 `patent_workflow_run` 路径） |
| R-02 | 引用-证据闭环 | 基础设施 | P1 | R-01/S-08 | 已完成（2026-10-17，PR-1q）：`citation-check` 的 D 标号按台账 prior-art 收据接地 |
| R-03 | legal-gaps 聚合器 | 基础设施 | P1 | — | 已完成（2026-10-17，PR-1m/1n/1o）：确定性聚合 + `patent/legal-gaps` 事件；八个内置 manifest 均已接入 |
| R-04 | 回放一致性测试 | 测试 | P1 | R-01/03 | 已完成（2026-10-17，PR-1r）：写入磁盘 → 用 session 日志重建 → 断言 ledger/gaps 与持久化运行一致 |
| R-05 | 双 SDK 投影更新 | 契约 | P0 | C-03 | 已完成（2026-10-17，PR-1t）：两个 SDK 的 expected 均不按事件名生成，投影面核对无改动；TS SDK 快照 28/28、Python SDK 单测 231 通过、`pnpm run test` 全绿 |

## 4. 分阶段任务

### G 系列：前置与基线

#### G-01 基线快照（P0）

- 在任何 manifest/原子改动前，对 8 个内置 manifest + 4 个域图重录键控快照并提交；基线提交必须先于首个行为变更。
- 验证：`pnpm run test:snapshot -t patent` 在干净树上通过。
- 证据位置：`snapshots/session/patent-*`。
- 完成记录：2026-10-17 运行 `pnpm run test:snapshot -t patent`，11 个 patent 快照通过；同日 335 个 patent 单元测试通过。未重录快照，因为本次没有触及 manifest 阶段链。

#### G-02 2026 版指南治理元数据（P0）

- 已实现（元数据）：指南资产新增 `supersededBy` 与 `staleSections`，3 个已确认过时节（第二部分第一章4.4、第四部分第三章2.1、第四部分第三章3.3）机器可读；`verifyCitation` 对命中过时节的引用（含父节与子节）返回 `unverified`，不再把旧文本当作现行条文核验。
- 已实现（最小版本闭环，2026-10-17）：资产新增 `versions`，只收录 2026 年修订版已确认修改的 3 节；正文按 2025-11-13 局令第84号修改对照表新栏的颜色标记转录（删除线文字剔除）。`verifyCitation` 新增 `revision` 选项：未指定时，若 `supersededBy` 已由某个版本转录，使用最后声明的版本（版本从旧到新声明）；若 `supersededBy` 尚未转录，使用基础文本与 `staleSections`；`supersededBy` 未声明时使用最后一个版本，没有版本则用基础文本。指定 2023 年修订版时用基础文本与 `staleSections`，指定索引没有的版本时报 `unverified`。其余 61 条节级条目仍是 2023 年文本，不声称已更新。
- 资产解析校验：`staleSections` 必须指向已索引的节；`versions` 只允许出现在指南索引，`revision` 非空、不得重复、不得等于基础 `revision`，每项至少一个 section，同一版本内路径不得重复；非指南法条声明 `versions` 或 `staleSections` 即加载失败。
- 未完成：完整 2026 版全文资产。本机有官方修改对照表（PDF 与 Markdown 转换），但没有 2026 年合订全文；对照表列出的 57 处改动中，只有 3 处已确认落在当前索引的节上并完成转录。其余改动可能涉及未索引的节、新增节（如第二部分第九章第7节）或节号改号，需逐条核对后扩写 `versions`。
- 完成条件：拿到官方 2026 年合订全文（或按对照表逐条核对 57 处改动）后，补齐受影响节与新增节，重核路径编号，再声明 2026 版全文资产；在那之前 `sections` 仍是 2023 年基础文本，`versions` 只覆盖已确认的 3 节。
- 证据：`packages/patent/patent-law/assets/law/cn-examination-guidelines.yaml` 的 `versions`、`src/baseline.ts` 的 `readVersions`、`src/verify.ts` 的 `guidelineView`、`tests/baseline.spec.ts` 与 `tests/verify.spec.ts` 的版本用例。

#### G-03 `guidelineRevision` 加载期校验（P0，依赖 G-02）

- 已实现：`WorkflowManifest` 新增 `guidelineRevision`；`validateWorkflowManifest` 接受期望版本，声明缺失、空串或不一致即抛 `WorkflowError`；`runWorkflow` 透传 `options.guidelineRevision`。
- 8 个内置 manifest 全部声明 `SHIPPED_GUIDELINE_REVISION`；`patent-tools` 的 `Config.guidelineRevision` 默认为该常量，并在 `apply()`（插件加载）校验全部内置 manifest。
- 版本真源仍是 `patent-law` 资产：部署换用其他 `revision` 的资产时，把同一字符串设进 `patent-tools` 配置即可让旧清单在加载期失败。
- 验证：`patent-core/tests/misc-coverage.spec.ts` 覆盖空串/缺失/不一致；`patent-tools/tests/registration.spec.ts` 覆盖插件加载失败。

#### G-04 数值范围解析分叉收敛（P0）

- 已完成（2026-09-24 合入）：连接符与单位词表抽到 `numeric-vocabulary.ts` 单点定义，规格校验侧复用同一词表；仅保留一条有理由的规则差异——规格校验要求尾随单位（端点/中点比对需要同单位单值）。
- 对拍测试已存在：`packages/patent/patent-tools/tests/validate-specification.spec.ts` 的 `SHARED_VOCABULARY_CASES` 覆盖 `20℃ 至 90℃`、`50-80`、`20到90℃`、`25°c`、`70%—75%` 等 11 条样本。
- 本次复核：`numeric-range.spec.ts`（26 例）与 `validate-specification.spec.ts`（66 例）均通过，未再改代码。

### S 系列：共享原子

每个 S 项在 PR 描述里给出「包装既有 / 新能力」映射与正反例。

| ID | 原子 | 包装/新能力 | 法条依据 | 既有实现 | 预期消费方 |
|---|---|---|---|---|---|
| S-01 | `time-baseline` | 包装既有 | A22.2 现有技术、A29 优先权 | `patent-core/src/evidence/date.ts`（`priorArtReference`/`isBeforeReferenceDate`） | W-01/03/04 |
| S-02 | `prior-art-filter` | 新能力+既有 | A22.2、A24 宽限期 | 同上 + 宽限期规则 | W-01/03/04 |
| S-03 | `conflicting-application` | 新能力 | A22.2 第二句 抵触申请 | 无（输入契约见 C-02） | W-01 |
| S-04 | `eligibility` | 包装既有 | A2/A5/A25 客体 | `patent-rule` 客体规则 | W-02/04 |
| S-05 | `numeric-range` | 包装既有 | 指南第二部分第三章 数值范围 | `patent-core/src/novelty/numeric-range.ts`（G-04 收敛后） | W-01/04 |
| S-06 | `spec-check` | 包装既有 | A26.3/A26.4/A31 | `patent-tools/src/tool/validate-specification.ts`、`patent-tools/src/tool/spec-claim-coverage.ts`（`checkClaimCoverage`/`checkClaimSet`）、`patent-core/src/claim-coverage/unity.ts`（`checkClaimUnity`） | W-02/04 |
| S-07 | `problem-check` | 新能力 | A22.3 三步法第二步 | 无 | W-03 |
| S-08 | `citation-check` | 包装既有 | 引用真实性 | `patent-core/src/graph/domains/citation-check.ts` | W-01/03/06/07/08 |
| S-09 | `evidence-check` | 新能力组合 | 无效/复审证据规则 | `patent-core/src/evidence/date.ts`、`receipt.ts` | W-06/07 |
| S-10 | `response-check` | 包装既有 | OA 答复规范 | `patent-rule` `PR-OA-007/008/009` | W-05 |
| S-11 | `amendment-basis` | 新能力 | A33 修改依据 | 无 | W-05 |

- `time-baseline` 输出：`reference_date`（申请日与优先权日较早者）、`reference_basis`、`filing_date`、`priority_date`。日期由调用方显式给出，任一已提供但不可解析即降级；`prior_art_date` 不在基准阶段推断，单篇公开日判定归 S-02。
- `prior-art-filter` 输出：过滤后的 `prior_art`、`prior_art_excluded`、`prior_art_undated` 与主输出 `prior_art_filter_report`。公开日字段默认 `publicationDate`，A24 标注默认 `a24Exception`（`A24.1`–`A24.4`）；未知公开日保留并单列，非法 A24 标注或不可解析的截止日/申请日降级。
- `conflicting-application` 输出：主输出 `conflicting_application_report`，以及 `conflicting_applications`、`conflicting_application_excluded`、`conflicting_application_unknown`。候选字段 `filingDate`/`publicationDate`（必填）、`priorityDate`、`sameInvention`；时间规则为申请日以前提出、申请日以后（含申请日）公布，日期仅到月时降级；`sameInvention` 缺失进入待定，不默认成立。
- `numeric-range` 输出：主输出 `numeric_range_report`，以及 `numeric_range_verdict`、`numeric_range_overlaps`、`numeric_ranges`。权利要求侧默认读取 `claim`/`claim_text`/`features`，全缺失时回退 `source_text`/`text`/`input`/`extraction_input`；对比侧读取 `prior_art` 条目的 `text`/`snippet`/`abstract`/`title`。只有带单位的强发现参与判定；缺文本给 `inconclusive`，类型错误降级。
- `problem-check` 输出：主输出 `problem_check_report`，以及 `problem_check_passed`、`problem_check_violations`。读取 `diff`/`inventiveness_diff` 的 JSON 或平面文本与 `distinguishing_features`/`diff_features`；违规代码为 `PROBLEM-EQUALS-FEATURE`（问题复述区别特征，阻断）、`PROBLEM-SOLUTION-BINDING`、`PROBLEM-MULTI-CAUSAL`（阻断）与 `PROBLEM-UNMEASURED`（质量提示）。缺问题文本放行并写明原因，类型错误降级。
- `amendment-basis` 输出：主输出 `amendment_basis_report`，以及 `amendment_basis_passed`、`amendment_basis_violations`、`amendment_basis_scope`。从答复正文的“修改后权利要求”段提取权项，与同号原权项做字符级 LCS 差异，新增片段再回原说明书/原权利要求书检索；没有该段时视为未修改并放行，有修改但缺原申请文件时降级。
- `evidence-check` 输出：主输出 `evidence_check_report`，以及 `evidence_check_passed`、`evidence_check_violations`、`evidence_check_pending`。证据条目字段包括 `type`、来源、`submittedAt`、`publicationDate`、`translated`/`notarized`/`legalized`、`witness`、`grounds`/`claimRefs`、`contentHash`+`snippet`、`lateJustification`。逾期无理由、外文无译本、证人无身份、公开日不早于截止日、内建哈希不匹配为阻断项；域外未公证认证、未披露利害关系、未关联争点、外部哈希无法校验为提示/待核项。未提供证据清单时报告“未执行”并放行。
- `eligibility` 输出：主输出 `eligibility_report`，以及 `eligibility_passed`、`eligibility_verdict`、`eligibility_violations`、`eligibility_units`、`eligibility_pending`。按权利要求（有行首编号时逐项）或技术交底书整体筛查 A25 客体类别：纯智力活动规则、疾病诊断/治疗方法、动植物品种本身、原子核变换方法为阻断项；动植物品种生产方法、科学发现、印刷品图案、商业方法、边界智力活动主题为提示项；含技术特征的权利要求不按 A25 排除，仅提示 A2.2 判断。A5 复用 `EX-SEL-004` 关键词规则，仅给提示；规则资产缺失或加载失败列入待核。
- `spec-check` 用 `mode: 'spec' | 'claims'` 区分说明书充分公开/清楚支持与权利要求覆盖校验，不新写已由 `validateSpecification`/`checkClaimUnity` 覆盖的检查。
- `spec-check` 已实现（2026-10-17）：`patent-tools/src/atoms/spec-check.ts`；`mode=spec` 复用 `validateSpecification`，`mode=claims` 复用导出的 `checkClaimViolations`（特征覆盖 + `checkClaimSet`）；输出 `spec_check_report`/`spec_check_passed`/`spec_check_score`/`spec_check_violations`。单一性检查仅在 state 提供 `claim_units` 时执行——工作流目前没有权利要求结构化解析器，不新增猜测性解析。
- `problem-check` 只判定「实际解决的技术问题」是否被写成区别特征自身（指南第二部分第四章3.2.1.1 明令禁止），不做主观启示判定。
- `response-check` 输出：主输出 `response_check_report`，以及 `response_check_passed`、`response_check_violations`、`response_check_unevaluated`。包装 `patent-rule` 的 PR-OA-007/008/009：26.3 判准落位（结构分析）、通知书驳回理由逐条覆盖、答复引用未提条款。通知书优先读 `office_action`（`oa-parse` 产出的 JSON），缺失时解析 `notice`/`office_action_text`/`input`；缺通知书时两条双输入规则列入未评估，答复正文缺失或状态值类型错误降级。任一选中规则命中即 `response_check_passed=false`，规则自身的 action（007 block、008/009 warn）保留在违规项中。

### W 系列：按工作流接线

#### W-01 新颖性（`patent_novelty_v1`）

目标链：`parse → time-baseline(S-01) → search+keywords(收口) → prior-art-filter(S-02) → conflicting-application(S-03) → compare(既有原子) → numeric-range(S-05) → conclude(收口) → citation-check(S-08) → legal-gaps(R-03) → approval(既有原子)`

当前已实现链：`parse → time_baseline → generate_keywords → search(原子) → prior_art_filter → conflicting_application → compare → numeric_range → conclude → citation_check → legal_gaps → approval`。

注意：`conflicting-application` 只依赖解析结果与目标时间基准，不得依赖 `search`/`prior-art-filter` 的产出（见 C-02）。原子阶段直接读 state，因此不声明 `consumes`；依赖契约由 `inputSchema` 与行为测试锁定。

- 已接线（PR-1c）：`parse → time_baseline → search → compare → conclude`；`compare`/`conclude` 消费时间基准。日期经 `patent_workflow_run` 的 `filingDate`/`priorityDate` 输入映射到 `filing_date`/`priority_date`；两者都缺失时该阶段降级（不再默不作声地跳过），工具输入边界拒绝不可解析的日期。
- 已接线（PR-1v）：`generate_keywords → search(原子) → prior_art_filter`。原 `search` 是收口阶段，既不做真实检索也不产出带公开日的 `prior_art`，过滤只能稳定降级。改为复用披露工作流已验证的 `keywords` + `search` 原子：关键词取自交底书，检索命中写入 `prior_art`，`prior-art-filter` 按截止日与 A24 宽限期产出 `prior_art_filter_report`；`compare`/`conclude` 消费过滤报告，`citation_check` 在结论之后按过滤后的 `prior_art` 接地。`search` 原子同时把命中标题、公开日、URL 与摘要写进 `search_summary`，使只看阶段文本的收口阶段能够逐项对比；调用方提供的 `prior_art` 与检索命中合并去重，不被检索结果覆盖。
- 已接线（PR-1e）：`search → conflicting_application → compare`；`conclude` 的 `consumes` 加入 `conflicting_application`。C-02 的“只依赖解析与时间基准、不消费检索”由原子输入契约（`conflicting_applications` + `reference_date`/`filing_date`）与行为测试保证：原子阶段不声明 `consumes`（仓库约定：原子直接读 state，`consumes` 只属于收口阶段），测试同时断言 `prior_art`/`search` 不出现在 `inputSchema` 中，且传入 `prior_art` 不会产生候选。
- 候选来自 `patent_workflow_run` 的新输入 `conflictingApplications`（JSON 数组）映射到 `conflicting_applications`，不从检索结果推断：抵触申请在目标申请日以前尚未公布，现有技术检索按定义找不到它们。`sameInvention` 必须由调用方给出；缺失时条目进入 `conflicting_application_unknown`，不默认成立。
- 已接线（PR-1f）：`compare → numeric_range → conclude`，`conclude` 的 `consumes` 加入 `numeric_range`。数值范围核验读取权利要求侧文本与 `prior_art`（工具输入 `priorArt` 或原子检索产出）；无现成对比文本时给 `inconclusive` 而不是降级。

#### W-02 披露（`patent_disclosure_v1`）

链：`preprocess → eligibility(S-04) → extract_problem/features/effects/insight ×4(既有原子) → merge → groundedness → consistency(既有原子) → generate_keywords → time-baseline(S-01) → search → prior-art-filter(S-02) → novelty → citation-check(S-08) → report → review_gate → draft_claims → draft-specification → spec-check(S-06, mode=spec) → slop_clean(既有原子) → legal-gaps(R-03)`

- 已接线（PR-1a）：`draft_claims → spec_check → slop_clean`，`spec-check` 以 `source_text`（技术交底书）为支持文本、`claims_draft` 为权利要求文本，执行 A26.4 特征覆盖。
- 已接线（PR-1b）：`novelty → citation_check → report`，`citation-check` 读取 `search` 原子写出的 `prior_art` 与 `novelty_result`/`novelty_conclusion`，报告阶段消费校验产出。选披露作为首个消费方，是因为该 manifest 的 `search` 已是 `search` 原子（真实产出 `prior_art`），无需等待 W-01/W-03 的收口检索改造。
- 已接线（PR-1d）：`generate_keywords → time_baseline → search → prior_art_filter → novelty`。S-02 的首个消费方仍选披露，原因同上：它的 `search` 原子真实写出带 `publicationDate` 的 `prior_art`，过滤结果能直接进入新颖性判定。W-01 的检索仍是收口阶段，待 W-01 改成原子检索或显式写出 `prior_art` 后再接 `prior_art_filter`。
- 已接线（PR-1k）：`preprocess → eligibility → extract_problem`；`report` 的 `consumes` 加入 `eligibility`。披露工作流此时尚无权利要求，原子按 `source_text` 整体筛查，报告明确写出“技术交底书/技术方案”作用域；纯智力活动规则、诊疗方法、动植物品种与核变换方法阻断，含技术特征的智力活动主题只提示 A2.2 判断。
- 已接线（PR-1y）：`draft_claims → draft_specification → spec_check(mode=spec) → slop_clean`。`draft-specification` 用交底书、问题、效果、实施例与附图说明生成五部分说明书草案；`spec-check` 以草案为说明书文本、`claims_draft` 为权利要求文本，同时写出 `specification_check_report`/`specification_check_passed`，使 A26.3 与 A26.4 分别可评估。草案缺可选字段时保留【撰写指引】占位，检查报告会指出缺口而不是把占位当已公开。
- 保留既有 retry（consistency、slop 的 `whenOutputMatches`/`rewindTo`）。

#### W-03 创造性（`patent_inventiveness_v1`）

链：`parse → time-baseline(S-01) → search+keywords(收口) → prior-art-filter(S-02) → closest(收口) → diff(收口) → problem-check(S-07) → hint(收口) → secondary(收口) → conclude(收口) → citation-check(S-08) → legal-gaps(R-03) → approval`

当前已实现链：`parse → time_baseline → generate_keywords → search(原子) → prior_art_filter → closest → diff → problem_check → hint → secondary → conclude → citation_check → legal_gaps → approval`。

- 已接线（PR-1g）：`diff → problem_check → hint`；`hint` 与 `conclude` 的 `consumes` 均加入 `problem_check`。原子读取 `diff` 阶段产出（JSON 或平面文本）与区别特征，判定问题是否复述特征自身、是否含解决手段、是否复合因果；缺问题时放行并写明原因，避免上游格式差异导致整条工作流降级。
- 已接线（PR-1v）：`time_baseline → generate_keywords → search(原子) → prior_art_filter` 接在三步法之前；`closest` 消费时间基准、检索摘要与过滤报告，`conclude` 消费过滤报告，`citation_check` 在结论之后按过滤后的 `prior_art` 接地。与 W-01 采用同一组原子，保证新颖性与创造性的时间基准、宽限期与引用接地口径一致。
- `time_baseline` 不再由 `parse` 收口阶段自行声称：两者都缺失日期时该原子降级，`prior_art_filter` 随之无法确定截止日而降级；运行结果以 `completed=false` 明示，不再给出的是一份看似完整的检索报告。

#### W-04 可专利性（`patent_patentability_v1`）

链：`parse → time-baseline(S-01) → eligibility(S-04) → search+keywords(收口) → prior-art-filter(S-02) → claim-chart(patentability, 既有原子) → draft(收口) → draft-specification → spec-check(S-06, mode=spec) → legal-gaps(R-03) → approval`

当前已实现链：`parse → time_baseline → eligibility → generate_keywords → search(原子) → prior_art_filter → claim-chart → draft → draft_specification → spec_check → legal_gaps → approval`。

- 已接线（PR-1a）：`draft → spec_check → approval`，`spec-check` 以 `source_text` 为支持文本、`draft`（权利要求布局产出）为权利要求文本，执行 A26.4 特征覆盖。
- 已接线（PR-1k）：`parse → eligibility → claim-chart`；`draft` 的 `consumes` 加入 `eligibility`。可专利性工作流在布局权利要求前先筛查客体，避免把 A25 排除主题继续送入检索与布局。
- 已接线（PR-1x）：`time_baseline → eligibility → generate_keywords → search(原子) → prior_art_filter → claim-chart`，与 W-01/W-03 共用同一组原子。原计划的 `search+keywords(收口)` 由原子检索取代：关键词取自技术方案，检索命中写入 `prior_art`，过滤报告按 A22.5 截止日与 A24 宽限期保留/排除文献。`claim-chart` 在 `mode=patentability` 且调用方未显式传 `chart_targets` 时，从过滤后的 `prior_art` 派生对比文件目标（优先 `dLabel`，缺标号按 1 基序号补 `D<n>`；同一标号去重），排除的文献不进入映射；显式 `chartTargets` 仍然优先。`draft` 的 `consumes` 加入 `time_baseline` 与 `prior_art_filter`。
- 已接线（PR-1y）：`draft → draft_specification → spec_check(mode=spec) → legal_gaps → approval`。`draft-specification` 以技术方案为说明书正文与实施例来源；`spec-check` 以草案为说明书文本、`draft`（权利要求布局）为权利要求文本，同时输出 `specification_check_report`/`specification_check_passed`。可专利性清单新增 A26.3 检查项，与既有 A26.4/A31.1 分开汇总。

#### W-05 OA 答复（`patent_oa_response_v1`）

链：`parse(oa-parse, 既有原子) → claim-chart(oa-response, 既有原子) → response-plan(既有原子) → draft(收口) → response-check(S-10) → amendment-basis(S-11) → legal-gaps(R-03) → approval`

当前已实现链：`parse → claim-chart → response-plan → draft → response_check → amendment_basis → approval`。

- 已接线（PR-1h）：`draft → response_check → approval`。原子直接读 `draft`（答复正文）与 `office_action`（解析结果），执行 PR-OA-007/008/009；漏答驳回理由与未提条款引用分别由 008/009 点名，26.3 判准落位由 007 阻断。
- 已接线（PR-1i）：`response_check → amendment_basis → approval`。原子从答复正文提取“修改后权利要求”段，与同号原权项做字符级差异，新增片段未在原说明书/原权利要求书中记载时报告 A33 疑似超范围；未检测到修改后权利要求时视为未修改并放行。调用方应通过 `claims` 传入原权利要求书；只传审查意见通知书时原子降级，不把通知书当修改依据。
- 已接线（PR-1m）：`amendment_basis → legal_gaps → approval`。`legal_gaps` 以 `profile: 'oa-response'` 汇总答复规范检查（A26.3/A26.4/A22.2/A22.3）与修改依据检查（A33）的通过、未通过与未评估状态；未通过项按 `block` 记录，未评估项只提示并由人工复核。
- `response-check` 反例：漏答某一审查意见项（已覆盖）；引用 D10 被误判为 D1 与“未引用出处”不在 PR-OA-007/008/009 的规则范围内——前者属于 G-9 `citation-check` 的检索接地，后者需要新增“事实—出处”规则，均留待 W-05 接入检索/引用源时处理。
- `amendment-basis` 反例：新增未记载技术特征。

#### W-06 无效（`patent_invalidation_v1`）

链：`parse → request-check(收口) → grounds(既有原子) → claim-chart(invalidity, 既有原子) → ground-router(收口) → [novelty/inventiveness 分支] → evidence-check(S-09) → citation-check(S-08) → legal-gaps(R-03) → approval`

当前已实现链：`parse → grounds → claim-chart → novelty → inventiveness → evidence-check → citation-check → approval`。

- `request-check`：无效宣告请求书形式要件（请求人资格、理由、证据清单）。
- `evidence-check`：证据形式、时间与关联性。
- 已接线（PR-1j）：`inventiveness → evidence-check → approval`。原子从 `evidence` 读取证据清单，按 `evidenceDeadline` 与申请日/优先权日核对形式、举证期限、公开日与争点关联性；`patent_workflow_run` 新增 `evidence`/`evidenceDeadline` 输入。未提供证据清单时报告“未执行”并放行，避免把缺输入误判为证据合格；证据条目类型错误或日期不可解析时降级。
- 已接线（PR-1l）：`evidence-check → citation-check → approval`。`citation-check` 以 `ref_text_keys: ['novelty', 'inventiveness']` 读取两个收口阶段的结论（阶段输出分别落在 `state.novelty`/`state.inventiveness`），并以调用方传入的 `priorArt`（`prior_art`）为接地依据；检索结果缺失时按域契约放行并写明原因。

#### W-07 复审（`patent_reexamination_v1`）

链：`parse → decision-scope(收口) → grounds(既有原子) → claim-chart(reexamination, 既有原子) → ground-router(收口) → [novelty/inventiveness 分支] → evidence-check(S-09) → citation-check(S-08) → legal-gaps(R-03) → approval`

当前已实现链：`parse → grounds → claim-chart → novelty → inventiveness → evidence-check → citation-check → approval`（与无效共用 `buildContestedManifest` 阶段骨架，差异只在理由表与图表模式）。

- `decision-scope`：复审审查范围（请求范围、修改限制）。
- 已接线（PR-1j）：同 W-06；`evidence-check` 在复审程序中同样核对证据形式、举证期限与关联性。
- 已接线（PR-1l）：同 W-06；`citation-check` 接在 `evidence-check` 之后，结论引用按复审请求与驳回决定中的对比文件标号接地。

#### W-08 侵权（`patent_infringement_v1`）

链：`parse → claim-construction(收口) → claim-chart(infringement, 既有原子) → equivalence-check(收口) → coverage(既有原子) → prior-art-defense(收口) → report(收口) → legal-gaps(R-03) → approval`

- `equivalence-check`：全面覆盖 + 等同特征；`prior-art-defense`：现有技术抗辩。

### C 系列：契约与注册

- **C-01 原子契约注册**：S-01..S-11 注册到 `globalAtomRegistry`，声明契约与 handler；每个 PR 至少带一个消费方。
- **C-02 依赖契约测试**：`conflicting-application` 只 consumes `parse`，禁止 consumes `search`/`prior-art-filter`；`citation-check` consumes `search` + `conclude`。
- **C-03 SessionEventMap 新成员**：定义 `patent/evidence-ledger`、`patent/legal-gaps` 事件，标记 required-on-read 或 `ignorable`。两者均已进入 `SessionEventMap`；`evidence-ledger` 在 service 与工具路径写出，`legal-gaps` 与 `workflow-run` 仍只在 service 路径写出。
- **C-04 加载期版本校验**：`guidelineRevision` 不匹配在加载期失败（misconfiguration fails loud）。
- **C-05 recap 模式**：`patent_workflow` 工具在新阶段下按 degraded 输出，`patent_workflow_run` 的 manifest/graph 两路径行为一致。
- **C-06 预算 Config**：每个 manifest 的阶段数上限与 LLM 阶段数上限为 `Config` 字段（可经 cordis.yml 覆盖），非常量。

### R 系列：证据与可追溯性

- **R-01 证据台账接线**：`Ledger`/`Receipt` 写入 workflow-run 输出，并落 `patent/evidence-ledger` 事件。已完成（PR-1p）：收据按证据来源生成，`citationId` 复用 `D<n>` 标号；见 §26。
- **R-02 引用-证据闭环**：`citation-check` 的每个 D 标号必须能在 ledger 中找到对应 `Receipt`。已完成（PR-1q）：D 标号按台账分配给 prior-art 的同一 `citationId` 精确接地；见 §27。
- **R-03 legal-gaps 聚合器**：收集各阶段的法条缺口，deterministic 规则优先，LLM 兜底；输出 `patent/legal-gaps` 事件与可复核依据。首版（PR-1m）只做确定性聚合，`patent/legal-gaps` 事件在 service 路径写出；LLM 兜底复核不在原子内执行，留给后续切片。
- **R-04 回放一致性测试**：写入 → 回放 → 断言 ledger/gaps 一致。已完成（PR-1r）：运行结果经 `JsonFileWorkflowRunStore` 落盘，session 事件经 JSON 往返后用 `Session.create` 重放，断言 `evidenceLedger`、digest 与 `legal-gaps` 报告一致；见 §28。
- **R-05 双 SDK 投影更新**：TypeScript 与 Python SDK 的 expected 输出随 C-03 同步更新。已完成（PR-1t）：核对后两个 SDK 的 expected 都不含 `patent/*` 事件，SDK 按 `SessionEvent` 包络与通用 JSON 透传；无需修改 expected。验证覆盖 TS SDK 快照、Python SDK 单测与全量 `pnpm run test`；见 §30。

## 5. 检查清单

### A 代码与类型

| ID | 检查项 | 验收方式 |
|---|---|---|
| A-1 | 新 src 文件逐文件 100% 覆盖率 | `pnpm run test:coverage` |
| A-2 | 无新增 `as unknown`，`strict` 不回退 | `pnpm run typecheck` + `lint` |
| A-3 | 新导出有 JSDoc（`verify-export-jsdoc`） | `pnpm run lint` |
| A-4 | 新事件成员 required-on-read 或 `ignorable` | typecheck |
| A-5 | 闭包并集 `assertNever`；可扩展并集有文档化 default | code review |
| A-6 | 引用指南的原子/manifest 声明 `guidelineRevision` | C-04 负例 |
| A-7 | 预算字段为 `Config`，非常量 | C-06 |

### B 共享原子

| ID | 检查项 | 验收方式 |
|---|---|---|
| B-1 | S-01..S-11 全部注册到 `globalAtomRegistry` | 单元测试 |
| B-2 | 每个 S 项 PR 描述有「包装既有/新能力」映射 | review |
| B-3 | 未知原子契约失败、缺失 handler 回退 executor 语义不变 | 单元测试 |
| B-4 | 原子输出键与下游 `consumes` 一致 | 工作流测试 |
| B-5 | 确定性原子无 LLM 依赖，输入输出类型化 | review |
| B-6 | 每个原子有 1 正例 + 1 反例，反例断言拒绝路径 | 单元测试 |

### C 工作流行为

| ID | 检查项 | 验收方式 |
|---|---|---|
| C-1 | 8 个 manifest 阶段链按 §4 更新 | `pnpm run test:snapshot -t patent` |
| C-2 | `conflicting-application` 只 consumes `parse` | 单元测试 |
| C-3 | retry/rewind 目标在新增阶段后仍存在 | 工作流测试 |
| C-4 | approval-gate 与 approve/resume 路径在新链可用 | 服务测试 |
| C-5 | recap 模式新阶段降级为 degraded，不崩 | 工具测试 |
| C-6 | 后台任务 + 断点恢复在 manifest 路径可用 | 服务测试 |
| C-7 | 阶段数/LLM 阶段数不超预算 | 门禁测试 |
| C-8 | 每个新阶段有反例走拒绝路径 | 单元测试 |

### D 集成与持久化

| ID | 检查项 | 验收方式 |
|---|---|---|
| D-1 | `patent/evidence-ledger`、`patent/legal-gaps` 落入 `SessionEventMap` | typecheck |
| D-2 | 证据台账写入 session log，回放可重建 | R-04 |
| D-3 | TS 与 Python SDK expected 输出同步更新 | `pnpm run test` |
| D-4 | workflow-run JSON 与 .mmd 持久化含新阶段输出 | 服务测试 |
| D-5 | 引用 D 标号能在 ledger 找到 `Receipt` | 单元测试 |
| D-6 | 旧快照/旧指南资产不覆盖、不删除 | git diff |
| D-7 | `guidelineRevision` 不匹配在加载期失败 | C-04 |

### E 文档与快照

| ID | 检查项 | 验收方式 |
|---|---|---|
| E-1 | 基线快照先于首个行为变更提交 | git log |
| E-2 | 每个 W 项附键控快照 diff，只含预期变化 | `test:snapshot -t patent` |
| E-3 | 包 README 更新工作流列表与指南版本 | `doc-sync`/review |
| E-4 | 新事件若改变 Session 格式，写 upgrade guide | dsh-create-upgrade-guide |
| E-5 | 2026/2023 指南资产并存，来源与 `verifiedOn` 记录 | review |

### F 发布门禁

| ID | 检查项 | 验收方式 |
|---|---|---|
| F-1 | `pnpm run build` 通过（artifacts + check） | build |
| F-2 | `pnpm run test:coverage` 通过 | CI |
| F-3 | `pnpm run test:snapshot -t patent` 通过 | CI |
| F-4 | `pnpm run doc-sync` 通过 | CI |
| F-5 | 每个 manifest 阶段数/LLM 阶段数不超预算 | C-06 门禁 |
| F-6 | 指南版本加载期校验负例通过 | C-04 |
| F-7 | 双 SDK 快照通过 | CI |
| F-8 | `duplication` 无新增重复 | CI |

### G 法律验收用例

| ID | 阶段 | 必须接受（正例） | 必须拒绝（反例） |
|---|---|---|---|
| G-1 | `time-baseline` | 申请日前公开 → 现有技术 | 申请日后公开且非抵触申请 → 不是现有技术 |
| G-2 | `prior-art-filter` | A24 四种情形 + 6 个月内 → 不破坏新颖性 | 宽限期外的再次公开 → 破坏新颖性 |
| G-3 | `conflicting-application` | 早于申请日申请、申请日后公开、同样发明 → 抵触申请 | 申请日后申请 → 既非现有技术也非抵触申请 |
| G-4 | `eligibility` | 技术方案落入 A2 客体 | 纯智力活动规则/疾病治疗方法 → A25 排除 |
| G-5 | `numeric-range` | 落在对比文件范围内且无共同端点 → 不破坏新颖性 | 与对比文件范围有共同端点 → 破坏新颖性 |
| G-6 | `spec-check(spec)` | 五段齐全 + 效果量化 | 缺少必要章节 / 关键特征无 A26.3 支撑 |
| G-7 | `spec-check(claims)` | 权利要求得到说明书支持 | 权利要求特征未在说明书出现 → A26.4 拒绝 |
| G-8 | `problem-check` | 技术问题由区别特征的技术效果重定 | 技术问题被写成区别特征自身 |
| G-9 | `citation-check` | 每个 D 标号对应检索命中 | 引用 D10 被误判为 D1 |
| G-10 | `response-check` | 逐项理由 + 引用出处 + 覆盖全部审查意见 | 漏答某一审查意见项 |
| G-11 | `amendment-basis` | 修改可由原申请文件直接、毫无疑义地确定 | 新增未记载技术特征 → A33 拒绝 |
| G-12 | `evidence-check` | 证据在期限内提交且与争点关联 | 证据超期且无正当理由 → 拒绝 |
| G-13 | `legal-gaps` | 汇总未覆盖法条并给出可复核依据 | 空转不产出或输出无法条依据 |
| G-14 | 数值范围对拍 | `20℃ 至 90℃` 等分叉样本两侧一致 | 两侧结论分歧 |

## 6. 测试矩阵

| 层 | 覆盖对象 | 命令 |
|---|---|---|
| 单元 | 各 S 原子正反例 | `pnpm run test packages/patent` |
| 工作流 | 8 manifest 阶段链/retry/approval | 同上 |
| 键控快照 | 8 manifest + 4 graph | `pnpm run test:snapshot -t patent` |
| 双 SDK | `SessionEventMap` 投影 | `pnpm run test` |
| 构建 | lib/types 产物 | `pnpm run build` |

## 7. PR 切片与顺序

1. **PR-0 指南版本与基线**（G-01..G-04）：先录基线，再并 2026 资产，再加载期校验；G-04 数值范围收敛可单独 PR（附对拍）。
2. **PR-1..n 垂直切片**：每个 S 原子 + 第一个消费它的 W 阶段 + 正反例 + 快照同一 PR。顺序：先做「包装既有」项（S-05 依赖 G-04、S-06、S-08、S-10），再做新能力（S-03、S-07、S-11）。
3. **最后横切**：R-01..R-05（证据台账 + legal-gaps）在至少 2 个 W 项就绪后落地，避免一次性引入过多新基础设施。

## 8. 风险表

| 风险 | 影响 | 缓解 |
|---|---|---|
| 2026 版指南文本获取不全 | 3 个过时节修不完整 | 只修已确认 3 处，其余显式标记旧版，不声称已更新 |
| 阶段数膨胀导致成本超预算 | 延迟/token 上升 | C-06 预算门禁，超出即失败 |
| 数值范围收敛改变既有判定 | 结论分叉 | G-04 附对拍测试 + 快照 |
| 抵触申请输入来源不明确 | 漏判 | C-02 契约：只 consumes `parse`，输入为候选申请集合 |
| 新事件破坏 Session 格式兼容 | 发布面破坏 | 版本化并存，写 upgrade guide |
| 原子注册无消费方 | 死代码 | 垂直切片，每 PR 至少一个消费方 |

## 9. Definition of Done

- 四类缺口各有一条可证明的验收路径（正例 + 反例）。
- 8 个 manifest 与 4 个 graph 的键控快照 diff 只含预期变化，基线先于变更提交。
- `guidelineRevision` 加载期校验负例通过；2023 基础文本与 2026 已确认 3 节的版本覆盖并存，`verifyCitation` 可按版本选择（G-02 的完整 2026 全文仍待对照表逐条补齐）。
- 证据台账与 legal-gaps 可写可回放，`SessionEventMap` 与双 SDK 投影同步。
- `pnpm run build`、`pnpm run test:coverage`、`pnpm run test:snapshot -t patent`、`pnpm run doc-sync` 全绿。

## 10. 执行记录（2026-10-17，PR-0）

### 已改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-law/src/types.ts` | 新增 `StaleSection`；`LawBaseline` 新增 `supersededBy`、`staleSections` |
| `packages/patent/patent-law/src/baseline.ts` | 解析并校验 `supersededBy`/`staleSections`；非指南法条拒绝 `staleSections` |
| `packages/patent/patent-law/src/verify.ts` | 新增 `staleSectionFor`；命中过时节的引用判 `unverified` |
| `packages/patent/patent-law/src/index.ts` | 导出 `staleSectionFor`、`StaleSection` |
| `packages/patent/patent-law/assets/law/cn-examination-guidelines.yaml` | 新增 `supersededBy` 与 3 条 `staleSections` |
| `packages/patent/patent-law/tests/baseline.spec.ts` | 元数据解析、非法路径、法条拒绝的测试 |
| `packages/patent/patent-law/tests/verify.spec.ts` | 过时节/父节/不受影响节三种判定测试 |
| `packages/patent/patent-core/src/workflow/types.ts` | `WorkflowManifest.guidelineRevision`、`WorkflowRunOptions.guidelineRevision` |
| `packages/patent/patent-core/src/workflow/manifest.ts` | `validateGuidelineRevision` 校验 |
| `packages/patent/patent-core/tests/misc-coverage.spec.ts` | 空串/缺失/不一致负例 |
| `packages/patent/patent-workflow/src/workflow.ts` | 透传期望版本到 manifest 校验 |
| `packages/patent/patent-workflow/src/workflow/manifests.ts` | `SHIPPED_GUIDELINE_REVISION`；8 个内置 manifest 声明版本 |
| `packages/patent/patent-tools/src/index.ts` | `Config.guidelineRevision` 默认值；插件加载校验全部内置 manifest |
| `packages/patent/patent-tools/tests/registration.spec.ts` | 版本不一致时插件加载失败 |

### 验证结果

- `pnpm run typecheck`：5/5 gates PASS。
- `pnpm run lint`：0 errors（仅 1 个与本改动无关的既有 warning）。
- `pnpm run build`：9/9 gates PASS（含 build:check）。
- `pnpm run verify-config-catalog`：通过；已再生 `docs/config-catalog.md`、`docs/config-catalog.zh.md`。
- `pnpm run test:snapshot -t patent`：11 通过。
- 聚焦单测：469 通过，2 失败（见下）。

### 已知的既有失败（与 PR-0 无关）

`patent-law` 的两个资产覆盖测试失败，原因是工作树中**未提交**的 `writing-patterns` 资产新增了索引里不存在的引用：

- `01-utility-model-claim.yaml`：`审查指南第一部分第二章`
- `09-ipc-strategy.yaml`：`审查指南第一部分第四章`
- `02-dependent-claim-layering.yaml`：`细则第25条`

`git show HEAD:` 对这三个文件均无上述引用，确认由未提交改动引入；本 PR-0 未触碰这些文件，故未代为修改。

### 未完成项

- G-02 的 2026 版全文资产：缺 2026 年全文，且索引当前不支持同一法条多版本并存；完成条件见 §4 G-02。
- S/W/C/R 系列：PR-0 时尚未开始；S-06 已在 §11 完成，其余待做。

## 11. 执行记录（2026-10-17，PR-1a：S-06 `spec-check`）

### 已改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-tools/src/atoms/spec-check.ts` | 新增 `spec-check` 原子契约与 `SpecCheckHandler`；`spec`/`claims` 双模式、文本/权项键可配置、缺失输入与未知模式返回 degraded |
| `packages/patent/patent-tools/src/tool/validate-specification.ts` | 导出 `checkClaimViolations`；`renderSpecification` 支持自定义报告标题 |
| `packages/patent/patent-tools/src/index.ts` | 插件加载时注册并导出 `specCheckAtom`/`SpecCheckHandler`/`SpecCheckMode` |
| `packages/patent/patent-tools/src/tool/patent-flexible-plan.ts` | `flexible_plan` 的原子说明补充 `spec-check` 参数 |
| `packages/patent/patent-tools/tests/spec-check.spec.ts` | 9 个用例：spec 正反例、claims 覆盖正反例、A31.1 单一性反例、键覆盖、三类 degraded |
| `packages/patent/patent-tools/tests/registration.spec.ts` | 注册原子集合加入 `spec-check` |
| `packages/patent/patent-tools/tests/patent-workflow-run.spec.ts` | 测试路径注册真实 `spec-check` 原子与 handler |
| `packages/patent/patent-workflow/src/workflow/manifests.ts` | W-02 在 `draft_claims` 后接 `spec_check`（claims 模式）；W-04 在 `draft` 后接 `spec_check`（claims 模式） |
| `packages/patent/patent-workflow/tests/workflow-retry.spec.ts` | 披露 manifest 阶段数 15→16；原子集合、阶段顺序与参数断言；跨包原子 stub |
| `docs/tool-catalog.md`、`docs/tool-catalog.zh.md` | 再生/同步 `flexible_plan` 的原子参数说明（新增 `spec-check`） |
| `docs/TECH_DEBT.md` | `structure.large-files` 76→77（`patent-tools/src/index.ts` 超过 800 行） |
| `snapshots/session/patent-oa-response/tool-schemas.expected.json` | 同步 `flexible_plan` 原子说明（9 个复用该 sidecar 的快照用例） |

### 验证结果

- `pnpm exec tsc -b packages/patent/patent-workflow/tsconfig.json packages/patent/patent-tools/tsconfig.json`：PASS。
- `pnpm run typecheck`：5/5 gates PASS。
- `pnpm exec tsx scripts/run-oxlint.ts <改动文件>`：0 errors、0 warnings。
- `pnpm exec vitest run packages/patent`：4503 通过、2 跳过、2 失败——失败均为 §10 已记录的 `writing-patterns` 未提交引用，与本切片无关。
- `pnpm run test:snapshot -t patent`：11 通过（已同步 `patent-oa-response` 的 tool-schemas sidecar）。
- `pnpm run verify-tool-catalog`、`pnpm run verify-tech-debt-counters`、`pnpm run verify-repository-references`：通过。
- `pnpm run test:docs`：28 通过、1 失败——失败为工作树中未跟踪的 `litho.docs/patent/README.md` 缺少双语配对，与本切片无关。

### 设计取舍

- `mode=spec` 未接入现有 manifest：W-02 的 `source_text` 是技术交底书，W-04 的 `draft` 是权利要求布局，二者都不是专利说明书全文；强行套用五段章节/摘要规则会稳定误报。待新增说明书草稿阶段后再接。
- 单一性（A31.1）只在 state 提供 `claim_units` 时检查；没有新增权利要求文本解析器，避免用猜测性解析产生法律误判。
- 两个 spec-check 阶段不连续放在同一 manifest：连续同 atom、无 `consumes`/`retry` 的阶段会进入并行窗口并争写同一组输出键；当前每个 manifest 只接一个 claims 模式阶段。
- `spec_check_passed=false` 目前只形成报告，不自动阻断或回退；阻断/汇总留给 R-03 `legal-gaps`，避免在证据台账尚未接线时引入无法解释的失败。

### 验收用例对照

- G-6 `spec-check(spec)`：`spec-check.spec.ts` 的“完整说明书通过”与“缺少必要章节报错”一对正反例。
- G-7 `spec-check(claims)`：`spec-check.spec.ts` 的“权项特征均在说明书出现”与“弹簧/电机未记载 → A26.4 拒绝”一对正反例；A31.1 另有低相似度独立权利要求对的反例。

## 12. 执行记录（2026-10-17，PR-1b：S-08 `citation-check`）

### 已改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-core/src/atoms/handlers/builtin/citation.ts` | 新增 `citation-check` 原子契约与 `CitationCheckHandler`：默认读取新颖性/创造性结论键，参数可覆盖 `ref_text_keys` 与 `prior_art_key`；缺引用文本或参数非法返回 degraded |
| `packages/patent/patent-core/src/graph/domains/citation-check.ts` | `GraphBuilder`/`GraphNode` 改为直接从 `engine.ts`/`types.ts` 导入，切断「原子 → 域 → graph barrel → atoms」的循环依赖 |
| `packages/patent/patent-core/src/atoms/handlers/builtin/index.ts`、`src/atoms/index.ts` | 导出并注册新原子与 handler |
| `packages/patent/patent-core/tests/citation-check-atom.spec.ts` | 9 个用例：接地正例、D10/D1 反例、专利号接地、键覆盖、空检索放行、缺引用文本降级、两类参数非法降级 |
| `packages/patent/patent-core/tests/atoms.spec.ts` | 内置原子清单 16→17 |
| `packages/patent/patent-workflow/src/workflow/manifests.ts` | W-02 在 `novelty` 与 `report` 之间接 `citation_check`；`report.consumes` 加入该校验 |
| `packages/patent/patent-workflow/tests/workflow-retry.spec.ts` | 披露阶段数 16→17；原子集合、阶段顺序、参数与 `consumes` 断言 |
| `packages/patent/patent-workflow/tests/manifest-atoms.spec.ts` | 披露引用校验位置与报告消费断言 |
| `packages/patent/patent-tools/tests/registration.spec.ts` | 完整组合的原子集合加入 `citation-check`；内置原子计数 16→17 |
| `packages/patent/patent-tools/src/tool/patent-flexible-plan.ts` | 原子参数说明补充 `citation-check (params.ref_text_keys, prior_art_key)` |
| `docs/tool-catalog.md`、`docs/tool-catalog.zh.md` | 再生/同步 `flexible_plan` 的原子参数说明 |
| `snapshots/session/patent-oa-response/tool-schemas.expected.json` | 同步共享 sidecar 的原子说明（9 个复用该 sidecar 的快照用例） |

### 验证结果

- `pnpm run typecheck`：5/5 gates PASS。
- `pnpm run build`：9/9 gates PASS（含 build:check）。
- `pnpm exec tsx scripts/run-oxlint.ts <改动文件>`：0 errors、0 warnings。
- `pnpm exec vitest run packages/patent`：4521 通过、2 跳过、0 失败。
- `pnpm run test:snapshot -t patent`：10 通过、1 失败——失败为 `patent-writing-patterns` 的 system prompt 与工作树中未提交的 writing-patterns 资产不一致（预期文件与资产均在本次切片开始前已修改），与 S-08 无关；其余 10 个 patent 快照（含 `patent-oa-response` 的 tool-schemas）通过。
- `pnpm run verify-tool-catalog`、`pnpm run verify-tech-debt-counters`、`pnpm run verify-repository-references`：通过。

### 设计取舍

- 原子放在 `patent-core` 而非 `patent-tools`：判定逻辑与依赖都在 patent-core 内，`registerBuiltinAtoms()` 即可注册，`patent-workflow` 单独加载时也能解析 manifest 的 atom 契约（S-06 放 patent-tools 是因为依赖其校验器）。
- 默认引用文本键不包含 `text`：原始交底书可能自带 D 标号或专利号（例如背景技术里提到的文献），把它当结论引用会稳定误报「未接地」。默认只读结论/评估字段，调用方可用 `ref_text_keys` 显式扩展。
- 缺引用文本时降级，而不是放行：上游结论未产出属于阶段失败，若放行会把失败报告成「引用全部接地」。检索结果为空或无可提取标识时仍按域契约放行并写明原因，避免对检索降级双重惩罚。
- 首个消费方选披露（W-02）而不是 W-01/W-03：披露的 `search` 已经是 `search` 原子，真实写出 `prior_art`；新颖性/创造性的检索仍是收口阶段，需等 S-01/S-02 改造后才能形成有意义的接地闭环。
- 未新增 `legal-gaps` 阻断：`citation_check_grounded=false` 目前只进入报告与阶段输出，聚合与阻断留给 R-03。

### 验收用例对照

- G-9 `citation-check`：「D 标号在检索结果中接地时通过」与「D10 不会被 D1 前缀误接受」一对正反例；另有专利号接地与空检索放行用例。

## 13. 执行记录（2026-10-17，PR-1c：S-01 `time-baseline`）

### 已改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-core/src/atoms/handlers/builtin/time-baseline.ts` | 新增 `time-baseline` 原子契约与 `TimeBaselineHandler`：包装 `priorArtReference`，取申请日/优先权日较早者；日期缺失、任一日期不可解析或键参数非法时降级 |
| `packages/patent/patent-core/src/atoms/handlers/builtin/index.ts`、`src/atoms/index.ts` | 导出并注册新原子与 handler |
| `packages/patent/patent-core/tests/time-baseline-atom.spec.ts` | 9 个用例：仅申请日、优先权更早/更晚、G-1 两种公开日走向、缺日期、两个不可解析日期、键覆盖、键参数非法 |
| `packages/patent/patent-core/tests/atoms.spec.ts` | 内置原子清单 17→18 |
| `packages/patent/patent-workflow/src/workflow/manifests.ts` | W-01 在 `parse` 后接 `time_baseline`；`search`/`compare`/`conclude` 消费其产出 |
| `packages/patent/patent-workflow/tests/manifest-atoms.spec.ts` | 新颖性时间基准位置与 `consumes` 断言 |
| `packages/patent/patent-workflow/tests/workflow-dag.spec.ts` | Mermaid 链改为 `parse → time_baseline → search` |
| `packages/patent/patent-workflow/tests/service.spec.ts`、`workflow-store.spec.ts` | 运行上下文中补 `filing_date`，使既有完成性断言仍成立 |
| `packages/patent/patent-tools/src/tool/patent-workflow-run.ts` | 新增 `filingDate`/`priorityDate` 输入与输入边界日期校验；映射到工作流上下文 |
| `packages/patent/patent-tools/src/tool/internal/workflow-helpers.ts` | `buildWorkflowRunContext` 透传 `filing_date`/`priority_date` |
| `packages/patent/patent-tools/src/tool/patent-flexible-plan.ts` | 原子参数说明补充 `time-baseline` |
| `packages/patent/patent-tools/tests/registration.spec.ts` | 完整组合的原子集合加入 `time-baseline`；内置原子计数 17→18 |
| `packages/patent/patent-tools/tests/patent-workflow-run.spec.ts` | 时间基准落地用例 + 输入边界非法日期拒绝 |
| `packages/patent/patent-tools/tests/patent-workflow.spec.ts` | recap 输出清单加入 `time_baseline`，阶段数 5→6 |
| `docs/tool-catalog.md`、`docs/tool-catalog.zh.md` | 再生/同步 `patent_workflow_run` 新参数与原子说明 |
| `snapshots/session/patent-oa-response/tool-schemas.expected.json` | `DSH_SNAPSHOT=refresh` 重写共享 sidecar（新参数 + 原子说明） |
| `docs/upgrade-guide/v0.2.1-rc.1/patent-workflow-legal-stages/` | 新增双语升级指南：新颖性需要显式日期、三个 manifest 新增阶段、recap 输出清单变化 |

### 验证结果

- `pnpm run typecheck`：5/5 gates PASS。
- `pnpm run build`：9/9 gates PASS（含 build:check）。
- `pnpm exec tsx scripts/run-oxlint.ts <改动文件>`：0 errors、0 warnings。
- `pnpm exec vitest run packages/patent`：4533 通过、2 跳过、0 失败。
- `pnpm run test:snapshot -t patent`：11 通过。
- `pnpm run verify-tool-catalog`、`verify-tech-debt-counters`、`verify-repository-references`、`verify-export-jsdoc`、`verify-upgrade-guides`：通过。
- `pnpm run test:docs`：28 通过、1 失败——失败仍为工作树中未跟踪的 `litho.docs/patent/README.md` 缺少双语配对，与本切片无关。

### 设计取舍

- 日期不从交底书正文推断：申请日/优先权日必须由调用方显式提供；`extractDateFromText` 只用于证据文本，不用于确定法律基准，避免把文中的任意日期误当成申请日。
- 任一已提供日期不可解析即降级，不静默改用另一个日期；两个日期都缺失也降级。这样既不会把配置错误伪装成“合法基准”，也不会让新颖性结论在缺少时间基准时看起来完成。
- 工具输入边界用 `parseDateFlexible` 预校验，非法日期直接 `invalid_tool_input`，比运行到阶段再降级更早暴露调用错误。
- 未输出 `prior_art_date`：基准阶段不应猜测检索结果的日期字段；单篇公开日的提取与“是否早于截止日”的过滤归 S-02 `prior-art-filter`，G-1 的两种走向已通过 `isBeforeReferenceDate` 在原子测试中覆盖。
- 首个消费方选 W-01 新颖性（而不是创造性/可专利性）：A22.2 直接以现有技术截止日为判断前提，且该 manifest 已有 `search` 阶段可复用。

### 验收用例对照

- G-1 `time-baseline`：「申请日前公开 → 现有技术」与「申请日后公开 → 不是现有技术」通过 `isBeforeReferenceDate` 对原子输出的 `reference_date` 做正反判断；另有优先权早于/晚于申请日的基准选择用例。

## 14. 执行记录（2026-10-17，PR-1d：S-02 `prior-art-filter`）

### 已改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-core/src/atoms/handlers/builtin/prior-art-filter.ts` | 新增 `prior-art-filter` 原子与 handler：按截止日过滤；A24 四种首次公开在申请日前六个月内排除；未知公开日保留并列入 `prior_art_undated`；过滤结果保留原始 `dLabel` |
| `packages/patent/patent-core/src/atoms/handlers/builtin/index.ts`、`src/atoms/index.ts` | 导出并注册新原子、handler、A24 常量与字段名常量（内置原子 18→19） |
| `packages/patent/patent-core/src/types.ts` | `StageSearchHit` 新增 `publicationDate`（检索命中携带公开日） |
| `packages/patent/patent-core/src/graph/domains/citation-check.ts` | 引用校验优先使用过滤保留的 `dLabel`，避免数组缩短后把 D2 误认成 D1 |
| `packages/patent/patent-core/tests/prior-art-filter-atom.spec.ts` | 22 个用例：截止日正反例、A24 四情形、宽限期外反例、边界日、缺申请日、未知/坏日期、Wayback、月级日期、`dLabel`、状态键/字段覆盖与三类降级 |
| `packages/patent/patent-core/tests/citation-check-atom.spec.ts` | 新增 `dLabel` 优先于数组位次的正反用例 |
| `packages/patent/patent-core/tests/atoms.spec.ts` | 内置原子清单 18→19 |
| `packages/patent/patent-data/src/search-provider.ts` | 诺源命中映射新增 `publicationDate` |
| `packages/patent/patent-data/tests/search-provider.spec.ts`、`service.spec.ts` | 同步检索命中新增公开日 |
| `packages/patent/patent-workflow/src/workflow/manifests.ts` | W-02 在 `search` 前接 `time_baseline`、在 `search` 后接 `prior_art_filter`，新颖性读取过滤后的 `prior_art` |
| `packages/patent/patent-workflow/tests/manifest-atoms.spec.ts` | 披露时间基准与公开日过滤的位置断言 |
| `packages/patent/patent-workflow/tests/workflow-retry.spec.ts` | 披露阶段数 17→19；原子集合、顺序与参数断言 |
| `packages/patent/patent-tools/src/tool/patent-workflow-run.ts` | `priorArt` 输入说明补充 `publicationDate`/`a24Exception` 契约 |
| `packages/patent/patent-tools/tests/patent-workflow-run.spec.ts` | 披露端到端用例：检索命中过滤后再进入新颖性 |
| `packages/patent/patent-tools/tests/registration.spec.ts` | 完整组合的原子集合加入 `prior-art-filter`；内置原子计数 18→19 |
| `packages/patent/patent-tools/src/tool/patent-flexible-plan.ts` | 原子参数说明补充 `prior-art-filter` |
| `docs/tool-catalog.md`、`docs/tool-catalog.zh.md` | 再生/同步原子说明与 `priorArt` 字段契约 |
| `snapshots/session/patent-oa-response/tool-schemas.expected.json` | `DSH_SNAPSHOT=refresh` 重写共享 sidecar |
| `packages/extensions/tool-cordis/src/api-catalog.ts` | 再生 Cordis API 目录（`StageSearchHit.publicationDate`；同时纳入工作树已有的 `guidelineRevision` 类型变更） |
| `docs/upgrade-guide/v0.2.1-rc.1/patent-workflow-legal-stages/` | 双语升级指南补充披露阶段、`publicationDate`/`a24Exception` 与迁移步骤 |

### 验证结果

- `pnpm run typecheck`：5/5 gates PASS。
- `pnpm run build`：9/9 gates PASS（含 build:check）。
- `pnpm exec tsx scripts/run-oxlint.ts <改动文件>`：0 errors、0 warnings。
- `pnpm exec vitest run packages/patent`：4553 通过、2 跳过、0 失败。
- `pnpm run test:snapshot -t patent`：11 通过。
- `pnpm run verify-tool-catalog`、`verify-upgrade-guides`、`verify-export-jsdoc`、`verify-repository-references`、`verify-cordis-catalog`：通过。
- `pnpm run test:docs`：27/29 gates 通过；两项失败均来自工作树中未提交的 writing-patterns 改动——`verify-tech-debt-counters` 读取已删除的 `writing-patterns/src/quality-evaluator.ts` 时报 ENOENT；`verify-translation-pairing` 报 `litho.docs/patent/README.md` 缺少双语配对，以及 `docs/tool-catalog.i18n.yaml` 的 writing-patterns 段落未随英文块更新。两项与本切片无关。

### 设计取舍

- 首个消费方选披露（W-02）而不是新颖性（W-01）：披露的 `search` 已是真实原子并写出 `prior_art`；新颖性的检索仍由收口阶段执行，没有带公开日的 `prior_art`，现在接过滤只会稳定降级。
- 公开日缺失或不可解析的文献保留并列入 `prior_art_undated`，不静默排除：把未知日期当作「非现有技术」会掩盖真实对比文件；报告明确要求人工核实。
- A24 不预设、不推断：只有条目显式标注 `a24Exception`（A24.1–A24.4）且公开日落在申请日前六个月内才排除；落在宽限期外或缺少申请日时保留，并在报告中写明 A24 不适用/未判定。
- 过滤器不重排引用标号：保留下来的条目带原始 `dLabel`，`citation-check` 优先读取它；否则数组缩短会把原 D2 误认成 D1，产生假接地。
- 检索提供者只透传公开日，不改检索质量或排序；未知公开日仍可进入后续分析。

### 验收用例对照

- G-2 `prior-art-filter`：「A24.1–A24.4 + 申请日前六个月内」四种正例全部排除；「宽限期外的 A24.2 标注」保留为现有技术，形成反例；另有边界日（六个月起点）用例。
- G-1 与 S-02 的衔接：截止日来自 `time-baseline` 的 `reference_date`；截止日当天及之后的公开被排除，早于截止日的公开保留。

## 15. 执行记录（2026-10-17，PR-1e：S-03 `conflicting-application`）

### 已改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-core/src/atoms/handlers/builtin/conflicting-application.ts` | 新增 `conflicting-application` 原子与 handler：按 A22.2 第二句判定“在先申请、在后公布（含申请日）、同样的发明或者实用新型”；时间不满足、公开日早于基准、同样性为否、未提供同样性判定分别落入确认/排除/待定；在先申请可用 `priorityDate` 计算有效申请日 |
| `packages/patent/patent-core/src/atoms/handlers/builtin/index.ts`、`src/atoms/index.ts` | 导出并注册新原子、handler 与默认状态键常量（内置原子 19→20） |
| `packages/patent/patent-core/tests/conflicting-application-atom.spec.ts` | 24 个用例：时间正反例、申请日同日、同样性为否/缺失、缺申请日/公开日、优先权有效申请日、目标基准回退、空/缺失/非数组候选、坏日期/坏类型降级、自定义键、`prior_art` 不被当作候选 |
| `packages/patent/patent-core/tests/atoms.spec.ts` | 内置原子清单 19→20 |
| `packages/patent/patent-workflow/src/workflow/manifests.ts` | W-01 在 `search` 后接 `conflicting_application`，`conclude` 消费其报告 |
| `packages/patent/patent-workflow/tests/manifest-atoms.spec.ts` | 位置、`conclude` 依赖与 C-02 输入契约断言 |
| `packages/patent/patent-tools/src/tool/patent-workflow-run.ts` | 新增 `conflictingApplications` 输入与 JSON 数组边界校验；工具说明补充 A22.2 用途 |
| `packages/patent/patent-tools/src/tool/internal/workflow-helpers.ts` | `buildWorkflowRunContext` 映射到 `conflicting_applications` |
| `packages/patent/patent-tools/src/tool/patent-flexible-plan.ts` | 原子参数说明补充 `conflicting-application` |
| `packages/patent/patent-tools/tests/patent-workflow-run.spec.ts` | 新颖性端到端确认抵触申请；非数组输入边界拒绝 |
| `packages/patent/patent-tools/tests/registration.spec.ts` | 完整组合的原子集合加入 `conflicting-application`；内置原子计数 19→20 |
| `docs/tool-catalog.md`、`docs/tool-catalog.zh.md` | 再生/同步新输入、工具说明与原子说明 |
| `snapshots/session/patent-oa-response/tool-schemas.expected.json` | `DSH_SNAPSHOT=refresh` 重写共享 sidecar（新输入 + 说明） |
| `docs/upgrade-guide/v0.2.1-rc.1/patent-workflow-legal-stages/` | 双语升级指南补充 `conflicting_application`、`conflictingApplications` 与迁移步骤 |

### 验证结果

- `pnpm run typecheck`：5/5 gates PASS。
- `pnpm run build`：9/9 gates PASS（含 build:check）。
- `pnpm exec tsx scripts/run-oxlint.ts <改动文件>`：0 errors、0 warnings。
- `pnpm exec vitest run packages/patent`：4589 通过、2 跳过、0 失败。
- `pnpm run test:snapshot -t patent`：11 通过（refresh 后 replay 复核）。
- `pnpm run verify-tool-catalog`、`verify-upgrade-guides`、`verify-export-jsdoc`、`verify-repository-references`、`verify-cordis-catalog`：通过。
- `pnpm run verify-translation-pairing`：本次改动的 `docs/tool-catalog.md` 与升级指南配对通过；全量检查仅剩工作树既有的 `litho.docs/patent/README.md` 缺少双语配对。
- `pnpm run test:docs`：28/29 gates 通过；唯一失败为工作树中未跟踪的 `litho.docs/patent/README.md` 缺少双语配对，与本切片无关。

### 设计取舍

- 不做语义上的“同样性”判断：A22.2 第二句要求同样的发明或者实用新型，确定性代码无法可靠判定；`sameInvention` 由调用方显式给出，缺失时进入待定而不是默认成立，避免把未核实条目当成抵触申请。
- 候选不从现有技术检索结果读取：抵触申请在目标申请日以前尚未公布，按“公开日早于申请日”检索找不到；因此新增 `conflictingApplications` 输入，并保持原子不依赖 `prior_art`/`search`（C-02）。
- 原子阶段不声明 `consumes`：仓库约定原子直接读 state，`consumes` 只属于收口阶段；依赖契约改由 `inputSchema` 与行为测试锁定。
- 公开日等于目标申请日按“申请日以后（含申请日）公布”处理；申请日与目标申请日相同的条目排除并提示 A9 重复授权，避免把同日申请误判为抵触申请。
- 外国申请不适用 A22.2 第二句；原子在文档与升级指南中明确该前提，不在代码里猜测申请受理局。
- 月级日期直接降级而不是推断到月初/月末：时间关系决定是否破坏新颖性，推断日期会同时制造假阳性和假阴性；输入契约要求 `yyyy-MM-dd`。
- 未知日期按“缺失进入待定、格式错误降级”区分：缺字段是信息不足，坏日期是录入错误；后者直接暴露，避免静默放过。

### 验收用例对照

- C-02 依赖契约：`conflicting-application` 的 `inputSchema` 含 `conflicting_applications`/`reference_date`/`filing_date`，不含 `prior_art`/`search`；传入 `prior_art` 但无候选时报告“未提供抵触申请候选”。`citation-check` 的 `inputSchema` 含 `prior_art`/`conclude`，披露 manifest 的 `citation_check` 原子与 `report.consumes` 断言同时覆盖。
- S-03 正例：在先申请（2023-01-01）、在后公布（2024-07-01）、`sameInvention: true` → 确认抵触申请，报告写明仅用于新颖性判断且不得组合。
- S-03 反例：公开日早于目标基准 → 归入现有技术；申请日相同/晚于目标 → 不构成抵触申请；`sameInvention: false` → 不构成；缺公开日/缺同样性判定 → 待定。

## 16. 执行记录（2026-10-17，PR-1f：S-05 `numeric-range`）

### 已改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-core/src/atoms/handlers/builtin/numeric-range.ts` | 新增 `numeric-range` 原子与 handler：包装 `novelty/numeric-range.ts` 的 `analyzeNumericRanges`；权利要求侧读取 `claim`/`claim_text`/`features`，全缺失时回退 `source_text`/`text`/`input`/`extraction_input`；对比侧读取 `prior_art` 条目的 `text`/`snippet`/`abstract`/`title`；保留 `dLabel`，输出结论、重叠对与提取到的数值表述 |
| `packages/patent/patent-core/src/atoms/handlers/builtin/index.ts`、`src/atoms/index.ts` | 导出并注册新原子、handler 与默认键常量（内置原子 20→21） |
| `packages/patent/patent-core/tests/numeric-range-atom.spec.ts` | 18 个用例：重叠/共同端点/数值点在范围内、无重叠/单位不同、缺现有技术、条目无可读文本、无带单位数值、类型错误降级、`features` 与兜底键、重复文本去重、字段优先级、`dLabel`、非数组 `prior_art`、自定义键与非法配置 |
| `packages/patent/patent-core/tests/atoms.spec.ts` | 内置原子清单 20→21 |
| `packages/patent/patent-workflow/src/workflow/manifests.ts` | W-01 在 `compare` 后接 `numeric_range`，`conclude` 消费其报告 |
| `packages/patent/patent-workflow/tests/manifest-atoms.spec.ts` | 位置与 `conclude` 依赖断言 |
| `packages/patent/patent-tools/src/tool/patent-flexible-plan.ts` | 原子参数说明补充 `numeric-range` |
| `packages/patent/patent-tools/tests/patent-workflow-run.spec.ts` | 新颖性端到端：调用方 `priorArt` 进入数值范围核验并判为破坏新颖性 |
| `packages/patent/patent-tools/tests/patent-workflow.spec.ts` | recap 阶段列表加入 `numeric_range`；阶段数 7→8 |
| `packages/patent/patent-tools/tests/registration.spec.ts` | 完整组合的原子集合加入 `numeric-range` |
| `docs/tool-catalog.md`、`docs/tool-catalog.zh.md` | 再生/同步原子参数说明 |
| `snapshots/session/patent-oa-response/tool-schemas.expected.json` | `DSH_SNAPSHOT=refresh` 重写共享 sidecar（原子说明） |
| `docs/upgrade-guide/v0.2.1-rc.1/patent-workflow-legal-stages/` | 双语升级指南补充 `numeric_range`、数值范围判定口径与 `priorArt` 迁移说明 |

### 验证结果

- `pnpm run typecheck`：5/5 gates PASS。
- `pnpm run build`：9/9 gates PASS（含 build:check）。
- `pnpm exec tsx scripts/run-oxlint.ts <改动文件>`：0 errors、0 warnings。
- `pnpm exec vitest run packages/patent`：4609 通过、2 跳过、0 失败（306 个文件通过、1 个跳过）。
- `pnpm run test:snapshot -t patent`：11 通过（refresh 两次后 replay 复核）。
- `pnpm run verify-tool-catalog`、`verify-upgrade-guides`、`verify-export-jsdoc`、`verify-repository-references`：通过。
- `pnpm run verify-translation-pairing`：本次改动的工具目录与升级指南配对通过；全量检查仅剩工作树既有的 `litho.docs/patent/README.md` 缺少双语配对。
- `pnpm run test:docs`：28/29 gates 通过；唯一失败为上一条同源问题，与本切片无关。
- `git diff --check`：通过。

### 设计取舍

- 包装既有内核而不新写解析器：连接符、单位词表与区间判定沿用 G-04 收敛后的 `analyzeNumericRanges`，原子只负责状态读取、报告措辞与输出键。
- 权利要求侧优先显式权利要求，再退到特征与原始材料：`patent_workflow_run` 会同时写入 `claim`、`claim_text` 与 `source_text`，按文本去重避免同一材料重复计数；直接调用 `runWorkflow` 的调用方常只写 `input`，因此兜底键包含 `input`/`text`/`extraction_input`。
- 缺文本给 `inconclusive`，类型错误才降级：没有可比对对象是信息不足，不是阶段失败；把缺文本判成降级会让未提供检索结果的新颖性运行整条链失败，而这正是 W-01 当前的常态。状态值类型错误属于写入错误，直接暴露。
- 只让带单位的强发现参与判定：无单位数字多是权项编号（“权利要求 1-3”），参与判定会系统性误报；报告同时声明该核验不替代语义新颖性分析。
- 对比侧保留 `dLabel`：数组可能被 `prior-art-filter` 缩短，按位次重编号会让报告中的 D 标号与引用校验脱节。
- 本次只接 W-01：W-04 的计划链未包含 `numeric-range`，且其 manifest 没有检索阶段；待可专利性补充现有技术输入后再按同一原子接入。

### 验收用例对照

- S-05 正例：`50-80℃` 对 `60-90℃` → `overlapped`；数值点 `60℃` 与范围 `60-90℃` 共端点 → `overlapped`；数值点 `70℃` 落在 `60-90℃` 内且无共同端点 → `inside_without_endpoint`。
- S-05 反例：区间不相交或单位不同 → `no_overlap`；权利要求只有权项编号 → 未检测到带单位数值，不给重叠结论；缺 `prior_art` → `inconclusive`；`prior_art` 非数组或文本字段类型错误 → 降级。
- B-4 输出键契约：`numeric_range` 的主输出进入阶段结果，`conclude.consumes` 含 `numeric_range`。
- B-5 确定性：原子不依赖 LLM provider，所有判定由文本与单位词表决定。

## 17. 执行记录（2026-10-17，PR-1g：S-07 `problem-check`）

### 已改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-core/src/atoms/handlers/builtin/problem-check.ts` | 新增 `problem-check` 原子与 handler：读取 `diff`/`inventiveness_diff` 的 JSON 或平面文本与 `distinguishing_features`/`diff_features`；新增 `PROBLEM-EQUALS-FEATURE`，并复用 `problem/atomicChecker.ts` 的不绑方案、单一因果、可测效果检查 |
| `packages/patent/patent-core/src/atoms/handlers/builtin/index.ts`、`src/atoms/index.ts` | 导出并注册新原子、handler、默认键与违规类型（内置原子 21→22） |
| `packages/patent/patent-core/tests/problem-check-atom.spec.ts` | 17 个用例：问题复述特征、长句提到特征不误报、短特征跳过、平面/JSON/代码围栏、结构化特征、解决手段、复合因果、缺量化提示、缺问题放行、自定义键与非法配置、类型错误降级 |
| `packages/patent/patent-core/tests/atoms.spec.ts` | 内置原子清单 21→22 |
| `packages/patent/patent-workflow/src/workflow/manifests.ts` | W-03 在 `diff` 后接 `problem_check`，`hint` 与 `conclude` 消费其产出 |
| `packages/patent/patent-workflow/tests/manifest-atoms.spec.ts` | 创造性阶段顺序与 `consumes` 断言 |
| `packages/patent/patent-tools/src/tool/patent-flexible-plan.ts` | 原子参数说明补充 `problem-check` |
| `packages/patent/patent-tools/tests/patent-workflow-run.spec.ts` | 创造性端到端：复述特征的问题判为未通过，落到技术效果的问题判为通过 |
| `packages/patent/patent-tools/tests/registration.spec.ts` | 完整组合的原子集合加入 `problem-check` |
| `docs/tool-catalog.md`、`docs/tool-catalog.zh.md` | 再生/同步原子参数说明 |
| `snapshots/session/patent-oa-response/tool-schemas.expected.json` | `DSH_SNAPSHOT=refresh` 重写共享 sidecar（原子说明） |
| `docs/upgrade-guide/v0.2.1-rc.1/patent-workflow-legal-stages/` | 双语升级指南补充 `problem_check` 与判定口径 |

### 验证结果

- `pnpm run typecheck`：5/5 gates PASS。
- `pnpm run build`：9/9 gates PASS（含 build:check）。
- `pnpm exec tsx scripts/run-oxlint.ts <改动文件>`：0 errors、0 warnings。
- `pnpm exec vitest run packages/patent`：4628 通过、2 跳过、0 失败。
- `pnpm run test:snapshot -t patent`：11 通过（refresh 两次后 replay 复核）。
- `pnpm run verify-tool-catalog`、`verify-upgrade-guides`、`verify-export-jsdoc`、`verify-repository-references`：通过。
- `pnpm run verify-translation-pairing`：本次改动的工具目录与升级指南配对通过；全量检查仅剩工作树既有的 `litho.docs/patent/README.md` 缺少双语配对。
- `pnpm run test:docs`：28/29 gates 通过；唯一失败为同一条既有问题。
- `git diff --check`：通过。

### 设计取舍

- 复述判定只做规范化后的精确相等，不做包含匹配：技术问题在更长句中提到区别特征（“如何提高散热鳍片的散热效率”）是正常写法，包含匹配会系统性误报；去掉“如何/怎样”、手段动词与泛化结构尾词后仍完全相等，才认定为把问题写成了特征本身。
- 复用既有四检验而不是重写规则：`problem/atomicChecker.ts` 已覆盖不绑方案、单一因果与可测效果，原子只补“问题等于特征”并在报告层给出代码与严重度，避免与 checker 规则产生第二套口径。
- 缺问题文本放行、类型错误降级：diff 是收口阶段，输出格式可能漂移；把“提取不到”判成失败会让整条创造性链降级，而这不是法律结论。状态值类型错误属于写入错误，直接暴露。
- 可测效果只作质量提示：缺少量化数据不是“确定不合规”，与既有 `INVENTIVENESS-PROBLEM-UNMEASURED` 的 Quality 级别保持一致。
- 只接 W-03：S-07 的预期消费方就是创造性三步法第二步；其他 manifest 没有该阶段产出，暂不接线。

### 验收用例对照

- S-07 正例：区别特征“设置限位凸台”，技术问题“如何设置限位凸台” → `PROBLEM-EQUALS-FEATURE`，`problem_check_passed=false`。
- S-07 反例：技术问题“如何将装配温度从95℃降至78℃” → 通过；问题在更长句中提到特征（“如何提高散热鳍片的散热效率”）→ 不误报；特征仅为“X” → 跳过比对。
- 既有四检验：含解决手段或复合因果 → 阻断；缺可测指标 → 仅质量提示，不改变通过状态。
- B-4 输出键契约：`problem_check` 的主输出进入阶段结果，`hint` 与 `conclude` 的 `consumes` 含 `problem_check`。
- B-5 确定性：原子不依赖 LLM provider。

## 18. 执行记录（2026-10-17，PR-1h：S-10 `response-check`）

### 已改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-tools/src/atoms/response-check.ts` | 新增 `response-check` 原子与 handler：从 `patent-rule` 全量规则集选出 PR-OA-007/008/009；答复正文默认读 `draft`/`response`/`response_text`/`statement`，通知书优先读 `office_action`（`oa-parse` 的 JSON），缺失时解析 `notice`/`office_action_text`/`input`；缺通知书时双输入规则列入 `response_check_unevaluated`；输出报告、通过标记、违规项与未评估规则 |
| `packages/patent/patent-rule/src/runtime/dual-input.ts`、`src/index.ts` | 双输入规则的输入类型由完整 `ParsedOfficeAction` 收窄为 `Pick<ParsedOfficeAction, 'rejectionTypes'>`（`OfficeActionRejections`）：规则实际只消费驳回理由，收窄后原子可直接传 `oa-parse` 的解析结果 |
| `packages/patent/patent-tools/src/index.ts` | 导出并注册新原子、handler、默认键、规则加载器与结果类型 |
| `packages/patent/patent-tools/tests/response-check-atom.spec.ts` | 20 个用例：逐条覆盖正例、漏答理由、未提条款引用、证据去重、26.3 判准正反例、缺通知书未评估、`input`/自定义键回退、JSON 损坏/类型错误/参数非法/规则缺失/加载抛错降级、加载警告入报告、未识别理由 |
| `packages/patent/patent-tools/tests/patent-workflow-run.spec.ts` | OA 答复端到端：`draft` 漏答“不清楚” → `response_check` 未通过；补齐后通过 |
| `packages/patent/patent-tools/tests/registration.spec.ts` | 完整组合的原子集合加入 `response-check`；注释同步为 patent-core 22 个内置 + 本包 3 个 |
| `packages/patent/patent-tools/src/tool/patent-flexible-plan.ts` | 原子参数说明补充 `response-check` |
| `packages/patent/patent-workflow/src/workflow/manifests.ts` | W-05 在 `draft` 之后接 `response_check`，`approval` 之前 |
| `packages/patent/patent-workflow/tests/manifest-atoms.spec.ts` | OA 答复阶段顺序与原子断言 |
| `docs/tool-catalog.md`、`docs/tool-catalog.zh.md` | 再生/同步原子参数说明 |
| `snapshots/session/patent-oa-response/` | 录制任务由五个收口阶段改为六个；重录会话、工具 schema sidecar，并手工更新 `workspace.expected` 的 run JSON 与 Mermaid 图（record/refresh 不改写该目录） |
| `docs/upgrade-guide/v0.2.1-rc.1/patent-workflow-legal-stages/` | 双语升级指南补充 `patent_oa_response_v1` 的 `response_check`、规则口径与迁移检查项 |

### 验证结果

- `pnpm run typecheck`：5/5 gates PASS。
- `pnpm run build`：9/9 gates PASS（含 build:check）。
- `pnpm exec tsx scripts/run-oxlint.ts <改动文件>`：0 errors、0 warnings。
- `pnpm exec vitest run packages/patent`：4651 通过、2 跳过、0 失败（308 个文件通过、1 个跳过）。
- `pnpm run test:snapshot -t patent`：11 通过（record 重录 `patent-oa-response` 后 replay 复核）。
- `pnpm run verify-tool-catalog`、`verify-upgrade-guides`、`verify-export-jsdoc`、`verify-repository-references`、`verify-cordis-catalog`：通过。
- `pnpm run verify-translation-pairing`：本次改动的工具目录与升级指南配对通过；全量检查仅剩工作树既有的 `litho.docs/patent/README.md` 缺少双语配对。
- `pnpm run test:docs`：28/29 gates 通过；唯一失败为同一条既有问题。
- `git diff --check`：通过。

### 设计取舍

- 只选 PR-OA-007/008/009，不评估整个 `patent_oa_response` 域：同域还有 CON-701（答复期限）与 CON-702（逐条回应）等规则，前者针对通知书而非答复，套到草稿上会稳定误报；S-10 的既有能力边界就是这三条。
- 规则资产缺失即降级，不静默通过：规则文件是随包发布的确定性资产；找不到 PR-OA 规则时，“检查通过”会变成假阴性，必须让阶段显式失败。
- 缺通知书只把双输入规则列为未评估，不让整阶段降级：`oa-parse` 是前置原子，正常 W-05 运行一定有通知书；但直接调用 `runWorkflow` 的调用方可能没有。此时 007 仍可执行，008/009 显式列出，避免“跑了检查”与“没跑”无法区分（与 `rule_check` 的 `notice` 口径一致）。
- 任一规则命中即 `response_check_passed=false`：规则资产的 action（007 block、008/009 warn）描述的是交付门禁语义，本原子是完整性检查；漏答理由属于 G-10 的拒绝路径，不能因规则级别是 warn 就报告通过。action 仍原样保留在违规项中，供上层区分阻断与提示。
- 答复正文优先读 `draft`，不兜底 `text`/`input`：OA 工作流里 `input` 是通知书正文，把通知书当答复会系统性误判；只回退到明确的答复键。
- 只接 W-05：S-10 的预期消费方是 OA 答复；无效/复审的答复侧尚未在计划链中声明该阶段。
- `amendment-basis` 未实现前不接：W-05 仍保持部分完成，避免把 A33 修改依据检查留成空阶段。

### 验收用例对照

- G-10 正例：答复覆盖通知书提出的“创造性、不清楚”，且引用的 22.3/26.4 均在通知书范围内 → `response_check_passed=true`。
- G-10 反例：只答“创造性”、漏答“不清楚” → `PR-OA-008` 违规，报告点名缺失理由，`response_check_passed=false`。
- 未提条款：通知书只提 22.3，答复引用 26.3 → `PR-OA-009` 违规并给出引用原文。
- 26.3 判准：答复只写“说明书未记载相关手段” → `PR-OA-007` 阻断；写入“本领域技术人员根据说明书记载能够实现” → 通过。
- 缺少通知书：008/009 进入 `response_check_unevaluated`，报告写明“未评估”，不静默跳过。
- B-4 输出键契约：`response_check` 的主输出进入阶段结果；阶段位于 `draft` 之后、`approval` 之前。
- B-5 确定性：原子只读状态与随包规则资产，不依赖 LLM provider。
- 覆盖边界：G-10 的“引用出处”与 W-05 反例中的“D10 误判为 D1”属于引用接地，需 `citation-check`（G-9）消费检索/通知书引用源；PR-OA-007/008/009 不检查事实出处，本切片不声称覆盖，留待 W-05 接入引用源时处理。

## 19. 执行记录（2026-10-17，PR-1i：S-11 `amendment-basis`）

### 已改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-core/src/atoms/handlers/builtin/amendment-basis.ts` | 新增 `amendment-basis` 原子与 handler：从答复正文的“修改后权利要求”段提取权项，与同号原权项做字符级 LCS 差异，新增片段回原说明书/原权利要求书检索；输出报告、通过标记、疑似超范围项与比对范围 |
| `packages/patent/patent-core/src/atoms/handlers/builtin/index.ts`、`src/atoms/index.ts` | 导出并注册新原子、handler、默认键与结果类型 |
| `packages/patent/patent-core/tests/amendment-basis-atom.spec.ts` | 19 个用例：契约、未修改放行、原权项/说明书依据正例、新增特征拒绝、新权项编号、多权项、虚词忽略、声明行不并入权项、缺原申请文件降级、来源组合、自定义键、类型/参数错误降级、复核限制提示 |
| `packages/patent/patent-core/tests/atoms.spec.ts` | 内置原子清单加入 `amendment-basis`（22 → 23） |
| `packages/patent/patent-workflow/src/workflow/manifests.ts` | W-05 在 `response_check` 之后、`approval` 之前接 `amendment_basis` |
| `packages/patent/patent-workflow/tests/manifest-atoms.spec.ts` | OA 答复新阶段顺序与原子断言 |
| `packages/patent/patent-tools/tests/patent-workflow-run.spec.ts` | OA 答复端到端：新增未记载特征 → `amendment_basis` 未通过；新特征在原权项中 → 通过 |
| `packages/patent/patent-tools/tests/registration.spec.ts` | 完整组合的原子集合加入 `amendment-basis`；注释同步为 patent-core 23 个内置 |
| `packages/patent/patent-tools/src/tool/patent-flexible-plan.ts` | 原子参数说明补充 `amendment-basis` |
| `docs/tool-catalog.md`、`docs/tool-catalog.zh.md` | 再生/同步原子参数说明 |
| `snapshots/session/patent-oa-response/` | 录制任务由六个收口阶段改为七个；重录会话、工具 schema sidecar，并手工更新 `workspace.expected` 的 run JSON 与 Mermaid 图（record/refresh 不改写该目录） |
| `snapshots/session/patent-oa-chain/` | 重录整链：首次运行 6/7 停在 `approval`，放行后 7/7 完成；`amendment_basis` 对未含修改后权利要求段的草稿报告 A33 不适用 |
| `docs/upgrade-guide/v0.2.1-rc.1/patent-workflow-legal-stages/` | 双语升级指南补充 `amendment_basis`、A33 口径与迁移检查项 |

### 验证结果

- `pnpm run typecheck`：5/5 gates PASS。
- `pnpm run build`：9/9 gates PASS（含 build:check）。
- `pnpm exec tsx scripts/run-oxlint.ts <改动文件>`：0 errors、0 warnings。
- `pnpm exec vitest run packages/patent`：4672 通过、2 跳过、0 失败（309 个文件通过、1 个跳过）。
- `pnpm run test:snapshot -t patent`：11 通过（record 重录 `patent-oa-response` 与 `patent-oa-chain` 后 replay 复核）。
- `pnpm run verify-tool-catalog`、`verify-upgrade-guides`、`verify-export-jsdoc`、`verify-repository-references`、`verify-cordis-catalog`：通过。
- `pnpm run verify-translation-pairing <本次改动的工具目录与升级指南>`：2 对通过；全量检查仅剩工作树既有的 `litho.docs/patent/README.md` 缺少双语配对。
- `pnpm run test:docs`：28/29 gates 通过；唯一失败为同一条既有问题。
- `git diff --check`：通过。

### 设计取舍

- 只认“修改后权利要求”段，不从全文猜权项：答复正文同时包含意见陈述、对比文件分析等数字编号文本，全文扫描会把论证段落当成权项。标题限定为独占一行的“修改后（独立）权利要求（书/全文）”，并在 Markdown 标题、编号标题、声明行与分隔线处结束。
- 用字符级 LCS 找新增片段，不用整段包含匹配：修改通常是在原权项上增补特征，LCS 只把插入的连续字符算作新增，保留与替换部分不误报；整段包含匹配会把任何改写都判成超范围。
- 新增片段必须回原申请文件全文检索，不能只对照原权项：A33 的依据包括原说明书，从说明书并入权利要求的特征应放行。只传原权项时报告明确写“比对来源：原权利要求书”，不暗示已核对说明书。
- 未检测到修改后权利要求即放行：A33 只约束修改；把“没改”判成“无法检查”会让正常答复稳定降级。反过来，检测到修改却缺原申请文件时降级，避免用审查意见通知书冒充修改依据。
- 字符级对照只定位“未记载片段”，报告固定写明“是否可直接、毫无疑义地确定仍需人工复核”：A33 的最终判断是语义问题，确定性原子不能替代人工结论。
- `passed=false` 对应“疑似超范围”，不直接中断工作流：与 `response_check` 一致，失败结论写入阶段产出，后续 `approval` 仍由人工确认；这样既保留拒绝路径，又不把启发式判断变成硬停机。

### 验收用例对照

- G-11 反例：修改后权项新增“不锈钢材质的过滤网”，原说明书只有“散热孔” → `amendment_basis_passed=false`，报告点名权项号与新增片段。
- G-11 正例：新增特征在原权项中已有 → 通过；新增特征只在原说明书中记载 → 通过，报告标注“原说明书 + 原权利要求书”。
- 未修改：草稿不含“修改后权利要求”段 → 通过并写明“A33 不适用”。
- 新权项：修改稿出现原申请没有的权项 5 → 以权项 5 报告新增片段。
- 缺依据：检测到修改但只提供 `source_text`（通知书）→ 降级，不以通知书冒充原申请文件。
- B-4 输出键契约：`amendment_basis` 的主输出进入阶段结果；阶段位于 `response_check` 之后、`approval` 之前。
- B-5 确定性：原子只读状态文本，不依赖 LLM provider。

### 覆盖边界

- 字符级对照不能证明“直接、毫无疑义地确定”，只能定位未记载片段；报告保留人工复核提示。
- 修改前后技术特征的语义等价、上位/下位替换、以及“从原申请文件显而易见地得出”不属于本切片的确定性能力。
- 原申请文件必须由调用方通过 `claims` 或 `original_text`/`description`/`specification` 提供；只传通知书时原子降级，后续接入案卷读取后再补自动获取。

## 20. 执行记录（2026-10-17，PR-1j：S-09 `evidence-check`）

### 已改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-core/src/atoms/handlers/builtin/evidence-check.ts` | 新增 `evidence-check` 原子与 handler：逐条核对证据形式（名称/来源、外文译本、域外公证认证、证人身份、内容哈希）、举证期限、现有技术公开日与争点关联性；输出报告、通过标记、违规项与待核项 |
| `packages/patent/patent-core/src/atoms/handlers/builtin/index.ts`、`src/atoms/index.ts` | 导出并注册新原子、handler、默认状态键与结果类型 |
| `packages/patent/patent-core/tests/evidence-check-atom.spec.ts` | 30 个用例：契约、缺清单/空清单、期限内与逾期（含正当理由）、外文译本、域外公证认证及免除、证人身份与利害披露、公开日等于/早于/晚于截止日、月级日期、A24 标注、缺日期待核、关联性提示、内建/外部哈希、自定义键、类型与日期错误降级、复核限制提示 |
| `packages/patent/patent-core/tests/atoms.spec.ts` | 内置原子清单加入 `evidence-check`（23 → 24） |
| `packages/patent/patent-workflow/src/workflow/manifests.ts` | 无效宣告与复审共用骨架在 `inventiveness` 之后、`approval` 之前接 `evidence-check` |
| `packages/patent/patent-workflow/tests/manifest-atoms.spec.ts` | 两个 contested manifest 的阶段顺序、原子契约与 `evidence`/`evidence_deadline` 输入断言 |
| `packages/patent/patent-tools/src/tool/patent-workflow-run.ts` | 新增 `evidence`（JSON 数组）与 `evidenceDeadline` 输入；在工具输入边界解析数组日期，映射到 `evidence`/`evidence_deadline` |
| `packages/patent/patent-tools/src/tool/internal/workflow-helpers.ts` | 工作流上下文映射新增 `evidence` 与 `evidence_deadline` |
| `packages/patent/patent-tools/tests/patent-workflow-run.spec.ts` | 无效宣告端到端：无理由逾期证据 → `evidence-check` 未通过；期限内证据 → 通过；非数组 `evidence` 与不可解析 `evidenceDeadline` 在输入边界拒绝 |
| `packages/patent/patent-tools/tests/registration.spec.ts` | 完整组合的原子集合加入 `evidence-check`；内置计数注释同步 |
| `packages/patent/patent-tools/src/tool/patent-flexible-plan.ts` | 原子参数说明补充 `evidence-check` |
| `docs/tool-catalog.md`、`docs/tool-catalog.zh.md` | 再生/同步原子参数说明与 `patent_workflow_run` 新输入 |
| `snapshots/session/patent-invalidation/`、`patent-reexamination/` | 收口任务由六个阶段改为七个；重录会话并手工重生成 `workspace.expected` 的 run JSON 与 Mermaid 图（7/7，含 `evidence-check`） |
| `snapshots/session/patent-invalidation-chain/`、`patent-reexamination-chain/` | 重录整链：首次运行 6/7 停在 `approval`，放行后 7/7 完成 |
| `snapshots/session/patent-oa-response/tool-schemas.expected.json` | 同步 `patent_workflow_run` 与 `flexible_plan` 的当前 schema（`patent-jobs` 头类由该场景持有） |
| `docs/upgrade-guide/v0.2.1-rc.1/patent-workflow-legal-stages/` | 双语升级指南补充 `evidence_check`、`evidence`/`evidenceDeadline` 与迁移检查项 |

### 验证结果

- `pnpm run typecheck`：5/5 gates PASS。
- `pnpm run build`：9/9 gates PASS（含 build:check）。
- `pnpm exec vitest run packages/patent`：4707 通过、2 跳过、0 失败（310 个文件通过、1 个跳过）。
- `pnpm run test:snapshot -t patent-invalidation`：2 通过。
- `pnpm run test:snapshot -t patent-reexamination`：2 通过。
- `pnpm run test:snapshot -t patent-oa`：2 通过（确认共享 tool schema sidecar 更新未破坏 OA 场景）。
- `pnpm exec tsx scripts/run-oxlint.ts <本次改动的 TypeScript 文件>`：0 errors、0 warnings。
- `pnpm run verify-tool-catalog`、`verify-upgrade-guides`、`verify-export-jsdoc`、`verify-translation-pairing <本次改动的两个文档对>`：通过。
- `pnpm run test:docs`：26/29 gates 通过；3 个失败来自工作树中并行的 methodology 文案/配对改动（`verify-concrete-terms`、`verify-preset-divergence`、methodology README 配对）与既有 `litho.docs/patent/README.md` 配对缺失，不由本切片引入。

### 设计取舍

- 未提供证据清单时报告“未执行”并放行：无效/复审工作流可以在没有证据输入时跑通分析链；把“没有输入”判为“证据不合格”会让所有未传证据的调用降级。报告明确写“未执行”，不把放行冒充为审查通过。
- 逾期证据是阻断项，域外公证认证是提示项：无正当理由逾期提交直接关系证据能否被采纳（G-12 反例）；公证认证在审查实践中通常先给补正期限，且公开出版物等存在法定免除情形，因此只提示并支持 `notarizedExempt`/`legalizedExempt`。
- 公开日检查只对声明为现有技术的条目执行：无效/复审证据还可能用于公开使用、公知常识等事实，不能把所有证据的日期都套用 A22.5 的截止日。
- A24 标注只降为提示：宽限期是否适用取决于首次公开情形与六个月期间，归 `prior-art-filter`/时间基准判断；本原子不重复实现该规则。
- 内容完整性只校验内建 FNV-1a 格式且同时给出原文摘录的哈希：外部 SHA-256 等哈希无法用内建算法重算，列入待核而不是误报不一致。
- `evidence_check_passed=false` 不中断工作流：与 `response_check`/`amendment_basis` 一致，失败结论写入阶段产出，`approval` 仍由人工确认。

### 验收用例对照

- G-12 反例：证据提交日晚于举证期限且无 `lateJustification` → `EVID-TIME-LATE` 阻断，`evidence_check_passed=false`。
- G-12 正例：证据在期限内提交并与理由关联 → 通过。
- 形式反例：外文证据 `translated=false` → 阻断；证人证言缺证人身份 → 阻断；内建哈希与摘录不一致 → 阻断。
- 时间反例：现有技术公开日等于截止日 → `EVID-TIME-NOT-PRIOR-ART` 阻断（A22.5 要求申请日以前）。
- 关联性反例：证据既无 `grounds` 也无 `claimRefs` → `EVID-RELEVANCE-UNLINKED` 提示。
- B-4 输出键契约：`evidence_check_report` 为主输出；阶段位于 `inventiveness` 之后、`approval` 之前。
- B-5 确定性：原子只读 state 与 `evidence/date.ts`、`evidence/receipt.ts` 的纯函数，不依赖 LLM provider。

### 覆盖边界

- 证据真实性、证明力、公开内容的实质比对与证据链完整性仍需人工复核；报告固定写明。
- 举证期限不从程序文书推断，必须由调用方通过 `evidenceDeadline` 或 `evidence_deadline` 显式提供；未提供时期限检查列为“未评估”。
- 逾期理由是否成立、域外证据是否属于法定免除情形，由合议组/人工判断；原子只核对声明与形式。
- `citation-check`（S-08）与 `legal-gaps`（R-03）已于 PR-1n 接入 W-06/W-07：当前链在 `evidence-check` 后依次执行 `citation-check → legal_gaps → approval`。

## 21. 执行记录（2026-10-17，PR-1k：S-04 `eligibility`）

### 已改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-tools/src/atoms/eligibility.ts` | 新增 `eligibility` 原子与 handler：按权利要求（有行首编号时逐项）或技术交底书整体筛查 A25 客体；A5 复用 `EX-SEL-004`；输出报告、通过标记、总体结论、发现、单元结论与待核项 |
| `packages/patent/patent-tools/src/atoms/state-text.ts` | 抽出多原子共用的“按优先级读取第一个非空字符串键”纯函数 |
| `packages/patent/patent-tools/src/atoms/response-check.ts` | 改用共用读取函数，行为不变（避免与 eligibility 的读取逻辑重复） |
| `packages/patent/patent-tools/src/index.ts` | 导出并注册 `eligibilityAtom`/`EligibilityHandler`，连同规则加载与结果类型 |
| `packages/patent/patent-tools/src/tool/patent-flexible-plan.ts` | 原子参数说明补充 `eligibility (params.claims_key, text_key)` |
| `packages/patent/patent-workflow/src/workflow/manifests.ts` | 抽出 `TIME_BASELINE_STAGE` 与 `ELIGIBILITY_STAGE` 共用阶段；披露工作流 `preprocess → eligibility → extract_problem`，`report` 消费 `eligibility`；可专利性工作流 `parse → eligibility → claim-chart`，`draft` 消费 `eligibility` |
| `packages/patent/patent-tools/tests/eligibility-atom.spec.ts` | 27 个用例：契约、G-4 正反例、药物产品/用途/制备方法、手术机器人控制、动植物品种与生产方法、微生物、核变换与反应堆、含技术特征的智力活动/商业方法、边界主题、A2 技术特征提示、A5 命中/缺失/加载失败、真实规则资产、多权项、交底书兜底、参数覆盖、降级与限制说明 |
| `packages/patent/patent-tools/tests/registration.spec.ts` | 完整组合的原子集合加入 `eligibility`；计数注释同步 |
| `packages/patent/patent-tools/tests/patent-workflow-run.spec.ts` | 测试装配注册 `eligibility`，披露工作流运行路径与生产装配一致 |
| `packages/patent/patent-workflow/tests/manifest-atoms.spec.ts` | 两个 manifest 的 `eligibility` 原子、顺序、无 `consumes`、报告/布局消费断言 |
| `docs/tool-catalog.md`、`docs/tool-catalog.zh.md` | 再生/同步 `flexible_plan` 原子参数说明 |
| `snapshots/session/patent-oa-response/tool-schemas.expected.json` | 同步 `flexible_plan` 的 `atom` 参数说明（该场景持有 `patent-jobs` 头类 schema） |
| `docs/upgrade-guide/v0.2.1-rc.1/patent-workflow-legal-stages/` | 双语升级指南补充披露/可专利性 `eligibility` 阶段与迁移检查项（英文 499 词） |

### 验证结果

- `pnpm run typecheck`：5/5 gates PASS。
- `pnpm run build`：9/9 gates PASS（含 build:check）。
- `pnpm exec vitest run packages/patent`：4722 通过、2 跳过、0 失败（313 个文件通过、1 个跳过）。
- `pnpm run test:snapshot -t patent`：11 通过。
- `pnpm exec vitest run packages/patent/patent-tools/tests/eligibility-atom.spec.ts packages/patent/patent-tools/tests/registration.spec.ts packages/patent/patent-workflow/tests/manifest-atoms.spec.ts`：64 通过。
- `pnpm exec vitest run packages/patent/patent-tools/tests/patent-workflow-run.spec.ts packages/patent/patent-tools/tests/patent-workflow.spec.ts packages/patent/patent-tools/tests/patent-flexible-plan.spec.ts`：69 通过。
- `pnpm exec oxlint <本次改动的 TypeScript 文件>`：0 errors、0 warnings。
- `pnpm run duplication`：本切片文件（`eligibility.ts`、`state-text.ts`、`response-check.ts`、`manifests.ts`）均不在报告的新增克隆对中；命令仍因既有 atom 与并行 methodology 改动报告的 10 对非基线克隆退出 1（非本切片引入）。
- `pnpm run verify-tool-catalog`、`verify-upgrade-guides`、`verify-export-jsdoc`、`verify-repository-references`、`verify-translation-pairing <本次改动的两个文档对>`：通过。
- `pnpm run test:docs`：28/29 gates 通过；唯一失败是既有 `litho.docs/patent/README.md` 缺少双语配对，不由本切片引入。

### 设计取舍

- 既有 `patent-rule` 的 EX-SEL-001/002/003/005 是 `structural_analysis`（缺失即违规）自检规则，且已整体降为 `log`；它们不能判定“权利要求属于某类客体”，直接复用会对几乎所有文本误报。S-04 因此只复用可作检测器的 EX-SEL-004（关键词黑名单，已降为 `warn`），A25 分类按指南第二部分第一章4.1–4.4 的主题名称与类目清单实现。
- 纯智力活动规则阻断、含技术特征的智力活动主题只提示：指南4.2 明确“权利要求除主题名称外全部为智力活动内容”才按 A25 排除；含技术特征的，不依据 A25 排除，但仍需判断是否构成 A2.2 技术方案。疾病的诊断/治疗方法、动植物品种、原子核变换不因含技术特征而回到可授权客体，保持阻断。
- 产品/用途/制造方法从诊疗方法中分流：药物组合物、诊断试剂盒、“在制备…药物中的应用”、药物制备方法都不是 A25.1(3) 的治疗方法；手术机器人控制方法按设备控制处理，不按手术方法排除。
- 动植物品种与微生物分流：只有“品种/新品种”本身阻断；生产方法按 A25.2 提示人的技术介入程度；微生物、菌株、细菌、真菌、病毒不属于动植物品种。
- A5 只给提示：复用规则资产的关键词命中存在误伤面，且资产本身已把 EX-SEL-004 定为 `warn`；规则资产缺失或加载失败列入待核，不静默跳过，也不因 A5 未检查而阻断 A25 结论。
- 报告固定写明“只做主题名称与文本表面的确定性筛查，不进行技术问题/技术效果认定”，避免把启发式分类冒充审查结论。
- 状态文本读取抽到 `atoms/state-text.ts`，`eligibility` 与 `response-check` 共用；披露/可专利性共用的 `TIME_BASELINE_STAGE` 与 `ELIGIBILITY_STAGE` 抽为 manifest 常量，避免同文件自克隆（`pnpm run duplication` 不再报告这四个文件）。

### 验收用例对照

- G-4 正例：`一种阀体，包括阀座、阀芯和弹簧…` → `technical-solution`，`eligibility_passed=true`。
- G-4 反例（智力活动）：`一种游戏规则…` 无技术特征 → `ELIG-A25-MENTAL` 阻断。
- G-4 反例（诊疗方法）：`一种治疗糖尿病的方法…` → `ELIG-A25-MEDICAL` 阻断。
- 反例豁免：治疗药物/诊断试剂盒/用途权利要求/药物制备方法/手术机器人控制方法 → 不触发 A25.1(3)。
- 反例（动植物）：`一种水稻品种` → 阻断；`一种培育水稻品种的方法` → A25.2 提示；微生物菌株 → 不阻断。
- 反例（核变换）：`一种原子核变换方法` → 阻断；`一种核聚变反应堆` → 不阻断。
- 含技术特征：`一种游戏方法，通过终端显示游戏界面…` → `ELIG-A25-MENTAL` 仅为 `warn`，`eligibility_passed=true`。
- B-4 输出键契约：`eligibility_report` 为主输出；披露阶段位于 `preprocess` 之后、`extract_problem` 之前，可专利性阶段位于 `parse` 之后、`claim-chart` 之前。
- B-5 确定性：A25 筛查只读状态文本与固定词表；A5 只调用 `patent-rule` 的纯函数规则评估。

### 覆盖边界

- 本原子不判断技术问题、技术效果、技术手段与自然规律的实质关系，也不判断“是否属于主要是生物学的方法”；这些结论仍需人工复核。
- 主题名称与类别词表是启发式：未命中类目词的技术方案直接放行，可能漏报改写成“数据处理方法”的纯商业规则；含技术特征的主题只提示，不阻断。
- A5 关键词规则只覆盖资产列出的红线词，且存在否定语境与领域放行词的边界；报告保留提示级别。
- 披露工作流在撰写权利要求前运行，只能按技术交底书整体筛查；最终客体结论以权利要求为准，报告已显式标注作用域。

## 22. 执行记录（2026-10-17，PR-1l：W-06/W-07 接入 S-08 `citation-check`）

### 已改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-workflow/src/workflow/manifests.ts` | `buildContestedManifest` 在 `evidence-check` 之后、`approval` 之前接入 `citation-check`；`params` 指定 `ref_text_keys: ['novelty', 'inventiveness']`，读取两个收口阶段的结论 |
| `packages/patent/patent-workflow/tests/manifest-atoms.spec.ts` | 断言无效与复审的阶段顺序、原子名、`consumes` 为空与参数取值 |
| `packages/patent/patent-tools/tests/patent-workflow-run.spec.ts` | 新增无效 manifest 的引用接地正例（`D1` 对应检索命中）与反例（`US11452699B2` 不在 `priorArt` 中） |
| `snapshots/session/patent-invalidation/session.v4.jsonl`、`snapshot.yml` | recap 作业说明与阶段产出加入 `citation-check`；重录后阶段数为 8 |
| `snapshots/session/patent-invalidation/workspace.expected/...json`、`.mmd` | run 记录与流程图加入 `citation-check` 节点、边与 8/8 摘要 |
| `snapshots/session/patent-invalidation-chain/session.v4.jsonl` | 刷新 manifest 路径快照，加入确定性的 `citation-check` 阶段输出 |
| `snapshots/session/patent-reexamination/session.v4.jsonl`、`snapshot.yml` | 同 recap 无效场景 |
| `snapshots/session/patent-reexamination/workspace.expected/...json`、`.mmd` | 同 recap 无效场景 |
| `snapshots/session/patent-reexamination-chain/session.v4.jsonl` | 同无效整链快照 |
| `docs/upgrade-guide/v0.2.1-rc.1/patent-workflow-legal-stages/guide.md`、`guide.zh.md`、`guide.i18n.yaml` | 无效/复审的新增阶段与迁移确认项；英文 497 词（≤500），配对哈希重录 |

### 验证结果

- `pnpm run typecheck`：5/5 gates PASS。
- `pnpm run build`：9/9 gates PASS（含 build:check）。
- `pnpm exec vitest run packages/patent`：4730 通过、2 跳过、0 失败（313 个文件通过、1 个跳过）。
- `pnpm run test:snapshot -t "patent-invalidation|patent-reexamination"`：4 通过（两个 recap 场景 + 两个 manifest 整链场景）。
- `pnpm exec oxlint <本次改动的 TypeScript 文件>`：0 errors、0 warnings。
- `pnpm run verify-upgrade-guides`：通过。
- `pnpm run verify-translation-pairing`：仅既有 `litho.docs/patent/README.md` 缺少双语配对，不由本切片引入。

### 设计取舍

- 引用文本键取 `novelty`/`inventiveness` 而不是默认结论键：无效/复审的新颖性与创造性是收口阶段，执行器把输出写到 `state[stage.id]`；默认的 `novelty_conclusion`/`inventiveness_conclusion` 键在这两个 manifest 中不会产生。
- 检索结果沿用调用方传入的 `priorArt`（映射到 `prior_art`）：无效/复审没有 `search` 原子，证据清单由 `patent_workflow_run` 的 `priorArt` 输入提供；未提供时原子按域契约报告“检索结果为空，跳过硬校验”并放行。
- recap 路径不执行原子：`patent_workflow` 的调用方需要在 `outputs` 中补 `citation-check` 阶段文本，否则该阶段会被标为降级。快照中的 recap 作业已按此更新。
- 校验失败仍不中断：`citation_check_grounded=false` 只进入阶段产出，聚合与阻断留给 R-03 `legal-gaps`。

### 验收用例对照

- G-9 正例：`对比文件 1（D1）` + `priorArt` 含 `CN101234567A` → `引用全部接地（D1）`。
- G-9 反例：`US11452699B2` + `priorArt` 仅含 `CN101234567A` → 报告 `US11452699B2` 未接地。
- B-4 输出键契约：两个 manifest 的阶段顺序均为 `evidence-check → citation-check → approval`，`citation-check` 不声明 `consumes`（原子直接读共享 state）。

### 覆盖边界

- 无效/复审的 `citation-check` 只核对结论文本中的 D 标号与专利号是否出现在 `priorArt`；不判断证据真实性、证明力或对比文件内容是否支持结论，后者仍由 `evidence-check` 与人工复核承担。
- 未提供 `priorArt` 时阶段放行并在报告中写明“检索结果为空”，因此“阶段通过”不等于“引用已核实”。
- R-03 `legal-gaps` 尚未实现：本切片不新增阻断、不改变 `completed` 语义，只把引用校验结果写入阶段产出。

## 23. 执行记录（2026-10-17，PR-1m：R-03 `legal-gaps` 聚合器 + W-05 接入）

### 已改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-tools/src/atoms/legal-gaps.ts` | 新增 `legal-gaps` 原子：按 `params.profile` 把 `response-check`、`amendment-basis`、`eligibility`、`spec-check`、`evidence-check`、`time-baseline`、`prior-art-filter` 等确定性产出映射回法条，输出通过/未通过/未评估/不适用四项状态与可复核依据 |
| `packages/patent/patent-tools/src/index.ts` | 注册并导出 `legalGapsAtom` / `LegalGapsHandler` / 清单类型 |
| `packages/patent/patent-tools/src/tool/patent-flexible-plan.ts` | 原子说明补充 `legal-gaps (params.profile: …)` |
| `packages/patent/patent-tools/tests/legal-gaps.spec.ts` | 9 个用例：答复正例、失败阻断、待核、A33 不适用、全未评估、新颖性时间基准缺口、披露客体失败、profile 缺失/未知降级 |
| `packages/patent/patent-tools/tests/registration.spec.ts`、`patent-workflow-run.spec.ts` | 注册集合与测试装配加入 `legal-gaps` |
| `packages/patent/patent-workflow/src/workflow/manifests.ts` | W-05 在 `amendment_basis` 之后、`approval` 之前接入 `legal_gaps`，参数 `profile: 'oa-response'` |
| `packages/patent/patent-workflow/src/types.ts` | `SessionEventMap` 新增 `patent/legal-gaps` 与 `PatentLegalGapsEvent` |
| `packages/patent/patent-workflow/src/index.ts` | service 路径在 run 结束后把 `legal-gaps` 阶段产出写入 `patent/legal-gaps` 事件（含 `manifestId`/`runId`/`report`） |
| `packages/patent/patent-workflow/tests/service.spec.ts` | 新增事件断言：`patent/legal-gaps` 只写一次并携带 runId 与报告 |
| `packages/patent/patent-workflow/tests/manifest-atoms.spec.ts` | 断言 W-05 的 `legal_gaps` 位置、原子名、参数与无 `consumes` |
| `snapshots/session/patent-oa-response/*`、`patent-oa-chain/session.v4.jsonl` | recap 作业补 `legal_gaps` 产出（8/8），整链快照刷新；run JSON 与 Mermaid 加入新阶段 |
| `snapshots/session/patent-oa-response/tool-schemas.expected.json` | 同步 `flexible_plan` 的原子说明 |
| `docs/tool-catalog.md`、`docs/tool-catalog.zh.md` | 再生/同步 `flexible_plan` 的原子说明 |
| `docs/upgrade-guide/v0.2.1-rc.1/patent-workflow-legal-stages/guide.md`、`guide.zh.md`、`guide.i18n.yaml` | W-05 新阶段、`legal-gaps` 说明与迁移确认项；英文 498 词（≤500），配对哈希重录 |

### 验证结果

- `pnpm run typecheck`：5/5 gates PASS。
- `pnpm run build`：9/9 gates PASS（含 build:check）。
- `pnpm exec vitest run packages/patent`：4741 通过、2 跳过、0 失败（314 个文件通过、1 个跳过）。
- `pnpm run test:snapshot -t patent`：11 通过。
- `pnpm exec oxlint <本次改动的 11 个 TypeScript 文件>`：0 errors、0 warnings。
- `pnpm run verify-tool-catalog`、`verify-upgrade-guides`、`verify-translation-pairing <catalog 与 guide 配对>`：通过。
- `pnpm run duplication`：本切片文件（`legal-gaps.ts`）不在报告的新增克隆对中；命令仍因既有 atom 与并行 methodology 改动的 3 对仓库级克隆退出 1（非本切片引入）。

### 设计取舍

- 原子只做确定性汇总，不调用模型：LLM 兜底复核会把新增模型调用塞进每个 manifest，并使键控快照不可复现；首版把“LLM 兜底”留给后续切片，报告固定写明“不判断实体结论、不替代审查意见”。
- `legal_gaps_passed` 只反映“是否存在已明示的阻断失败”，未评估项记为提示：首次接入 W-05 时，W-01/03/04 的时间基准与说明书检查尚未全部接线，若把未评估当阻断，会让这些工作流稳定报 incomplete。
- 失败严重度按检查声明固定：客体（A2/A5/A25）、权项支持（A26.4/A31.1）、答复规范（A26.3/A26.4/A22.2/A22.3）、修改依据（A33）、证据（指南第四部分第三章4.3.2）为阻断；时间基准、宽限期、抵触申请、结论性检查为提示。
- `patent/legal-gaps` 事件只在 service 路径写出：工具路径（`patent_workflow_run` / recap）目前不写 `patent/workflow-run` 事件，单独为 legal-gaps 写会造成两条路径不对称；工具路径的持久化仍由 workflow-run JSON/Mermaid 承担。
- 首版只接 W-05：答复场景同时具备 `response-check` 与 `amendment-basis` 两个确定性检查，最适合验证聚合器；W-06/W-07/W-08 与 W-01–W-04 的接入分别由 PR-1n/PR-1o 补齐。

### 验收用例对照

- G-13 正例：`response_check_passed=true` + `amendment_basis_passed=true` → `legal_gaps_passed=true`，报告列出 A26.3/A26.4/A22.2/A22.3 与 A33。
- G-13 反例（未通过）：`response_check_passed=false` → `legal_gaps_passed=false`，`response-compliance` 为 `failed`/`block`，报告含 `state.response_check_passed = false`。
- G-13 反例（空转）：无任何检查产出 → 两条法条均列“未评估”，报告仍给出法条与缺少的状态键，不输出空报告。
- D-1：`patent/legal-gaps` 落入 `SessionEventMap`，service 测试断言事件载荷。
- B-4 输出键契约：W-05 阶段顺序为 `amendment_basis → legal_gaps → approval`，`legal_gaps` 不声明 `consumes`（原子直接读共享 state）。

### 覆盖边界

- 汇总项只证明“某项确定性检查已运行/未运行/已失败”，不证明实体结论正确；报告固定写明这一点。
- `legal-gaps` 的清单是静态映射：新增检查或法条时需要同步更新 `LEGAL_GAP_CHECKS`；未登记的检查不会被汇总。
- 工具路径没有 `patent/legal-gaps` 事件；C-03 的事件契约目前由 service 路径覆盖，工具路径的事件接线与 `patent/workflow-run` 一起留待 R-01/R-05。
- W-06/W-07/W-08 已由本切片接入，W-01–W-04 由 PR-1o 接入；C-03 的 `patent/legal-gaps` 事件仍只在 service 路径写出。

## 24. 执行记录（2026-10-17，PR-1n：W-06/W-07/W-08 接入 `legal-gaps`）

### 已改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-workflow/src/workflow/manifests.ts` | `buildContestedManifest` 新增 `legalGapProfile` 选项；无效/复审链在 `citation-check` 之后、`approval` 之前插入 `legal_gaps`；侵权链在 `report` 之后、`approval` 之前插入 `legal_gaps` |
| `packages/patent/patent-tools/src/atoms/legal-gaps.ts` | `inputSchema` 补充 `novelty`/`inventiveness`/`prior_art_defense_report`；新增 `notAssessed` 声明；`[WORKFLOW_DEGRADED]` 输出不再算“已评估”；证据审查报告为“未执行”时记未评估 |
| `packages/patent/patent-tools/tests/legal-gaps.spec.ts` | 新增无效清单（证据失败/未执行/降级）与侵权清单（保护范围通过、现有技术抗辩未评估）用例；补充输入键断言 |
| `packages/patent/patent-workflow/tests/manifest-atoms.spec.ts` | 断言无效/复审与侵权的 `legal_gaps` 位置、原子与 `profile` 参数 |
| `packages/patent/patent-tools/tests/patent-workflow-run.spec.ts` | 无效 manifest 端到端：逾期证据 → `legal_gaps` 报告阻断；期限内证据 → 无阻断 |
| `snapshots/session/patent-invalidation{,-chain}/`、`patent-reexamination{,-chain}/`、`patent-infringement{,-chain}/` | recap 任务补 `legal_gaps` 阶段并重录；chain 会话刷新；运行记录 JSON/Mermaid 与最终摘要同步到 9/9 或 6/6 |
| `docs/upgrade-guide/v0.2.1-rc.1/patent-workflow-legal-stages/guide{,.zh}.md` | 说明无效/复审与侵权新增 `legal_gaps`；英文控制在 500 词内 |
| `docs/upgrade-guide/v0.2.1-rc.1/patent-workflow-legal-stages/guide.i18n.yaml` | 重新记录双语配对哈希 |

### 设计取舍

- 程序清单显式声明 `legalGapProfile`，不把 `GroundProgram` 直接当 profile：理由表还允许 `design`，而 `legal-gaps` 没有对应清单；新增程序时编译器会强制补齐。
- 证据检查在“未提供证据清单”时返回 `evidence_check_passed=true` 与“未执行”报告；聚合器新增 `notAssessed` 谓词，避免把“没有证据”误报成“证据合格”。
- `hasValue` 拒绝 `[WORKFLOW_DEGRADED]` 前缀：阶段执行失败时 state 仍保留降级文本，若按普通字符串计为已评估会掩盖未执行。
- 侵权链没有确定性 `prior-art-defense` 阶段，A62 如实列为“未评估”；不拿 `report` 的整篇文本冒充该法条已评估。

### 验收用例对照

- W-06/W-07 正常证据：`evidence_check_passed=true`、`novelty`/`inventiveness` 均有产出 → 三项均为 `passed`。
- W-06 反例：逾期证据 → `evidence` 为 `failed`/`block`，`legal_gaps_passed=false`，报告含 `审查指南第四部分第三章4.3.2`。
- W-06 缺证据：报告“未执行” → `evidence` 为 `not-assessed`，不阻断。
- W-08：`claim_chart_doc`/`coverage_report` 存在 → A59 通过；无 `prior_art_defense_report` → A62 未评估。
- 降级输出：`[WORKFLOW_DEGRADED]` 文本 → 对应检查为未评估。
- 阶段顺序：无效/复审 `citation-check → legal_gaps → approval`；侵权 `report → legal_gaps → approval`；原子阶段均不声明 `consumes`。

### 覆盖边界

- `legal-gaps` 仍只汇总确定性检查的覆盖情况，不判断实体结论，也不替代审查意见。
- W-08 的保护范围检查以要素网格与覆盖核验产出为准；`claim-construction`、`equivalence-check`、`prior-art-defense` 三个收口阶段尚未落地，A62 的未评估是当前真实状态。
- W-01–W-04 尚未接入 `legal-gaps`；C-03 的 `patent/legal-gaps` 事件仍只在 service 路径写出。

## 25. 执行记录（2026-10-17，PR-1o：W-01–W-04 接入 `legal-gaps`）

### 已改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-workflow/src/workflow/manifests.ts` | 新颖性 `conclude → legal_gaps → approval`；披露 `slop_clean → legal_gaps`（收尾）；创造性 `conclude → legal_gaps → approval`；可专利性 `spec_check → legal_gaps → approval`；profile 分别为 `novelty`/`disclosure`/`inventiveness`/`patentability` |
| `packages/patent/patent-tools/tests/legal-gaps.spec.ts` | 新增披露（宽限期/权项支持通过、充分公开未评估）、创造性（问题校验失败阻断）、可专利性（客体与权项支持通过、时间基准/宽限期未评估）用例 |
| `packages/patent/patent-workflow/tests/manifest-atoms.spec.ts` | 断言四个 manifest 的 `legal_gaps` 位置、原子与 `profile`；披露链该阶段为末阶段 |
| `packages/patent/patent-tools/tests/patent-workflow-run.spec.ts` | 新颖性与可专利性端到端：`legal_gaps` 阶段非降级，报告含对应法条与未评估项 |
| `docs/upgrade-guide/v0.2.1-rc.1/patent-workflow-legal-stages/guide{,.zh}.md` | 四个工作流补充 `legal_gaps`；迁移第 8 条改为“每个工作流均以 legal_gaps 结束，not-assessed 表示尚无确定性检查覆盖”；英文仍在 500 词内 |
| `docs/upgrade-guide/v0.2.1-rc.1/patent-workflow-legal-stages/guide.i18n.yaml` | 重新记录双语配对哈希 |

### 设计取舍

- 四个 manifest 的 `legal_gaps` 都放在各自最后一个确定性检查之后：新颖性/创造性在结论之后、审批之前；披露在 `slop_clean` 之后（该链无终审门）；可专利性在 `spec_check` 之后、审批之前。
- 披露链的 `legal_gaps` 是末阶段：`review_gate` 已在 `draft_claims` 之前完成，后续没有审批门；为保持“先完成全部确定性检查再汇总”的顺序，不再额外插入审批门。
- 未接线的法条不隐藏：新颖性/创造性缺 `prior_art_filter_report` 时 A24 记未评估；创造性/可专利性缺 `reference_date` 时 A22.5 记未评估；披露缺说明书检查时 A26.3 记未评估。这些都是当前接线状态的真实投影。
- 不新增运行时依赖或配置：四个 profile 在 PR-1m 已定义，本切片只改阶段顺序与参数。

### 验收用例对照

- W-01：带 `filingDate` 运行时，`time_baseline`、`conflicting_application`、新颖性结论均为已评估；报告含 A22.5 与“抵触申请”。
- W-02：`eligibility`、`prior_art_filter`、`novelty`、`spec_check` 均有产出 → 对应法条通过；`specification_check_report` 缺失 → A26.3 未评估。
- W-03：`problem_check_passed=false` → A22.3 问题校验为 `failed`/`block`；`conclude` 产出 → 创造性结论通过；时间基准与宽限期未评估。
- W-04：`eligibility` 与 `spec_check` 通过 → A2/A5/A25 与 A26.4 通过；时间基准与宽限期未评估。
- 阶段顺序：新颖性/创造性/可专利性均为 `… → legal_gaps → approval`；披露为 `slop_clean → legal_gaps`（末阶段）；原子阶段均不声明 `consumes`。

### 覆盖边界

- `legal_gaps` 仍只汇总确定性检查的覆盖情况，不判断实体结论。
- W-01 的 `prior-art-filter`、W-03 的 `time_baseline`/`prior-art-filter`/`citation-check`、W-04 的 `time_baseline`/`prior-art-filter` 与 spec 模式仍未接入；对应法条保持“未评估”，不构成通过。
- W-02 的 `enablement`（A26.3）尚无 `spec-check mode=spec` 产出，同样保持未评估。
- `patent/legal-gaps` 事件仍只在 service 路径写出（C-03）。

## 26. 执行记录（2026-10-17，PR-1p：R-01 证据台账接线）

### 已改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-core/src/evidence/ledger.ts` | 新增 `buildWorkflowEvidenceLedger`：从运行终态收集材料、权利要求书、保留/排除/待核实的现有技术、证据与抵触申请，产出带 `citationId` 的收据与内容摘要（digest） |
| `packages/patent/patent-core/src/evidence/index.ts` | 导出台账构建器与相关类型 |
| `packages/patent/patent-core/src/workflow/types.ts` | `WorkflowRunResult.evidenceLedger`（可选） |
| `packages/patent/patent-workflow/src/workflow.ts` | 运行结束时构建台账；有收据才写入结果（空台账不写，缺席明确表示“未记录”） |
| `packages/patent/patent-workflow/src/types.ts` | `SessionEventMap` 新增 `patent/evidence-ledger` 与 `PatentEvidenceLedgerEvent` |
| `packages/patent/patent-workflow/src/index.ts` | service 路径在 `patent/workflow-run` 之后写出台账事件 |
| `packages/patent/patent-tools/src/tool/patent-workflow-run.ts` | 工具输出新增 `evidenceLedger`，并在调用方会话中写出同一事件（前台与后台 run 共用） |
| `packages/patent/patent-core/tests/evidence-ledger.spec.ts` | 新增 13 例：空输入、材料/权利要求、现有技术标号与截断、排除/待核实、证据、抵触申请、非数组/非对象、digest 稳定性 |
| `packages/patent/patent-workflow/tests/workflow.spec.ts` | 运行结果台账（含中断路径）2 例 |
| `packages/patent/patent-workflow/tests/service.spec.ts` | `patent/evidence-ledger` service 事件断言 |
| `packages/patent/patent-tools/tests/patent-workflow-run.spec.ts` | 工具输出与调用方会话事件断言 |
| `snapshots/session/patent-{invalidation,reexamination,infringement,oa}-chain/session.v4.jsonl` | 刷新以包含台账事件；同时把陈旧的 `5/6`、`8/8` 阶段摘要校正为 `8/9`、`9/9` |
| `docs/persistence-catalog.md`、`.zh.md`、`.i18n.yaml`、`docs/persistence-schema.json`、`packages/core/session/src/known-event-types.ts` | 由 `gen-persistence-catalog` 再生；补入 `patent/evidence-ledger` 与此前遗漏的 `patent/legal-gaps` |
| `docs/upgrade-guide/v0.2.1-rc.1/patent-workflow-legal-stages/guide{,.zh}.md` | 说明 `evidenceLedger` 与 `patent/evidence-ledger` 事件；英文控制在 500 词内 |
| `docs/tool-catalog.md`、`.zh.md`、`.i18n.yaml` | 由 `gen-tool-catalog` 再生（输出 schema 新增 `evidenceLedger`） |

### 设计取舍

- 台账按“来源”而非“工具调用”记录：工作流原子不经过 ToolRuntime，`prior_art`、`evidence`、`conflicting_applications` 才是结论真正引用的证据来源。`citationId` 复用现有标号（`MATERIAL`、`CLAIMS`、`D<n>`、`EV<n>`、`CA<n>`），为 R-02 的 D 标号闭环提供查找键。
- 收据不携带 `startedAt`：一次运行只有一个开始时间，由会话事件自身的 `time` 承担；逐条时间戳会让回放 fixture 每次刷新都变化。其余字段沿用通用 `Receipt`（`toolCallId`、`turnId`、`toolName`、`args`、`success`、`write`、`resultText`）。
- 空台账不写入结果：recap 路径不执行原子，`state` 中没有证据来源；写空台账会被读成“已确认没有证据”，缺席才是诚实的“未记录”。
- 记录最终 `state` 而非入参：`prior-art-filter` 会覆盖 `prior_art` 并单列 `prior_art_excluded`/`prior_art_undated`，台账必须反映运行实际使用与排除的文献。
- 事件在 service 与 `patent_workflow_run` 两条路径都写出；后台 job 在结算时写入调用方会话。`patent_workflow` recap 路径不写该事件（其输出也不携带台账）。
- `patent_workflow_run` 的 `evidenceLedger` 字段类型为 JSON 值（schema 的 `{ type: 'json' }`），避免为通过输出校验新增 `as unknown` 断言。

### 验收用例对照

- D-1：`patent/evidence-ledger` 已进入 `SessionEventMap` 与生成的 `known-event-types.ts`；service/工具两条路径都有事件断言。
- D-2：事件载荷包含全部收据与 digest；回放比较（4 个 chain 场景）通过，台账可从日志重建。
- D-5（R-02 前置）：现有技术收据的 `citationId` 为 `D1`、`D2`……；未标注 `dLabel` 时按数组位次补齐。
- 正例：带材料、权利要求、现有技术、证据与抵触申请的一次运行 → 台账依次给出 `MATERIAL`、`CLAIMS`、`D1`、`D2`、`EV-1`、`CA-1`。
- 反例：非数组或不含对象的来源数组 → 不产生收据，`incomplete: true` 标记来源不完整，不静默丢数据。
- 空例：运行未消费任何来源 → 结果无 `evidenceLedger`，也不写事件。

### 验证结果

- `pnpm run typecheck`：5/5 gates PASS。
- `pnpm run build`：9/9 gates PASS。
- 专利包单测：4771 passed，2 skipped。
- 专利快照：11/11 passed（4 个 chain 会话已刷新，台账事件进入 fixture）。
- `pnpm run lint`：0 errors；仅 1 个与本改动无关的既有 unused-disable warning。
- `pnpm run duplication`：仍因既有/并行切片 pair 退出 1；`ledger.ts` 无新增 pair（自克隆经通用数组提取与 `isJsonRecord` 复用消除）。
- `pnpm run verify-upgrade-guides`、`pnpm run verify-persistence-catalog`、`pnpm run verify-tool-catalog`：通过。
- `pnpm run test:docs`：27/29；仅剩已知的 `litho.docs/patent/README.md` 双语配对与并发 `methodology/assets/README*` 的 concrete-terms 两项失败。

### 覆盖边界

- 台账只记录“运行消费了哪些来源、其内容摘要是什么”，不判断文献是否构成现有技术，也不判断引用是否正确；后者归 R-02。
- `patent_workflow` recap 路径与 `flexible_plan` 仍不写 `patent/evidence-ledger` 事件；recap 路径也不把台账放入其工具输出。
- `patent/workflow-run` 与 `patent/legal-gaps` 事件在工具路径仍未写出；C-03 保持“部分完成”。（2026-10-17 PR-1s 已补齐，见 §29。）

## 27. 执行记录（2026-10-17，PR-1q：R-02 引用-证据闭环）

### 改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-core/src/citation-ids.ts` | 新增共享引用标识提取（`PATENT_NUMBER_RE`、`extractCitationIds`、`extractDocIds`）；`citation-check` 与证据台账共用同一提取器；原「必选捕获组必有值」的 `v8 ignore` 改为直接取 `m[1]` 并撤销豁免 |
| `packages/patent/patent-core/src/graph/domains/citation-check.ts` | 改为从共享模块导入并继续 re-export（公开 API 不变）；`checkCitations` 新增可选 `receiptCitationIds`，D 标号按台账收据精确接地 |
| `packages/patent/patent-core/src/evidence/ledger.ts` | `citationLabel` 在 `dLabel`/`label` 之后回退到标题/URL/专利号中的 `D<n>`，再回退数组位次；新增 `priorArtReceiptCitationIds` |
| `packages/patent/patent-core/src/atoms/handlers/builtin/citation.ts` | 把 `prior_art` 的台账收据标号传给校验器；原子描述同步 |
| `packages/patent/patent-core/src/evidence/index.ts` | 导出 `priorArtReceiptCitationIds` |
| `packages/patent/patent-core/tests/citation-check-atom.spec.ts` | 新增：无专利号检索结果按收据接地；`D3` 无收据时拒绝；台账收据标号与原子判定一致 |
| `packages/patent/patent-core/tests/graph/domains.spec.ts` | 新增 `receiptCitationIds` 正例/反例 |
| `packages/patent/patent-core/README{,.zh}.md` | Evidence 段落说明引用与收据使用同一套标号 |
| `docs/TECH_DEBT.md` | `lint.v8-ignore` 由 1167 降至 1166，并记录撤销原因 |

### 设计取舍

- D 标号只认台账 `prior-art` 收据：被 `prior-art-filter` 排除/待核实的文献仍有收据，但不属于现有技术，不能被结论用来接地。
- 收据标号与结论引用共用 `citation-ids.ts`：此前 `citationLabel` 只看 `dLabel`/位次，标题里写 `D2` 的检索结果会被台账记成 `D1`，导致同一篇文献在检查与收据中出现两个标号。
- 专利号仍按检索命中接地（相等/包含/被包含），不要求台账收据携带专利号；台账记录的是来源，不是引用判定。
- 无检索结果、无可提取标识时仍按原契约放行并写明原因；给出收据后，仅 D 标号改为收据精确匹配，不改变“无法校验不双重惩罚”的边界。
- 未改 `citation_check_report` 的成功文案，避免 4 个 chain 快照出现纯文案 diff。

### 验收用例对照

- D-5：`prior_art` 两篇且结论引用 `D2` → 台账 `prior-art` 收据含 `D2`，`citation_check_grounded = true`；结论引用不存在的 `D3` → `citation_check_failures = ['D3']`。
- 正例：检索结果只有标题（无可提取专利号）时，`D2` 仍能按台账收据接地。
- 反例：台账收据只有 `D1`/`D2` 时，`D3` 不被接受（`D10` 也不会被 `D1` 前缀接受）。
- 边界：专利号引用在检索结果无法提取标识时仍放行，并写“无法校验的引用已放行”。

### 验证结果

- `pnpm run typecheck`：5/5 PASS。
- `pnpm run build`：9/9 PASS。
- 专利包单测：4774 passed，2 skipped（新增 3 例）。
- 专利快照：11/11 passed，fixture 无变化。
- `pnpm run lint`：0 errors；仅 1 个与本改动无关的既有 unused-disable warning。
- `pnpm run verify-export-jsdoc`、`pnpm run verify-tech-debt-counters`：通过。
- `pnpm run duplication`：仍因既有/并行切片 pair 退出 1；`citation-ids.ts`、`citation-check.ts`、`ledger.ts` 无新增 pair。
- `pnpm run test:docs`：27/29；仅剩既有的 `litho.docs/patent/README.md` 双语配对与 `methodology/assets/README*` concrete-terms 两项失败。

### 覆盖边界

- `citation-check` 的图路径（`buildCitationCheckGraph`）未传 `receiptCitationIds`，仍按 `prior_art` 文档标识接地；只有 manifest 原子路径接入台账。
- 自定义 `prior_art_key` 仍按其指向的数组生成收据标号；该数组若不在最终 `state.prior_art` 中，运行结束的完整台账不会包含这些收据。
- `patent_workflow_run` 的 `graph=citation-check` 路径不产生 `evidenceLedger`，因此不参与 R-02 闭环。

## 28. 执行记录（2026-10-17，PR-1r：R-04 回放一致性测试）

### 改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-workflow/tests/replay-consistency.spec.ts` | 新增：运行结果经 `JsonFileWorkflowRunStore` 落盘；session 事件 JSON 往返后用 `Session.create` 重放；断言台账、digest 与法条缺口报告和持久化运行一致 |

### 测试路径

1. **写入**：带 `input` 与 `prior_art` 的 manifest 经 `PatentWorkflow.runWorkflow` 执行，`persist: JsonFileWorkflowRunStore` 把结果写到临时目录；session 同时追加 `patent/workflow-run`、`patent/evidence-ledger`、`patent/legal-gaps`。
2. **读取**：`store.loadRun(runId)` 从磁盘反序列化运行结果。
3. **回放**：把 `session.snapshotEvents()` 做 JSON 往返（模拟 JSONL 日志边界），作为 `Session.create` 的 seed 重建会话。
4. **断言**：
   - 重放事件前缀与原始事件类型序列一致（seed 之后只多一条 `session/end-seed`）。
   - `patent/evidence-ledger` 的 `manifestId`、`runId` 与 `ledger` 等于持久化结果。
   - 从事件收据重算 FNV-1a digest，等于事件携带的 `digest`。
   - `patent/legal-gaps` 的 `report` 等于持久化运行中 `atom === 'legal-gaps'` 阶段输出。

### 设计取舍

- 用真实 `JsonFileWorkflowRunStore` 而非内存假件：同时覆盖磁盘序列化、文件命名与 `loadRun` 反序列化。
- 用 JSON 往返而不是直接复用事件对象：session 日志是 JSONL，台账/缺口必须经得起序列化边界的类型与数值变化。
- 用 `Session.create` 的 seed 路径而不是重新执行工作流：该测试验证的是“日志可重建”，不是“模型输出可复现”；重新执行会引入 LLM/检索不确定性。
- seed 会在末尾追加 `session/end-seed`，因此只比较原始事件长度的前缀，不把实现标记混入一致性断言。

### 验收用例对照

- D-2：台账写入 session log，回放可重建 → 重放后的 `ledger` 与持久化 `evidenceLedger` 深度相等，digest 可由收据重算。
- 正例：一条材料 + 一条 `D1` 现有技术 → 持久化与重放均给出 `MATERIAL`、`D1` 两条收据。
- 反例：本次未单独构造损坏日志；JSON 边界由 `Session.create` 的 seed 校验负责（序列号连续性、事件包络、已知事件类型）。
- 缺口一致性：`legal-gaps` 事件报告与持久化阶段输出逐字相等。

### 验证结果

- `pnpm exec vitest run packages/patent/patent-workflow/tests/replay-consistency.spec.ts`：1 passed。
- `pnpm run build`：9/9 PASS（含 typecheck 与 aggregate check）。
- 专利包单测：4775 passed，2 skipped（新增 1 例）。
- 专利快照：11/11 passed，fixture 无变化。
- `pnpm run lint`：0 errors；仅 1 个既有无关 warning。
- `pnpm run test:docs`：27/29；仅剩既有的 `litho.docs/patent/README.md` 双语配对与 `methodology/assets/README*` concrete-terms 两项失败。
- `pnpm run duplication`：仅报告既有的 atom 文件 clone pair，本测试无新增 pair。

### 覆盖边界

- 该测试覆盖 service 路径的 `patent/evidence-ledger` 与 `patent/legal-gaps`；`patent_workflow_run` 工具路径的事件随后由 PR-1s 补齐（§29）。
- 不覆盖崩溃中断后从磁盘恢复长会话的场景；`Session.create` 的 seed 重放覆盖的是完整日志。

## 29. 执行记录（2026-10-17，PR-1s：C-03 工具路径事件）

### 改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-workflow/src/index.ts` | 新增导出 `appendWorkflowRunEvents`，统一写 `patent/workflow-run`、`patent/evidence-ledger`、`patent/legal-gaps`；service 改为调用该函数 |
| `packages/patent/patent-tools/src/tool/patent-workflow-run.ts` | manifest 路径改用 `appendWorkflowRunEvents(run.agent, result, persistTarget?.runId)`，前台与后台 run 共用 |
| `packages/patent/patent-tools/tests/patent-workflow-run.spec.ts` | 断言一次 novelty 工具运行同时写出三类事件与法条缺口报告 |
| `snapshots/session/patent-{invalidation,reexamination,infringement,oa}-chain/session.v4.jsonl` | 刷新以包含工具路径新增的 `patent/workflow-run` 与 `patent/legal-gaps` 事件 |
| `packages/patent/patent-workflow/README{,.zh}.md` | `runWorkflow` 段落补 `patent/legal-gaps` 事件 |
| `docs/upgrade-guide/v0.2.1-rc.1/patent-workflow-legal-stages/guide{,.zh}.md` | 说明 `patent_workflow_run` 也写出三类事件；英文仍 ≤500 词 |

### 设计取舍

- 事件写入集中到一个导出函数，service 与工具不再各写一份：三条事件的判空与 `runId` 条件容易漂移，集中后只会有一处契约。
- 工具路径的 `runId` 取 `persistTarget?.runId`：只有带 `caseId` 的持久化运行才有稳定运行键；未持久化的运行不伪造 id。
- 后台 run 通过 `run.agent` 在结算时写事件；`job_kill` 中断的运行仍按已完成的阶段结果记录，不额外补写未执行阶段。
- 未改动图路径：`graph=...` 不产生 `WorkflowRunResult`，没有 `legal-gaps` 阶段，不属于本契约。

### 验收用例对照

- 正例：`patent_novelty_v1` 工具运行 → 会话中恰好各一条 `patent/workflow-run`、`patent/evidence-ledger`、`patent/legal-gaps`，且 `legal-gaps` 报告包含“法条缺口汇总”。
- 回归：service 路径的三类事件断言保持通过；novelty 在审批门中断时仍保留已执行阶段的 `legal-gaps` 报告。
- 快照：四个 chain 场景重放通过；刷新后的 fixture 再次刷新字节稳定。

### 验证结果

- `pnpm run build`：9/9 PASS。
- 专利包单测：4775 passed，2 skipped（工具测试断言扩展）。
- 专利快照：11/11 passed（4 个 chain fixture 已刷新）。
- `pnpm run lint`：0 errors；仅 1 个既有无关 warning。
- `pnpm run verify-export-jsdoc`、`pnpm run verify-upgrade-guides`：通过。
- `pnpm run test:docs`：27/29；仅剩既有的两项失败。
- `pnpm run duplication`：仅报告既有 atom 文件 clone pair。

### 覆盖边界

- `flexible_plan run` 仍不写这三类事件：它执行 manifest，但结果面向计划状态而非运行记录；该缺口留在后续切片，不在 C-03 的 `patent_workflow_run` 范围内。
- `patent_workflow` recap 路径不执行 manifest，不写 `patent/workflow-run` 事件。
- 图路径的 `citation-check` 等域名图不产生 `WorkflowRunResult`，不参与该事件契约。

## 30. 执行记录（2026-10-17，PR-1t：R-05 双 SDK 投影更新）

### 投影面核对

| 投影面 | 位置 | 结论 |
|---|---|---|
| TypeScript SDK | `snapshots/sdk/` | 28 个场景的 `session.v4.jsonl`、`result.expected.json`、`notifications.expected.jsonl` 均不含 `patent/*` 事件；`validatedSessionEvent` 只校验 `assistant/message` 与 `turn/end` 的消费字段，其余事件按包络透传 |
| Python SDK | `scripts/snapshots/python-sdk-single-exe/`、`python/sdk/src/` | `result.json` 的 `events`/`eventTypes` 不含 `patent/*`；客户端以 `JsonObject` 透传，没有事件名白名单或联合类型需要扩展 |
| 持久化投影 | `packages/core/session/src/known-event-types.ts`、`docs/persistence-catalog.*` | C-03 已由生成器写入 `patent/evidence-ledger` 与 `patent/legal-gaps`；本轮复核生成结果与 `SessionEventMap` 一致 |

结论：R-05 不需要新增或修改 SDK expected。C-03 的新事件只改变“会话里会出现哪些事件”，而两个 SDK 都不枚举事件名；真正的投影更新落在 `KNOWN_SESSION_EVENT_TYPES` 与持久化目录，已由 C-03 完成。

### 验证期间收敛的既有红灯

全量测试暴露了三处与本切片无关、但会阻断 R-05 验收的既有问题：

| 文件 | 改动 | 原因 |
|---|---|---|
| `packages/patent/patent-law/tests/guideline-citation-coverage.spec.ts` | 将钉住的节号从 `第四部分第三章4.4` 改为 `4.4.1` | 仓库实际引用的是 4.4.1（指定答复期限在该子节）；4.4 正文只有审查方式，测试注释也写明钉的是“无效程序指定的答复期限” |
| `packages/patent/patent-core/src/atoms/handlers/builtin/state-keys.ts` + 六个原子 | 抽出 `isRecord`、`isNonEmptyString`、`resolveConfiguredKey`、`resolveTrimmedKey`、`resolveKeyList`、`readStateText` 与 `missingOrMalformed` | 新原子各自复制了同一组状态读取函数，tighter duplication 门禁报告 7 个未入基线 pair；抽出后门禁恢复 0 个 repo-wide clone、84 个基线 pair 全部匹配 |
| `packages/patent/patent-deadline/tests/tool.spec.ts` | `expect.stringContaining(...) as string` | oxlint `no-unsafe-assignment` 将 `any` 值的对象字段赋值判为错误；同仓库另外两处已用相同断言写法 |

### 验收用例对照

- D-3：TS 与 Python SDK expected 输出同步更新 → 核对后无 expected 需要更新；两条投影面均由各自测试套件覆盖。
- F-7：双 SDK 快照通过 → TS SDK 快照 28/28；Python SDK 单测 231 通过（9 个 bundled-runtime carrier 跳过）。
- C-03 的事件契约 → `patent/workflow-run`、`patent/evidence-ledger`、`patent/legal-gaps` 已进入 `KNOWN_SESSION_EVENT_TYPES` 与 `SessionEventMap`，并由 `pnpm run test` 的持久化目录测试覆盖。
- 回归：抽出共享状态读取函数后，六个原子的正反例（含自定义键、类型错误降级、缺失输入放行）全部通过。

### 验证结果

- `pnpm exec vitest run --config vitest.snapshot.config.ts snapshots/sdk`：28 passed。
- `uv sync --project python/sdk --group test && uv run --project python/sdk pytest`：231 passed，9 skipped。
- `pnpm run test`：2743 files passed，53225 tests passed，1 expected fail，219 skipped。
- `pnpm run build`：9/9 PASS。
- `pnpm run lint`：0 errors；仅 1 个既有无关 warning。
- `pnpm run duplication`：0 repo-wide clone；84 个 tightened-domain pair 与基线一致。

### 覆盖边界

- `scripts/smoke-python-runtime.py` 的打包运行时场景未在本机运行：仓库没有 `dist-exe/<target>` 产物，该场景由 Python-runtime CI 负责。
- SDK expected 不包含 `patent/*`，因此本轮没有新增 SDK 场景；新事件的可回放性已由 R-04 的 session 重放测试覆盖。
- 全量测试中 `packages/experimental/client-ui-voice-input` 曾在并行运行下出现一次空 DOM 失败，单独运行 122/122 通过；该包与本切片无依赖关系。
- 验证时工作树另有一组未提交的 `patent-deadline` 工具 schema 改动（`marketingApprovalDate` 描述、`paidThroughYear`、`termCompensationYears`）。9 个专利会话快照的 request header 因该 schema 变化暂时失配；差异只涉及这三个字段，与本切片的 SDK 投影无关。C-03 完成时该套件为 11/11，fixture 应由该改动自行刷新。

## 31. 执行记录（2026-10-17，PR-1u：C-05 recap 降级与持久化）

### 结论

recap 路径的降级与持久化本身已由 `runWorkflow` 的通用语义满足：`patent_workflow` 以空 `StageHandlerRegistry` 运行，声明了 atom 但调用方未在 `outputs` 中提供文本的阶段回退到空 executor，`pushStageResult` 将其标为 `degraded`，`writeRunArtifacts` 与 `JsonFileWorkflowRunStore` 把同一结果写进 run JSON/Mermaid。本轮补齐了覆盖全部 8 个 manifest 的验收，并修正了 `patent_workflow_run` graph 路径与 manifest 路径不一致的完成语义。

### 已改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-tools/src/tool/patent-workflow-run.ts` | graph 路径的 `completed` 改为 `result.completed && result.degraded.length === 0`：节点降级留下缺失输出，与 manifest 路径的降级阶段同义，不再只凭“走到末端边”报告完成 |
| `packages/patent/patent-tools/tests/patent-workflow.spec.ts` | 测试装配补注册 `patent-tools` 自有的 `slop-gate`、`spec-check`、`response-check`、`eligibility` 与 `legal-gaps`（生产由 `apply()` 注册）；新增两个用例：8 个 manifest 在只提供收口阶段文本时，全部原子阶段降级且不抛错；带 `caseId` 的 recap 运行把 `evidence-check`、`citation-check`、`legal_gaps` 的 `degraded: true` 写进 run JSON |
| `packages/patent/patent-tools/tests/patent-workflow-run.spec.ts` | 新增 graph 路径用例：模型不可用使节点降级，审批门放行续跑后 `graphDegraded` 非空且 `completed=false` |

### 验收用例对照

- C-5：recap 模式新阶段降级为 degraded，不崩 → 对 8 个内置 manifest 逐一断言 `completed=false`，且 `degradedSteps` 精确等于该 manifest 的全部原子阶段 id；没有出现异常。
- D-4（recap 侧）：workflow-run JSON 持久化含新阶段输出 → 读取 `case-9__patent_invalidation_v1.json`，断言 `evidence-check`、`citation-check`、`legal_gaps` 均在 `stages` 中且 `degraded=true`，`degradedSteps` 同时包含三者。
- C-05“manifest/graph 两路径行为一致” → graph 路径存在降级标记时 `completed=false`；manifest 路径在 `requireAllSteps=true` 下同样因任一降级阶段返回 `completed=false`。
- 输出契约回归：`PatentWorkflowRunOutput.completed` 的文档语义为“完成且无降级/中断”，修正前 graph 路径在节点降级后仍返回 `true`，与本字段自身的契约冲突。

### 验证结果

- `pnpm exec vitest run packages/patent`：4810 passed，2 skipped，0 failed（316 个文件通过、1 个跳过）。
- `pnpm run typecheck`：5/5 gates PASS。
- `pnpm run lint`（改动文件）：0 errors、0 warnings。
- `pnpm run duplication`：0 repo-wide clone；84 个 tightened-domain pair 与基线一致。
- `pnpm run build`：9/9 PASS（artifacts + check）。

### 覆盖边界

- recap 路径仍不写 `patent/workflow-run`、`patent/evidence-ledger`、`patent/legal-gaps` 会话事件：调用方提供的是自由文本，不是原子产出，直接复用 `appendWorkflowRunEvents` 会把收口文本伪装成确定性台账/缺口报告。recap 的持久化由 run JSON 与 Mermaid 承担，与 §29 的既有决定一致。
- graph 路径仍是前景执行，不支持 `run_in_background`；本切片只对齐完成语义，不改变执行模型。
- 没有降级的 graph 运行（如 `citation-check`）行为不变；快照中的 graph 场景不受影响。

## 32. 执行记录（2026-10-17，PR-1v：W-01/W-03 检索原子化与过滤/引用接线）

### 结论

W-01 与 W-03 的共同阻塞点是 `search` 仍是收口阶段：它由 executor 生成一段文本，既不执行真实检索，也不写 `prior_art`，因此 `prior_art_filter` 与 `citation_check` 接上去只会稳定降级。计划允许“改成原子检索或显式写出 `prior_art`”，本切片选择原子检索：复用披露工作流已验证的 `keywords` + `search` 原子，检索命中写入 `prior_art`，随后接 `prior-art-filter` 与 `citation-check`。

两条链的最后一跳：

- W-01：`parse → time_baseline → generate_keywords → search(原子) → prior_art_filter → conflicting_application → compare → numeric_range → conclude → citation_check → legal_gaps → approval`
- W-03：`parse → time_baseline → generate_keywords → search(原子) → prior_art_filter → closest → diff → problem_check → hint → secondary → conclude → citation_check → legal_gaps → approval`

§4 目标链中的 `search+keywords(收口)` 因此被原子化取代；这是同一节“待 W-01 改成原子检索”明确允许的路径。`conflicting_application` 仍只读解析结果与时间基准，未消费检索产出（C-02）。

### 已改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-core/src/atoms/handlers/builtin/search.ts` | `search_summary` 增加逐条命中（D 标号、标题、公开日、URL、摘要片段），使只能读阶段文本的收口阶段可逐项对比；调用方提供的 `prior_art` 与检索命中按 URL/标题合并去重，不再被检索结果覆盖；`keywords` 输入增加 `text`/`input` 兜底，服务路径只传 `input` 时也能生成查询词 |
| `packages/patent/patent-core/src/evidence/ledger.ts` | 同一文献同时出现在 `prior_art` 与 `prior_art_undated` 时只生成一条收据，避免一个 D 标号对应两条 receipt |
| `packages/patent/patent-workflow/src/workflow/manifests.ts` | W-01/W-03 接入 `generate_keywords`、`search`、`prior_art_filter`、`citation_check`；W-03 补 `time_baseline`；抽出共用的 `SEARCH_KEYWORDS_STAGE`、`PRIOR_ART_FILTER_STAGE`、`CITATION_CHECK_STAGE` |
| `packages/patent/patent-core/tests/atoms-coverage.spec.ts` | 新增检索摘要携带命中详情与证据合并去重的用例 |
| `packages/patent/patent-core/tests/evidence-ledger.spec.ts` | 新增“保留文献同时列为待核实”只产出一条收据的用例 |
| `packages/patent/patent-workflow/tests/manifest-atoms.spec.ts` | 新增 W-01/W-03 阶段顺序、原子绑定与 `consumes` 断言；更新创造性三步法的依赖断言 |
| `packages/patent/patent-workflow/tests/service.spec.ts`、`workflow-store.spec.ts` | 服务/存储路径的 novelty 运行补最小 provider（关键词 JSON + 空语料），以覆盖新增原子 |
| `packages/patent/patent-workflow/tests/workflow-dag.spec.ts` | Mermaid 链断言改为 `time_baseline → generate_keywords → search` |
| `packages/patent/patent-tools/tests/patent-workflow-run.spec.ts` | 新增三个行为用例：W-01 检索→过滤→引用接地、W-01 引用被过滤文献的反例、W-03 时间基准/检索/过滤进入三步法 |
| `packages/patent/patent-tools/tests/patent-workflow.spec.ts` | recap 的 12 阶段装配（补 `generate_keywords`、`prior_art_filter`、`citation_check`） |

### 验收用例对照

- G-1：申请日前公开进入 `prior_art`、申请日后公开被 `prior-art-filter` 排除 → 检索返回 D1（2023-01-01）与 D2（2024-07-01），`filingDate=2024-06-01`，过滤报告“保留 1 篇，排除 1 篇”。
- G-2：A24 宽限期由 `prior-art-filter` 的既有 22 个原子用例覆盖；本切片只负责把检索结果送进过滤阶段。
- G-9：结论引用 D1 → `citation_check_grounded=true`；引用已被过滤的 D2 → 报告“未在检索结果中找到对应对比文件”，形成拒绝路径。
- C-2：`conflicting_application` 的 `consumes` 仍为 undefined，输入契约不含 `prior_art`/`search`；既有断言未改动。
- C-5：recap 只提供收口阶段文本时，`generate_keywords`、`prior_art_filter`、`citation_check` 与其余原子阶段一并降级，不抛错（既有全 manifest 用例自动覆盖）。
- B-4：`compare`/`closest`/`conclude` 的 `consumes` 加入 `prior_art_filter`，原子阶段仍不声明 `consumes`。
- R-02：过滤后的 `prior_art` 保留原始 D 标号，`citation-check` 按台账收据精确接地；待核实文献只产生一条收据。

### 验证结果

- `pnpm exec vitest run packages/patent`：4817 passed，2 skipped，0 failed（316 个文件通过、1 个跳过）。
- `pnpm run typecheck`：5/5 gates PASS。
- `pnpm run build`：9/9 gates PASS（首次并发运行时 client compiler 一次瞬态失败，单独重跑通过）。
- `pnpm run lint`（改动文件）：0 errors、0 warnings。
- `pnpm run duplication`：0 repo-wide clone；84 个 tightened-domain pair 与基线一致（抽出共用阶段常量后恢复）。
- `git diff --check`：exit 0。

### 覆盖边界

- 新增的两条链没有专属录制快照：`snapshots/session/` 的专利场景覆盖披露、OA、无效、复审与侵权，不运行 novelty/inventiveness manifest。行为由工具级用例覆盖；待这两个场景进入录制任务后再补键控快照。
- 服务路径的 novelty/inventiveness 完整运行现在需要 `provider.search` 与 `provider.callLLM`（或 `provider.llm`）：检索阶段不再由 executor 伪造。缺少 provider 时 `search`、`prior_art_filter` 降级并以 `completed=false` 明示，不再报告一份没有检索依据的“完成”。
- recap 路径仍不执行原子，新增阶段一律降级；这不影响 recap 的持久化与返回结构。
- 专利会话快照仍有 7 个因工作树内并行的 `patent-deadline` 工具 schema 字段（`paidThroughYear`、`termCompensationYears`、`marketingApprovalDate` 描述）失配；差异与本切片无关，fixture 仍留给该改动刷新。

## 33. 执行记录（2026-10-17，PR-1w：C-01 契约复核与 C-06 阶段预算）

### 结论

- C-01 没有代码缺口：S-01..S-11 的 Atom 契约与 StageHandler 都已注册，`registration.spec.ts` 断言完整组合下每个 manifest 引用的 atom 同时有契约与 handler，`atoms.spec.ts` 断言 patent-core 的 24 个内置原子逐一可查。本切片只复跑验收用例，不改注册逻辑。
- C-06 新增两个部署预算：`workflowStageBudget`（阶段数上限）与 `workflowLlmStageBudget`（模型调用阶段数上限），默认 24 / 12，均可在 `cordis.yml` 覆盖。超出预算时 `apply()` 抛 `WorkflowError`，插件加载失败。
- 模型阶段按原子契约判定，不按 `category`：`Atom` 新增可选 `usesModel`，`compare`、`novelty`、`extract`、`keywords`、`reasoning`、`groundedness`、`draft-claims`、`claim-chart` 标记为 `true`。`category` 只表达职责（`time-baseline` 属 extract、`numeric-range` 属 compare，但都是确定性检查），用它计费会把确定性阶段算成模型阶段。
- 未声明 atom 的阶段计入模型阶段：这些阶段由本部署的收口 executor 执行，而该 executor 会发起模型调用。`search` 原子不计入：它调用检索 provider，不调用语言模型。

### 已改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-core/src/atoms/atom.ts` | `Atom` 新增可选 `usesModel`，说明为阶段预算区分模型与确定性检查 |
| `packages/patent/patent-core/src/atoms/handlers/builtin/{compare,extract,reason,search,draft,chart}.ts` | 为 8 个调用语言模型的原子标注 `usesModel: true`；`merge`、`search` 等确定性/检索引擎原子保持省略 |
| `packages/patent/patent-core/src/workflow/budget.ts` | 新增 `countWorkflowLlmStages` 与 `validateWorkflowBudget`：未注册 atom 直接失败，预算非有限正数直接失败，阶段数或模型阶段数超限失败 |
| `packages/patent/patent-core/src/index.ts` | 导出预算校验函数与 `WorkflowStageBudget` 类型 |
| `packages/patent/patent-tools/src/index.ts` | `Config` 新增两个预算字段及默认值常量；schema 要求正整数；`apply()` 在原子注册后、工具注册前逐个校验 8 个内置 manifest |
| `packages/patent/patent-core/tests/workflow-budget.spec.ts` | 新增 6 个用例：模型阶段计数、恰好达限放行、阶段超限、模型阶段超限、未知 atom、非法预算值 |
| `packages/patent/patent-tools/tests/registration.spec.ts` | 新增 3 个用例：阶段预算 20 拒绝披露 manifest（21 阶段）、模型阶段预算 9 拒绝披露 manifest（10 个模型阶段）、显式设为 21/10 时加载成功 |
| `packages/patent/patent-tools/README.md`、`README.zh.md` | 配置表补两个预算字段的默认值与含义 |
| `packages/patent/patent-tools/README.i18n.yaml` | 双语配置小节变更后重新记录 section 哈希 |
| `docs/config-catalog.md`、`docs/config-catalog.zh.md` | 由 `pnpm run gen-config-catalog` 重新生成 |

### 验收用例对照

- A-7：预算字段是 `Config` 字段而非常量，`registration.spec.ts` 用两个不同覆盖值分别触发拒绝与放行，证明加载行为随配置变化。
- B-1：S-01..S-11 的注册由既有 `registration.spec.ts` 与 `atoms.spec.ts` 覆盖，本切片复跑通过。
- B-3：预算校验对未注册 atom 抛 `WorkflowError`，与 `runWorkflow` 的 fail-fast 语义一致，不猜测其成本。
- C-7 / F-5：阶段数 3 > 上限 2、模型阶段数 2 > 上限 1、内置披露 manifest 21 > 20 / 10 > 9 均走拒绝路径；恰好达限与完整默认加载通过。
- A-1：`budget.ts` 的每个判定分支都由 6 个单元用例执行；函数与导出的 JSDoc 由 `verify-export-jsdoc` 覆盖。
- E-3：README 配置表与生成的 config catalog 同步更新。

### 验证结果

- `pnpm exec vitest run packages/patent`：4826 passed，2 skipped，0 failed（317 个文件通过、1 个跳过）。
- `pnpm run typecheck`：5/5 gates PASS。
- `pnpm run build`：9/9 gates PASS。
- `pnpm run lint`（改动文件）：0 errors、0 warnings。
- `pnpm run duplication`：0 repo-wide clone；84 个 tightened-domain pair 与基线一致。
- `pnpm run verify-config-catalog`：3 个产物均为最新。
- `pnpm run test:docs`：28/29 门通过；唯一失败是工作树内未跟踪的 `litho.docs/patent/README.md` 缺少双语配对（并行的 litho 生成物，与本切片无关）。`patent-tools` README 的配对检查在重新记录后通过。
- `git diff --check`：exit 0。

### 覆盖边界

- 预算只在 `patent-tools` 插件加载期约束 8 个内置 manifest。直接调用 `runWorkflow` 的自定义 manifest 没有 Config 可读，仍由调用方自行约束；本次不把部署预算下沉为执行器全局状态。
- 收口阶段一律按模型阶段计数。若某个部署注入确定性的自定义 executor，计数会偏保守（多算而非少算），预算门不会因此漏放。
- 默认值相对当前最大链（披露 21 阶段 / 10 个模型阶段）留出 3 个阶段与 2 个模型阶段的余量；这是部署默认，不是法律上限，扩容时按需覆盖。
- 重新生成 config catalog 时，工作树内并行的 `patent-deadline` / `methodology` / `patent-law` / `patent-rule` 源链接与字段也随生成器一并刷新；本切片没有修改这些包。

## 34. 执行记录（2026-10-17，PR-1x：W-04 时间基准、原子检索与 claim-chart 对比文件派生）

### 结论

W-04 剩余的第一个缺口是 `patent_patentability_v1` 没有时间基准与检索阶段：`legal_gaps` 的 A22.5 与 A24 只能记“未评估”，`claim-chart` 只能依赖调用方手工传 `chart_targets`。本切片复用 W-01/W-03 已验证的 `time-baseline`、`keywords`、`search`、`prior-art-filter` 原子，并补上从 `prior_art` 到 claim-chart 目标的确定性派生。

链变为：

`parse → time_baseline → eligibility → generate_keywords → search(原子) → prior_art_filter → claim-chart(mode=patentability) → draft → spec_check → legal_gaps → approval`

`claim-chart` 的派生规则：

- 只在 `mode=patentability` 且显式 `chart_targets` 为空时启用；显式目标仍然优先；
- 目标顺序与过滤后的 `prior_art` 一致，`dLabel` 合法时沿用，缺标号时按 1 基序号补 `D<n>`；
- 同一标号只保留一个目标，排除的文献已不在 `prior_art` 中，因此不会进入映射；
- 非数组 `prior_art` 与非法条目被跳过，回落到“只拆要素”的既有行为，不抛错。

### 已改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-workflow/src/workflow/manifests.ts` | 可专利性链接入 `time_baseline`、`generate_keywords`、`search`、`prior_art_filter`；`draft` 消费时间基准与过滤报告；更新共用阶段常量的复用范围注释 |
| `packages/patent/patent-core/src/atoms/handlers/builtin/chart.ts` | 新增 `derivePriorArtTargets`；`patentability` 模式在无显式目标时从 `prior_art` 派生对比文件；显式目标优先 |
| `packages/patent/patent-core/tests/claim-chart/chart-atom.spec.ts` | 新增两个用例：`prior_art` 派生目标（含缺标号、重复标号、非对象、空标题）与 `prior_art` 非数组回落 |
| `packages/patent/patent-workflow/tests/manifest-atoms.spec.ts` | 新增可专利性阶段顺序、原子绑定与 `draft` 依赖断言 |
| `packages/patent/patent-tools/tests/patent-workflow-run.spec.ts` | 新增行为用例：时间基准与过滤非降级、过滤保留/排除计数、claim-chart prompt 只含保留的 D1、`legal_gaps` 的 A22.5/A24 记为通过 |
| `packages/patent/patent-tools/tests/legal-gaps.spec.ts` | 原“未接线”用例改名，说明其覆盖的是缺产出的未评估路径 |

### 验收用例对照

- G-1：申请日前公开的 D1 进入过滤后的 `prior_art`，申请日后公开的 D2 被排除；claim-chart prompt 只出现 D1。
- G-2：A24 宽限期由既有 `prior-art-filter` 原子用例覆盖；本切片只负责把检索结果送进过滤阶段。
- C-1：可专利性链按 §4 的目标顺序新增阶段，原子阶段不声明 `consumes`。
- C-7/F-5：可专利性链 7 → 11 阶段、模型阶段 3 → 4，仍低于默认预算 24/12。
- B-4：`draft` 的 `consumes` 与新增上游产出对齐；`claim-chart` 作为原子直接读 `prior_art`。
- B-6：`derivePriorArtTargets` 的正例（混合条目派生）与反例（非数组回落）均由单元测试覆盖。
- G-13：`legal_gaps` 对 A22.5/A24 由“未评估”转为“通过”，依据可复核。

### 验证结果

- `pnpm exec vitest run packages/patent`：4830 passed，2 skipped，0 failed（317 个文件通过、1 个跳过）。
- `pnpm run typecheck`：5/5 gates PASS。
- `pnpm run build`：9/9 gates PASS。
- `pnpm run lint`（改动文件）：0 errors、0 warnings。
- `pnpm run duplication`：0 repo-wide clone；84 个 tightened-domain pair 与基线一致。
- `git diff --check`：exit 0。

### 覆盖边界

- 可专利性的 S-06 仍只跑 `mode=claims`。`mode=spec` 需要说明书草稿阶段：当前 manifest 的 `draft` 只是权利要求布局，套用五段章节规则会稳定误报；W-02 与 W-04 的 spec 模式留待同一份说明书草稿阶段设计落地后一起接。
- claim-chart 派生的目标不设置 `sourcePath`：检索命中的 `url` 不是本地可读源文，设置它会让 pin-cite 校验对每一行报“源文件不可读”。因此派生目标只提供 `id` 与 `title`，pin-cite 保持空串，与既有“未提供源文”语义一致。
- 检索仍依赖部署注入的 `StageProvider.search`；缺少 provider 时 `search` 降级、`prior_art` 缺失，过滤阶段随之降级并以 `completed=false` 明示。
- 本切片不新增录制快照：`snapshots/session/` 没有可专利性场景；行为由工具级与原子级用例覆盖。

## 35. 执行记录（2026-10-17，PR-1y：W-02/W-04 说明书草稿与 `spec-check mode=spec`）

### 结论

W-02 与 W-04 的最后一个缺口是 `spec-check` 只能跑 `mode=claims`：披露的 `source_text` 是技术交底书，可专利性的 `draft` 是权利要求布局，二者都不是说明书全文。直接把五段章节规则套到上游文本会稳定误报。本切片新增确定性的 `draft-specification` 原子，先由它生成五部分说明书草案，再让 `spec-check` 跑 `mode=spec`。

链变为：

- 披露：`… → draft_claims → draft_specification → spec_check(mode=spec) → slop_clean → legal_gaps`
- 可专利性：`… → claim-chart → draft → draft_specification → spec_check(mode=spec) → legal_gaps → approval`

`draft-specification` 的输入端：

- 标题优先取 `title`/`invention_title`；否则取原文首行，超过 25 字或为空时用“技术方案”。
- 说明书正文与技术方案取 `source_text`/`text`/`input`；未提供 `embodiments` 时把技术方案本身作为实施例 1。
- 技术问题优先取 `technical_problem`/`problem`，其次取 `problems` 数组；有益效果同理取 `beneficial_effects`/`effects` 或 `effects` 数组。
- `background`、`drawing_descriptions`、`tech_domain`、`patent_type`、`has_drawings` 原样传入既有 `draftSpecification`；缺可选字段时保留既有【撰写指引】占位。
- 输入为空时降级，不生成一份全是占位的“通过”草案。

`spec-check` 在 `mode=spec` 时新增两个输出键：

- `specification_check_report`：与 `spec_check_report` 同一份说明书检查报告；
- `specification_check_passed`：该报告是否通过。

`mode=claims` 不写这两个键，因此 `legal-gaps` 不会把权项检查误当成充分公开检查。`legal-gaps` 的 `enablement` 检查改为读取 `specification_check_report`，并以 `specification_check_passed=false` 判为未通过；可专利性清单新增该项，与 A26.4/A31.1 的 `claim-support` 分开汇总。

### 已改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-tools/src/atoms/draft-specification.ts` | 新增确定性原子：从工作流状态组装 `DraftSpecificationInput`，渲染五部分说明书草案并写 `specification`；缺技术方案时降级 |
| `packages/patent/patent-tools/src/atoms/state-values.ts` | 抽出 `firstStateString` 与 `resolveTechDomain`，供 `spec-check` 与 `draft-specification` 共用，避免同一读取逻辑两份实现 |
| `packages/patent/patent-tools/src/atoms/spec-check.ts` | `mode=spec` 额外写 `specification_check_report`/`specification_check_passed`；更新契约与输出键 |
| `packages/patent/patent-tools/src/atoms/legal-gaps.ts` | 抽出 `ENABLEMENT_CHECK`，按说明书报告与通过标记评估 A26.3；可专利性清单加入该项 |
| `packages/patent/patent-workflow/src/workflow/manifests.ts` | 披露与可专利性在撰写阶段后插入共用的 `DRAFT_SPECIFICATION_STAGE`；`spec_check` 改为 `mode=spec`、`text_key=specification` |
| `packages/patent/patent-tools/src/index.ts` | 注册并导出 `draftSpecificationAtom`/`DraftSpecificationHandler` |
| `packages/patent/patent-tools/src/tool/patent-flexible-plan.ts` | 原子参数说明加入 `draft-specification` |
| `packages/patent/patent-tools/tests/draft-specification-atom.spec.ts` | 新增 8 个用例：完整草案、标题派生、长标题回落、显式问题/效果优先、无标题首行回落、非法枚举/非字符串数组项、空输入降级、草案经 `spec-check spec` 通过 |
| `packages/patent/patent-tools/tests/state-text.spec.ts` | 覆盖共用状态读取的命中、跳过空值、缺失与类型错误分支 |
| `packages/patent/patent-tools/tests/spec-check.spec.ts` | 断言 spec 模式写说明书专用键、claims 模式不写 |
| `packages/patent/patent-tools/tests/legal-gaps.spec.ts` | 披露/可专利性 A26.3 通过；新增说明书检查未通过但 severity=warn 不阻断的用例 |
| `packages/patent/patent-workflow/tests/manifest-atoms.spec.ts` | 断言两个 manifest 的草案阶段位置、原子绑定与 `spec_check` 参数 |
| `packages/patent/patent-workflow/tests/workflow-retry.spec.ts` | 披露阶段数 21 → 22、原子集合与 `spec_check` 参数同步；retry 测试补草案原子 stub |
| `packages/patent/patent-tools/tests/registration.spec.ts` | 注册集合、预算负例（22 阶段）与 atom 说明覆盖同步 |
| `packages/patent/patent-tools/tests/patent-workflow-run.spec.ts` | 可专利性端到端新增草案/说明书检查断言，并核对 `legal_gaps` 输出 A26.3 |
| `docs/tool-catalog.md`、`docs/tool-catalog.zh.md`、`docs/tool-catalog.i18n.yaml` | 重新生成/同步 atom 参数说明 |
| `.agents/audits/2026-10-17-patent-workflow-guideline-optimization-plan.md` | 状态行、§4 W-02/W-04 与本节执行记录 |

### 验收用例对照

- A-1：新增 `draft-specification.ts` 的每个分支由 `draft-specification-atom.spec.ts` 覆盖；spec 模式新增键由 `spec-check.spec.ts` 覆盖。
- A-2/A-3：无 `as unknown`；新导出与函数均有 JSDoc；`typecheck` 通过。
- B-1/B-3：两个 manifest 的草案阶段不声明 `consumes`（原子直接读 state），`spec_check` 参数由 `manifest-atoms.spec.ts` 锁定。
- C-1/C-7/F-5：披露 22 阶段、可专利性 12 阶段；模型调用阶段仍为 10/4，低于默认预算 24/12。
- E-3：`draft-specification` 在 `patent-tools` apply() 注册；`registration.spec.ts` 断言完整组合下契约与 handler 均存在。
- G-6：`spec-check(spec)` 检查五段齐全与效果量化；草案缺章节/缺实施例的负例由既有 `spec-check.spec.ts` 覆盖。
- G-13：披露与可专利性的 `legal_gaps` 现在能分别报告 A26.3 的通过、未通过与未评估。

### 验证结果

- `pnpm exec vitest run packages/patent`：4843 passed，2 skipped，0 failed（319 个文件通过、1 个跳过）。
- `pnpm run typecheck`：5/5 gates PASS。
- `pnpm run build`：9/9 gates PASS。
- `pnpm exec tsx scripts/run-oxlint.ts <改动文件>`：0 errors、0 warnings。
- `pnpm run duplication`：0 repo-wide clone；基线 pair 与既有记录一致。
- `git diff --check`：exit 0。

### 覆盖边界

- 草案是确定性模板，不替代代理师撰写：缺 `background`/`drawing_descriptions` 时保留【撰写指引】，检查报告会按章节、实施例、数值范围、效果定量等既有规则指出缺口；这些占位不构成“已充分公开”的实体结论，`legal-gaps` 只声明确定性检查是否覆盖 A26.3。
- `spec-check` 的 A26.4/A31.1 仍依赖 `claims_draft`/`draft` 文本；结构化 `claim_units`/`coverage_entries` 仍由调用方提供，本次不新增权项解析器。
- 披露与可专利性的草案都以 `source_text` 为说明书正文来源；若调用方只传权利要求而没有技术方案，草案会退化为以权利要求为正文的草稿，检查报告中的“说明书”语义需人工复核。
- 本切片只同步更新了 `snapshots/session/patent-oa-response/tool-schemas.expected.json` 中 `flexible_plan` 的 atom 参数说明；其余录制会话不涉及披露/可专利性 manifest，未重录。`snapshots/session/` 的既有失败仍来自并行未提交的 `patent-deadline` schema 变更。
- 重新生成 tool catalog 时，工作树内并行的 `patent-deadline` 字段与 `patent_workflow_run` 描述也随生成器一并刷新；本切片没有修改这些源文件。

## 36. 执行记录（2026-10-17，PR-1z：G-02 最小版本闭环）

### 范围

只处理已确认落在当前索引上的 3 个过时节：第二部分第一章4.4、第四部分第三章2.1、第四部分第三章3.3。2023 年基础 `sections` 保持不动，2026 年文本作为 `versions` 覆盖登记；其余节仍是 2023 文本，不声称已按 2026 年版更新。

### 数据与判定

- `versions` 只允许出现在《专利审查指南》索引：`revision` 非空、不得重复、不得等于基础 `revision`；每项至少一个 section，同一版本内路径不得重复；非指南法条声明 `versions` 即加载失败。
- 版本覆盖按路径替换基础 `sections`；版本可以新增基础索引没有的节，为后续 2026 新增节留出位置。
- `verifyCitation` 新增可选的 `revision`：
  - 未指定：若 `supersededBy` 已转录，使用最后声明的版本（版本按从旧到新声明，当前为 2026 年修订版）；覆盖不到的节仍用 2023 基础文本，仍按 `staleSections` 判定。若 `supersededBy` 尚未转录，退回基础文本与过时标记；`supersededBy` 未声明时使用最后一个版本，没有版本则用基础文本。
  - 指定基础 `revision`：使用基础文本，3 节按 `staleSections` 报 `unverified`。
  - 指定索引没有的版本：报 `unverified` 并写明版本，不回退到基础文本。
- 合并视图按 baseline 与版本缓存；正文重合索引按视图缓存，不因每次判定重建。

### 3 节的 2026 文本来源

- 来源：`/Users/xujian/projects/宝宸知识库_Raw/专利审查指南/审查指南修改/《专利审查指南》修改对照表.pdf`（2025-11-13 局令第84号，2026-01-01 施行，40 页）。
- 对照表新栏用颜色区分增删：黑色为保留、红色为新增、蓝色为删除。按颜色剔除删除文字后转录，避免把“同样的相同或者实质相同”这类新旧叠加文本当成最终条文。
- 实际变化：
  - 第二部分第一章4.4：植物定义改为“植物品种，是指经过人工选育或者发现并经过改良，形态特征和生物学特性一致，遗传性状相对稳定的植物群体”，删除旧的“可以借助光合作用……不发生移动的生物”表述。
  - 第四部分第三章2.1：`以同样的理由和证据` → `以相同或者实质相同的理由和证据`。
  - 第四部分第三章3.3：第（3）项同样改为 `以相同或者实质相同的理由和证据`。

### 改动文件

| 文件 | 改动 |
|---|---|
| `packages/patent/patent-law/src/types.ts` | 新增 `GuidelineVersion`；`LawBaseline` 新增必需的 `versions` |
| `packages/patent/patent-law/src/baseline.ts` | 解析并校验 `versions`；非指南声明即失败 |
| `packages/patent/patent-law/src/verify.ts` | `VerifyOptions.revision`；按版本合并视图、缓存；未知版本报 `unverified` |
| `packages/patent/patent-law/src/index.ts` | 导出 `GuidelineVersion`；`staleSectionFor` 保持模块内部，不扩张公共 API |
| `packages/patent/patent-law/assets/law/cn-examination-guidelines.yaml` | 新增 2026 `versions` 的 3 节；订正条目计数 64+14；更新头部说明 |
| `packages/patent/patent-law/tests/baseline.spec.ts` | 版本解析、排序与 7 类负例（含非数组、空 revision、重复 stale 路径） |
| `packages/patent/patent-law/tests/verify.spec.ts` | 默认/多版本/现行版本未转录/指定版本/未知版本/父节覆盖/版本新增节/未覆盖的过时节/无 supersededBy 回落/随包 3 节集成用例 |
| `packages/patent/patent-law/tests/tool.spec.ts` | `law_verify` 默认使用最新转录版本 |
| `packages/patent/patent-law/README.md`、`README.zh.md`、`README.i18n.yaml` | 版本覆盖、计数、已知限制与配对哈希 |
| `packages/patent/patent-law/tools/guideline-transcript.py` | `read_entries` 只解析顶层 `sections:`（避开 `staleSections`）；`rebuild` 只按顶层 `sections:` 切分（避开 `versions` 内的嵌套键），保留版本块与其后的空行；模块注释说明 `versions` 原样保留且不按 2023 PDF 校验 |
| `docs/upgrade-guide/v0.2.1-rc.1/patent-guideline-2026-sections/` | 新增中英升级指南：3 节行为变化、`versions` 字段与迁移步骤 |
| `.agents/audits/2026-10-17-patent-workflow-guideline-optimization-plan.md` | G-02 状态、§4 与本节记录 |

### 验证结果

- `pnpm exec vitest run packages/patent/patent-law`：9 个文件、154 个用例全部通过。
- `pnpm exec vitest run packages/patent/patent-law --coverage --coverage.include='packages/patent/patent-law/src/**/*.ts' --coverage.exclude='packages/patent/patent-law/src/types.ts'`：`baseline.ts`、`verify.ts` 等全部 100% statements/branches/functions/lines；`patent-law` 不在覆盖率豁免名单，必须满足逐文件门禁。
- `pnpm exec vitest run packages/patent`：319 个文件通过、1 个跳过；4863 个用例通过、2 个跳过。
- `pnpm run typecheck`：5/5 gates PASS。
- `pnpm run build`：9/9 gates PASS。
- 改动 TS 文件 oxlint：0 errors、0 warnings。
- `pnpm run verify-translation-pairing packages/patent/patent-law/README.md`：1 对一致；升级指南的中英配对同样通过。
- `pnpm run test:docs`：28/29 通过；唯一失败是并行的 `litho.docs/patent/README.md` 配对缺失，与本切片无关。
- 转录工具 `--write` 在临时副本上保留 `versions` 与其后的空行，只输出既有的一处空格差异（第二部分第四章6.3，抽取器不按坐标补空格，非本次引入）。
- 现有 patent 快照没有调用 `law_verify` 的这 3 节；本次默认判定变化由 `tool.spec.ts` 与 `verify.spec.ts` 的随包资产用例覆盖，因此未重录快照。

### 覆盖边界

- 只转录了 3 节；对照表其余改动、2026 新增节与可能的节号改号尚未纳入。`sections` 仍是 2023 基础文本，不能据此声称整个索引已更新到 2026 版。
- `law_verify` 工具没有暴露 `revision` 参数，默认使用最新覆盖；需要按 2023 年文本核验的调用方使用库 API 的 `VerifyOptions.revision`。
- 2026 文本按对照表颜色标记转录，未与 2026 年合订全文逐字复核；对照表本身是官方修改说明，不是合订本。
