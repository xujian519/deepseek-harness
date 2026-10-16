#!/usr/bin/env bash
#
# File the 2026-10-16 office-action response (答复审查意见) domain review as
# 18 GitHub issues on the fork remote.
#
# Idempotent: an issue whose exact title already exists in any state is skipped,
# so the script can be re-run after a partial failure. Requires `gh` authenticated
# against the target repository.
#
#   bash .agents/audits/2026-10-16-oa-response-file-issues.sh
#
# The bodies are quoted heredocs, so backticks and `$` inside them stay literal.
set -euo pipefail

REPO=xujian519/deepseek-harness

printf 'reading existing titles from %s ...\n' "$REPO"
existing=$(gh issue list --repo "$REPO" --state all --limit 1000 --json title --jq '.[].title')

file_issue() {
  local title=$1 labels=$2
  if grep -Fxq -- "$title" <<<"$existing"; then
    printf 'skip    %s\n' "$title"
    return 0
  fi
  gh issue create --repo "$REPO" --title "$title" --label "$labels" --body-file -
  printf 'created %s\n' "$title"
}

file_issue "答复审查意见审阅（2026-10-16）· 甲1：在途重构的收尾与一致性（三层骨架 + guidance + 决策记录）" \
  "area/patent,kind/techdebt" <<'BODY'
P0 | 类型：Task | 来源：2026-10-16 答复审查意见域审阅（议题 甲1/18）

## 现状

在途的「事实 → 规则 → 论证」重构已完成收尾，待落地：

- **8 文件重构**（235+/127−）：bundle `patent-oa-response/SKILL.md`、模板 `oa-response/SKILL.md`、`assets/template.html`、`example.html`、`references/{conventions,checklist}.md`、`src/document/draftSchema/generic.ts`、`tests/tool.spec.ts`。
- **guidance 同步**（2 文件）：`patent-workflow/src/workflow/manifests.ts:274-275` 由「逐条答复每项被驳权利要求」改为三层骨架 + 争点分节 + F/P/R 编号 + 八节输出顺序；`tests/manifest-guidance.spec.ts` 钉住新纪律与旧句缺席。
- **决策记录**：`.agents/notes/implemented/architecture/2026-10-16-oa-response-fact-rule-argument.md`（+ `.zh.md` / `.i18n.yaml`）。

**关闭条件 = 改动经提交/PR 落地。**

## 证据

- `pnpm exec vitest run packages/patent/patent-workflow packages/patent/patent-document`：38 文件 / 499 例全过；定向 3 文件 / 69 例（manifest-guidance / tool / draft-schema-conformance）全过。
- `pnpm run test:snapshot -t patent-oa`：2 例（patent-oa-response / patent-oa-chain）通过；被改文本在快照零命中（未被 expected 钉住）。
- `pnpm run typecheck`：5 门全过。
- `verify-agent-note-format`（604 note 合规）、`verify-translation-pairing`（1336 对一致）通过；`test:docs` 仅 `verify-repository-references` 一项失败——既有的全历史克隆伪影（与改动无关）。

## 建议

- [ ] 整理为一次提交，按仓库惯例走独立分支 + PR。
- [ ] 提交信息写清：三层论证改造 + workflow guidance 同步 + 决策记录。

## 验收

- 工作树干净；PR 打开且相关检查通过后关闭本条。

## 关联

- `2026-10-16-oa-response-fact-rule-argument.md`；前因 `2026-10-10-patent-documents-single-channel.md`；试点（议题 丁1）。
BODY

file_issue "答复审查意见审阅（2026-10-16）· 甲2：parse→claim-chart 流转与 oa-response 专属语义" \
  "area/patent,kind/feature" <<'BODY'
P1 | 类型：Task | 来源：2026-10-16 答复审查意见域审阅（议题 甲2/18）

## 现状

`patent_oa_response_v1` 的 parse 与 claim-chart 两阶段之间没有数据流：

- parse 产出的引用文献（7 类驳回理由 + 引用文献清单）不自动进入 claim-chart；`chartTargets` 只能由调用方手工构造，快照从未传过。
- `claim_chart_build(mode='oa-response')` 无专属语义：与侵权/复审共用 mapping-machine，仅 chartId 与提示词标签不同。
- 结果：OA 链上的「被攻击权项 × 引用文献」对应关系（答复的论证基座）在工具层不落数据，只靠提示词与人工。

## 证据

- 原子 `patent-core/src/atoms/handlers/builtin/chart.ts:34`；`CHART_MODES :42` 含 `'oa-response'`；`chartId=chart-${mode}` `:325`；提示词仅 `场景模式：${mode}` `:301`。
- `patent-core/src/claim-chart/runtime/mapping-machine.ts:24` `validateRowMapping` 仅区分 prior-art 与 doe；gap-detector 与 mode 无关。
- 快照 `snapshots/session/patent-oa-chain/`：8 处 `patent_workflow_run` 调用无一携带 `chartTargets`（claim-chart 落「只拆要素」路径）。
- 优化计划 OPT-B4（`.dsh-work/patent-papers/优化计划-专利域.md:190`）已把「修订接地」落点定在 `mapping-machine.ts:24-33`。

## 建议

- [ ] 打通 parse → claim-chart 的确定性数据流（manifest 阶段接线或工具 schema/提示层约定）。
- [ ] 定义 oa-response 模式专属语义：被攻击权项与引用文献的对应关系检查 + 修订接地约束（OPT-B4 的 `groundingAlignment` / `revisionLocality`，按案内 Δ 报告）。
- [ ] 快照补一条携带 `chartTargets` 的真实流转（与议题 丙3 合并验收）。

## 裁决点

- 数据流接在哪层（manifest vs 工具约定）？
- OPT-B4 指标是否首版就进；离线评测与交付链路边界如何划（论文教训：随机检索探针不进交付链路）。

## 验收

- 一条「通知书引用文献 → claim-chart 目标列表」的端到端用例；快照中可见非空 `chartTargets`。

## 关联

- 议题 甲8（OPT-B4）、丙3（快照）。
BODY

file_issue "答复审查意见审阅（2026-10-16）· 甲3：答复策略骨架的接线或归因（strategy/plan 零消费者）" \
  "area/patent,kind/cleanup" <<'BODY'
P1 | 类型：Decision | 来源：2026-10-16 答复审查意见域审阅（议题 甲3/18）

## 现状

答复策略骨架在代码里存在、在链上缺席：`response/{strategy,plan,reexamination}.ts` 三个模块无生产消费者（仅测试与 index 再导出）。策略四选一与计划结构只活在提示词里，没有任何执行点读取代码中的策略表——代码与作业纪律两套载体，且代码侧从未被验证贴合实际使用。

## 证据

- `patent-core/src/response/strategy.ts:52/:70/:87/:103`（四张闭集表）；`plan.ts:99` `buildResponsePlan`（结构 `:78-91`、gap 类型 `:64-75`）；`reexamination.ts:194` `buildReexaminationPreparation`。
- 消费核实：仅 `patent-core/tests/response/{plan,strategy,reexamination}.spec.ts`（三路侦察 2026-10-16）。
- 对照：同源的 `notice/office-action.ts` 有原子与工具消费；response 模块停在库态。

## 建议（二选一）

- [ ] A. 接线：把 `buildResponsePlan` 的 gap 清单接进 OA 链（如 draft 阶段输入），与三层骨架对齐。
- [ ] B. 归因：按 `2026-10-03-patent-zero-call-tool-attribution.md` 的形态记录「无生产消费者及保留理由」，或删除。

## 裁决点

- 策略骨架是「待接线的确定性资产」还是「提示词纪律的过时副本」。

## 验收

- A：draft 输入/产物出现结构化策略或计划字段并有测试钉住。
- B：归因记录落盘，或删除后无残留导出。

## 关联

- 议题 甲2（同属 parse 下游）；`2026-10-03-patent-zero-call-tool-attribution.md`。
BODY

file_issue "答复审查意见审阅（2026-10-16）· 甲4：manifest 路径规则门 checkSection 恒空的定位与处置" \
  "area/patent,kind/feature" <<'BODY'
P1 | 类型：Decision | 来源：2026-10-16 答复审查意见域审阅（议题 甲4/18）

## 现状

`patent_workflow_run` 的 manifest 路径把确定性规则检查段整体丢弃：运行产物的 `checkSection` 恒为空。这是移植 Sati 的有意偏离（规则引擎由 `@deepseek-ai/dsh-patent-rule` 承担），但接缝未闭环——既无自己的检查段，也未声明补位者与时机。相邻事实：`patent-rule` 的 `structuralGate`（pre-execute）部署 0 条目。

## 证据

- `patent-tools/src/tool/patent-workflow-run.ts:7-11` 头注释：manifest 路径 rule-gate 段被移除、`checkSection` 渲染为空；graph 路径保留 `rule_gate` 节点。
- `patent-workflow-run.ts:215` `checkSection: ''`；`internal/workflow-helpers.ts:231/:245`（空段渲染）；`patent-flexible-plan.ts:311` 同为空。
- `patent-rule/src/index.ts:371-377` `structuralGate`；`Config.structuralGate` 默认 `[]`，preset 无声明。
- OPT-A2（优化计划 :146）拟启用 structuralGate；PO-011 状态「未实施」。

## 建议

- [ ] 三选一：A. 把 manifest 路径的检查段接到 patent-rule 的确定性运行（workflow 节点或 pre-execute）；B. 保持移除，但把「谁在何时补位」写进注释与技能；C. 删除空段载体。
- [ ] 与 OPT-A2 合并考虑：同属「确定性检查挂在哪」的决策。

## 裁决点

- manifest 路径要不要有确定性检查段；若有，挂点选 workflow 节点还是结构门。

## 验收

- 决议落盘；注释/文档与实现一致；选 A 时有一条拒绝负例。

## 关联

- 议题 甲7（规则强度）、甲8（OPT-A2/B5 挂点）。
BODY

file_issue "答复审查意见审阅（2026-10-16）· 甲5：approval→渲染→交付闭环的验收补齐" \
  "area/patent,kind/testing" <<'BODY'
P1 | 类型：Task | 来源：2026-10-16 答复审查意见域审阅（议题 甲5/18）

## 现状

交付前置门禁已覆盖 oa-response 场景，但验收面没有「approval 放行 → 渲染 → 交付」的完整闭环：快照止步于各阶段边界（run 落盘 / 审批放行），交付组合未被端到端钉住。两条既有语义待复核：门槛按「成功调用」而非「通过裁决」放行；ledger 不跨 resume。

## 证据

- `packages/bundle/web-app/presets/patent.patch.yml:358-404`：`render_patent_document` requires `[rule_check, law_verify, matter_log_append]`（:384-385）；whenArgs 模板含 oa-response 另 require `[patent_workflow_run]`（:392-404）。
- 快照：`patent-oa-response`（解析 + run + 占位号拒绝）、`patent-oa-chain`（整链 + approval 放行）——均无审批后渲染交付的组合。
- `2026-10-03-patent-delivery-gate-enforces-gate-runs.md`：自述「成功调用≠通过裁决」「ledger 不跨 resume」。

## 建议

- [ ] 补快照场景：approval 放行后 `render_patent_document`（template=oa-response）出件成功；缺 `patent_workflow_run` 时被拒的负例。
- [ ] 复核「成功调用即满足」对 OA 场景是否应收紧为裁决结果。

## 裁决点

- 是否维持「成功调用」语义；若收紧，影响面界定。

## 验收

- 新快照通过；负例断言拒绝原因点名缺失前置项。

## 关联

- 议题 丙3（同批快照）、丁2（端到端）；`2026-10-03-patent-delivery-gate-enforces-gate-runs.md`。
BODY

file_issue "答复审查意见审阅（2026-10-16）· 甲6：worker 契约（patent-oa-writer）与 manifest 链的关系核实" \
  "area/patent,kind/techdebt" <<'BODY'
P2 | 类型：Task | 来源：2026-10-16 答复审查意见域审阅（议题 甲6/18）

## 现状

worker/角色契约层存在 `patent-oa-writer` 角色（tier 'work'），但 manifest 执行链与它是两条并行面：manifest 全程无 worker 引用。OA 链实际由 `patent_workflow_run`（原子阶段）执行；worker 契约由团队组装/校验路径消费。需要一次关系核实并写成口径。

## 证据

- `patent-workflow/src/worker-contract.ts:335-348` `patent-oa-writer`：tier 'work'、allowedTools `['read','write','patent_eval']`、输出 `${caseOutputsDir('{caseId}')}/oa-response.md`、requiredFields `['意见陈述','修改对照']`、triggersHITL true；`:350-363` `quality_checker`。
- 消费者：`role-contracts.ts:194/:240`（role 映射）、`patent-tools/src/tool/patent-worker-validate.ts:13/:68`；role 'drafter' 承接 `role-contracts.ts:65-72`。
- `manifests.ts` 无 worker 引用（三路侦察 2026-10-16）。

## 建议

- [ ] 落一句口径 + 锚点：如「OA 链 = 确定性 manifest；patent-oa-writer = 团队模式人工派工」。
- [ ] 若确认应接线：定义派发点（approval 之后/交付之前），与议题 甲5 一并设计。

## 裁决点

- 保持并行（口径化）还是接线（纳入 OA 链）？

## 关联

- `2026-09-21-patent-workflow-closure-required.md`；`patent-team-composition` 技能。
BODY

file_issue "答复审查意见审阅（2026-10-16）· 甲7：OA 规则强度设计（warn-only vs 结构门/交付 requires）" \
  "area/patent,kind/feature" <<'BODY'
P1 | 类型：Decision | 来源：2026-10-16 答复审查意见域审阅（议题 甲7/18）

## 现状

OA 专属规则（3 条）当前只经显式 `rule_check(scope='patent-oa-response')` 自检，且全部 `action: warn`；输出门禁默认只取 `keyword_blocklist` 一类判据。与「交付门已对 render 设前置」的范式不对齐：规则存在，但生产链上是否执行取决于模型自觉。

## 证据

- `patent-rule/assets/rules/patent/oa-response-form.yaml`（96 行）：PR-OA-005（禁止计数式论证，major）、PR-OA-006（quote_repetition，minor）、PR-OA-007（26.3 判准落位，major）；文件头写明「只作用于 rule_check 显式自检…不进输出门禁」；来源为 2026-09-30 案件评审（会话 dsh-session-d5c70bfc）。
- `patent-rule/src/index.ts`：`DEFAULT_GATE_TOOL_NAMES :195-200`；`gateCheckTypes` 默认仅 `keyword_blocklist`；`structuralGate :371-377`（部署 0 条目）；`deliveryGate :381-390`。
- 契约测试：`patent-rule/tests/patent-full-rule-set.spec.ts:341-351` 断言三条 PR-OA 加载且不进 gate。
- 相关计划：OPT-A1/A2/A4（A 组）与 B5 均涉及强度与挂点。

## 建议

- [ ] 定 OA 规则强度表：保持 warn / 进结构门 / 进交付 requires / 仅离线评测，各给理由。
- [ ] 若维持 warn-only：写明补偿措施（OPT-A3 的 warn 回灌已落地），避免「有规则无执行点」。

## 裁决点

- 首个进门的 OA 规则是哪条、挂哪个门。

## 验收

- 强度表落盘（note 或规则文件头）；新增门禁参与时有负例。

## 关联

- 议题 甲4（结构门挂点）、甲8（B5 先决）。
BODY

file_issue "答复审查意见审阅（2026-10-16）· 甲8：已登记待办推进次序（OPT-B4/B5/B6；新规则编号避让）" \
  "area/patent,kind/feature" <<'BODY'
P1 | 类型：Task | 来源：2026-10-16 答复审查意见域审阅（议题 甲8/18）

## 现状

优化计划 B 组三条待实施，互有先决，需要排定推进次序：

- **B4 修订接地**（:190）：落点 `mapping-machine.ts:24-33`，与议题 甲2 重叠；须按案内 Δ 报告（论文教训：N=10 → +0.84，N=300 → −0.12，符号反转）。
- **B5 法条/理由双向覆盖**（:196）：`rule_check` 收双输入 + 新规则；计划文本编号 `PR-OA-007` **与现有规则撞号**（应避让，从 PR-OA-008 起）；属 pre-execute 侧，挂点未定。
- **B6 解析冲突显式化**（:202）：`ParsedOfficeAction.parseConflicts`；需同步两个技能与工具 schema。

## 证据

- 优化计划 `.dsh-work/patent-papers/优化计划-专利域.md`：B4 `:190`、B5 `:196`、B6 `:202`、B7 `:208`。
- 现状核对（records 侦察 §4）：B4/B5/B6「待实施」；B7（测量协议预注册）未见。
- 撞号：`oa-response-form.yaml` 已有 PR-OA-007（26.3 判准落位）。

## 建议

- [ ] 定批次：Batch 1 = B6（低风险）+ B4（与 甲2 合并设计）；Batch 2 = B5（先决：pre-execute 挂点，与 甲7 联动）。
- [ ] 新规则编号从 PR-OA-008 起；B5 计划文本同步改号。
- [ ] B4 的指标口径先写成验收条件（案内 Δ、离线评测与交付边界）再实现。

## 裁决点

- 批次顺序；B4 是否与 甲2 合并为一个交付；B5 挂点共决。

## 验收

- 三条各有状态（实施/归因/延后+理由）；编号无冲突。

## 关联

- 议题 甲2、甲4、甲7；patent-oas 的 oa-answer 观测节点。
BODY

file_issue "答复审查意见审阅（2026-10-16）· 甲9：答复期限的提醒/日程联动（载体已就位但未接线）" \
  "area/patent,kind/feature" <<'BODY'
P2 | 类型：Decision | 来源：2026-10-16 答复审查意见域审阅（议题 甲9/18）

## 现状

期限计算已就位，提醒未接线：

- `patent_deadlines` 工具给出月数与起算口径（首通 4 个月 / 后续 2 个月），persona 与技能都要求「一律用它、不口算」。
- `tool-schedule` 插件已挂载，preset 注释明确「答复期限提醒、年费到期提醒都靠它落成持久排程」。
- 但 OA 链上没有一处创建排程：技能只写「取期限」，manifest 无期限节点，未观察到 schedule 调用。提醒停留在载体注释与意图里。

## 证据

- `patent-deadline/src/statutes.ts:621-637`（oa-response-first / subsequent）；`patent-deadline/src/tool/patent-deadlines.ts`；技能 `skills/patent/patent-oa-response/SKILL.md:12`。
- `presets/patent.patch.yml:65`（persona 期限纪律）、`:130-133`（tool-schedule 行与注释）；`manifests.ts` 无 deadline 引用。
- 说明：10-12 评审（#420）曾记录专利 preset 缺 tool-schedule——该行其后已补齐，本议题是**联动**缺口，不是挂载缺口。

## 建议

- [ ] 三选一：A. 技能/链上加入「取期限 → 建提醒」（含提前量与责任人）；B. 工作台看板输出期限；C. 明确不做，归因记录。
- [ ] 若 A：定义提醒对象（团队模式下谁收）与提前量默认值。

## 裁决点

- 提醒机制载体与强度；是否进本轮改造预算。

## 验收

- 选定路径落盘；若 A，有从通知书到提醒的可见流转。

## 关联

- `2026-10-03-patent-deadline-service.md`；议题 丁1（试点期限体验）。
BODY

file_issue "答复审查意见审阅（2026-10-16）· 乙1：doc-template 三个 oa-response 影子副本的处置" \
  "area/patent,area/document,kind/cleanup" <<'BODY'
P2 | 类型：Decision | 来源：2026-10-16 答复审查意见域审阅（议题 乙1/18）

## 现状

`doc-template` 仍有一套三个 OA 答复变量替换模板（clarity-amendment / inventiveness-defense / novelty-defense），与 `patent-document` 的 oa-response 受控草稿主题重叠。它们只在 document preset 通道可达；未声明 `vars`（占位进 residual 列表）；10-10 单一内容通道决策的负控制只防同名——这三个不同名，未触发。

## 证据

- `packages/document/doc-template/assets/templates/oa-response/{clarity-amendment,inventiveness-defense,novelty-defense}.md`（70/62/57 行）。
- 通道内仍被引用：`doc-template/tests/assets.spec.ts:24`（oa-response 类别恰 3 个）；`render-doc-template.ts:24-40`；挂载 `document.patch.yml:169-170`。
- 不可达性：patent preset / patent.md 零命中 doc-template；负控制 `patent-preset.spec.ts:395-411` 仅防同名。
- 前例：10-10 删除的 5 个为同名资产（含 `oa-response-sati`）。

## 建议

- [ ] 三选一：A. 删除；B. 保留但声明文档模式专用 + README 注明与专利通道关系；C. 保留并补变量声明与测试。
- [ ] 同步定调：跨体系守卫是否从「防同名」升级为「防主题重叠」。

## 裁决点

- 两套体系并存是设计还是遗留；单一内容通道决策的适用范围是否含文档模式。

## 关联

- `2026-10-10-patent-documents-single-channel.md`；议题 乙3。
BODY

file_issue "答复审查意见审阅（2026-10-16）· 乙2：OA 文档债（模板 README 陈旧、design 时代错位、subsystems 缺行）" \
  "area/patent,area/docs,kind/doc" <<'BODY'
P2 | 类型：Task | 来源：2026-10-16 答复审查意见域审阅（议题 乙2/18）

## 现状

三处文档债：

1. `packages/patent/patent-document/assets/templates/patent/README.md` 陈旧：清单 7/11；仍写手工复制 template.html 的旧流程；引用 5 个不存在的路径。
2. `docs/patent-mode-design.md` 时代错位（「Phase 2 视需要新写」「docx」）。
3. `docs/subsystems/patent.md` 无 OA 专属行。

## 证据

- README：`:36-41` 旧手工流程；`:67-75` 缺 rectification-response / re-examination-request / infringement-opinion / litigation-pleading；`:81-84` 引用 `assets/prompts/patent/`、`assets/workflows/patent/`、`skills/patent-agent/`、`src/patent/claim-chart/`、`products/_example/`——均不存在。
- `docs/patent-mode-design.md:313/:371`；`docs/subsystems/patent.md` 无 OA 行（workflow 侦察 §7）。
- 门禁：`test:docs`/`doc-sync` 覆盖这些文件。

## 建议

- [ ] README 更新到 11/11 + 受控草稿流程 + 删失效引用。
- [ ] `patent-mode-design.md` 加「已落地」注记或标注为历史文档。
- [ ] `subsystems/patent.md` 增 OA 工作流行。

## 验收

- 相关文档门通过；README 清单与磁盘一致。

## 关联

- 议题 乙3/乙4；`docs/AGENTS.md`。
BODY

file_issue "答复审查意见审阅（2026-10-16）· 乙3：模板结构设计（必填槽 vs 争点组织、example 无锁、编号无防线）" \
  "area/patent,kind/techdebt" <<'BODY'
P2 | 类型：Decision | 来源：2026-10-16 答复审查意见域审阅（议题 乙3/18）

## 现状

模板结构层三个待决点：

1. **必填槽 vs 争点组织张力**：`argument-novelty`/`argument-inventiveness` 皆必填，单争点案件只能写 filler；26.3/26.4 争点只能进可选的 `argument-other`。
2. **example.html 无机器锁**：通用 8 模板的 example 都不在字节锁内（锁只覆盖两个表单模板）。
3. **标题编号无防线**：template.html h2「一~八」重排靠人工核对，无测试断言。

## 证据

- `generic.ts:154-155`（两个 argument 必填）；`example.html:201-204`（「未涉及新颖性异议…不再展开」filler）。
- `template-draft-converter.spec.ts:67-73`（字节锁仅表单模板）。
- 在途实例：模板 h2 全量重编号仅静态核对（无门）。

## 建议

- [ ] 裁定必填策略：filler 句（现状）vs 二选一必填（schema 允许对侧缺省）——注意与 `validateTemplateDraft` 校验联动。
- [ ] example 加覆盖度静态断言（槽位 id 集合），不追求字节锁。
- [ ] 加 h2 顺序断言（顺带锁八节结构）。

## 裁决点

- 必填语义改不改（影响 schema/模板/文档/快照链）；锁的强度。

## 验收

- 决议落盘；若改动，spec 有反例。

## 关联

- 议题 乙4、乙1；`2026-10-16-oa-response-fact-rule-argument.md`。
BODY

file_issue "答复审查意见审阅（2026-10-16）· 乙4：引用与口径的单一事实源（100012/100014、指南节号、仓外库）" \
  "area/patent,area/docs,kind/techdebt" <<'BODY'
P1 | 类型：Task | 来源：2026-10-16 答复审查意见域审阅（议题 乙4/18）

## 现状

两条跨体系口径靠多处人工维护：

1. **100012/100014 载体口径 4 处**：conventions §8、模板 SKILL、bundle SKILL 必查清单、checklist；另有仓外 `~/.dsh/patent-ops/templates/cnipa-标准表格/`（README 与答复正文骨架 10-16 04:32 更新，晚于仓内 03:39-03:40，同步靠人工）。
2. **指南节号 2 处独立维护**：conventions 与 writing-patterns `07-oa-clarity-support.yaml`（后者条号未核验）。

## 证据

- 4 处：`conventions.md:64-72`、模板 `SKILL.md:61`、bundle `SKILL.md:16`、`checklist.md:37`。
- 节号：`conventions.md:40`；`07-oa-clarity-support.yaml:14`。
- 仓外库：8 族表格 + `tools/`（doc 侦察 §9）。

## 建议

- [ ] 定单一事实源（建议 conventions 为正文源），其余改引用句；加一致性对账测试（照 `patent-eval` ABSOLUTE_PHRASES↔PAT-ABS-001 范式）。
- [ ] 指南节号集中登记（patent-law 索引或专用登记）；`07-oa-clarity-support.yaml` 先核验。
- [ ] 定义仓外库与仓内口径的对账动作。

## 裁决点

- 事实源选层；测试强度（静态断言 vs 人工核验记录）。

## 验收

- 单侧改动致对账测试失败；仓外库有对账记录。

## 关联

- 议题 乙1/乙3；patent-law 索引纪律。
BODY

file_issue "答复审查意见审阅（2026-10-16）· 丙1：账本载体（PO 账本缺位，重建或新载体）" \
  "area/patent,kind/techdebt" <<'BODY'
P2 | 类型：Decision | 来源：2026-10-16 答复审查意见域审阅（议题 丙1/18）

## 现状

PO 账本载体缺位：`.dsh-work/patent-papers/` 下三个脚本仍指向 `.dsh/reports/patent-optimization/issues.csv`，该目录在本机不存在。结果：PO-001…PO-009 内容与状态不可得；PO-010…PO-017 只能从优化计划正文旁证。账本是对标链的登记面，缺位使后续批次无处登记。

## 证据

- 脚本引用：`update-ledger.py:6`、`append-ledger.py:6`、`extract-samples.py:14`；`.gitignore:49`。
- 负结果：`.dsh/reports/patent-optimization/` 不存在（ls/find 已查候选路径）。
- PO-010…017 状态旁证可见 2026-10-16 审阅底账；PO-001…009 不可得。

## 建议

- [ ] 二选一：A. 重建账本（重建目录或迁入 `.dsh-work/patent-papers/` 单一登记文件），PO-001…009 标「不可得」、PO-010…017 补录；B. 弃用旧账本，以优化计划正文为唯一登记（文件头写明）。
- [ ] 同步更新三个脚本目标路径。

## 裁决点

- 账本是否仍是工作流一环；若是，载体与写者是谁。

## 关联

- 优化计划；议题 丙2。
BODY

file_issue "答复审查意见审阅（2026-10-16）· 丙2：OA 评测规划（oa-answer case 的统计、成本与多轮扩展）" \
  "area/patent,kind/testing" <<'BODY'
P2 | 类型：Task | 来源：2026-10-16 答复审查意见域审阅（议题 丙2/18）

## 现状

patent-oas 的 `oa-answer` case 现状：每 case 1 次运行（runsPerCase: 1）、无方差/成本字段；维度 5 拆 `prior-art-search:8 + deliverable-format:7`；无检索模拟（检索只在 rubric 文字里要求）。做「优化前后对比」时缺统计与成本口径——不足以支撑 B4/B5 的验收。

## 证据

- `packages/self-evolve/self-evolve-benchmark/examples/patent-oas/problem-space.yaml` + `cases/oa-answer/`；基线 `packages/self-evolve/evaluation/patent-oas-baseline.json`（runsPerCase: 1，2026-10-10）。
- 入口 `scripts/patent-oas-*.ts`；门 `2026-09-26-patent-oas-problem-space-gate.md`（基线 97.95）。
- 规划材料：`.dsh-work/patent-papers/notes/P1-自进化评测体系现状.md`（4 case × 1 run = 24 次调用/轮）。
- 优化计划 B7（:208）「测量协议预注册」与本题同源。

## 建议

- [ ] 写测量协议：样本量/功效/判定阈值先注册（B7 落点）。
- [ ] 最小升级：runsPerCase>1 + tokens/cost 汇总字段。
- [ ] oa-answer 增观测节点（B4 验收落点）。

## 裁决点

- 升级规模（最小可复算 vs 完整统计）；是否本轮做。

## 关联

- 议题 甲8（B4/B7）、丙1（登记面）。
BODY

file_issue "答复审查意见审阅（2026-10-16）· 丙3：快照覆盖补齐（chartTargets、draft 质量、approval 后交付）" \
  "area/patent,kind/testing" <<'BODY'
P1 | 类型：Task | 来源：2026-10-16 答复审查意见域审阅（议题 丙3/18）

## 现状

快照矩阵四个缺口：

1. `chartTargets` 真实流转（oa-chain 从未传，claim-chart 落「只拆要素」）；
2. draft 内容质量（无按新槽位出草案的快照）；
3. approval 后交付闭环（放行 → render oa-response → 交付；见 甲5）；
4. claim-chart 的 oa-response 模式（快照仅侵权模式）。

## 证据

- `snapshots/session/patent-oa-response/`（3 步任务，止于门禁拒绝）；`patent-oa-chain`（整链 + approveStageIds，8 处 run，无 chartTargets）；`patent-claim-chart`（仅侵权模式）。
- 在途改造下游：conformance/单测通过，快照未动。
- 纪律：`snapshots/AGENTS.md`。

## 建议

- [ ] 补场景（建议 2 → 3 先行；1 与 甲2 合并；4 视 claim-chart 语义裁定）。
- [ ] 每场景写明断言面（调用流/workspace 产物/拒绝与放行路径）。

## 裁决点

- 四条缺口取舍与顺序；draft 质量快照的判定口径。

## 验收

- 新场景 keyless 通过；缺口清单收敛。

## 关联

- 议题 甲2、甲5、丁2。
BODY

file_issue "答复审查意见审阅（2026-10-16）· 丁1：弹簧案试点的结论回灌与试点纪律" \
  "area/patent,kind/feature" <<'BODY'
P1 | 类型：Task | 来源：2026-10-16 答复审查意见域审阅（议题 丁1/18）

## 现状

弹簧案试点部分回灌完成（三层骨架、形式缺陷单列、100012/100014 口径即来自它），未完成：

1. 结论的系统化回灌清单（进模板/技能/规则 vs 案件特例）。
2. 试点纪律：该试点未进案卷日志（无 `_matter-log.md`/登记表），「试点 → 留档」路径未走通。

## 证据

- 试点目录 `patent-workspace/200310105524.9-弹簧-意见陈述书试点/`（4 文件，2026-10-16 03:38–04:33）。
- 无 `_matter-log.md`/登记表；`CN2026-0904-01` 未进入 OA 阶段（`05-答复/` 空）。
- 回灌已发生部分 = 在途改动（同批工作树）。

## 建议

- [ ] 出「试点 → 资产」对照清单（结论句 / 去处 / 状态），剩余逐条落盘。
- [ ] 给试点补登记行，或注明「试点不立案」的例外口径——必须显式。
- [ ] 定义试点纪律：产物至少含对照清单 + 归档位置。

## 裁决点

- 试点是否纳入留档纪律；对照清单落点。

## 关联

- `2026-10-16-oa-response-fact-rule-argument.md`（现行试点）。
BODY

file_issue "答复审查意见审阅（2026-10-16）· 丁2：端到端实战验收（真实案件全链跑通）" \
  "area/patent,kind/testing" <<'BODY'
P1 | 类型：Task | 来源：2026-10-16 答复审查意见域审阅（议题 丁2/18）

## 现状

审阅的最终验收证据未定义：18 项的落地效果需一次真实案件全链跑通来回答（parse → claim-chart → draft → approval → render → 交付），并以观测面留痕。现状：真实案件文本在仓外/客户材料，快照用合成案件；端到端从未以真实案件跑过完整交付组合。

## 证据

- 可得性：`patent-oa-response`（run 落盘 + 门禁拒绝）、`patent-oa-chain`（approval 放行）——止于各自边界。
- 案件材料：弹簧案试点（10-16）；`CN2026-0904-01`（未进入 OA）。
- 观测面：仓外 `~/.dsh/patent-ops/` 周报 + 仓内 `patent-oa-*` 快照。

## 建议

- [ ] 定验收协议：真实案件全链（含 render 所内复核稿 + 官方表格转录），记录调用流/产物/门禁触发/人审时长。
- [ ] 与 丙3 联动：合成案件补快照、真实案件做实战，互证。
- [ ] 定义「跑通」判定：必须有（run 4/4、render 成功、rule_check 裁决、matter_log 留痕）/ 可缺（PDF 失败降级等）。

## 裁决点

- 实战验收排期与案件选择（复用弹簧案 vs 新案）。

## 验收

- 端到端记录 + 观测面留痕；暴露问题回灌为议题或修复。

## 关联

- 议题 丙3、丁1、甲5。
BODY

printf '\ndone. rerun this script any time; an existing title is skipped.\n'
