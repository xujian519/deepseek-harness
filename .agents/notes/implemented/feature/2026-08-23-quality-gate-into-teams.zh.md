# Agent Note: 将质量门禁接入团队任务完成

Status: implemented

[English](2026-08-23-quality-gate-into-teams.md) | 中文

## 问题

契约化团队任务（创建时指定 `worker`）完成时只有软验收：`update_task(completed)` 写一份 `contractValidation` 结论并追加 `patent-teams/task-validated` 事件，但从不拦截低质量提交。独立的 `patent_eval`（comprehensive 评分）与 `patent-rule` 输出门禁此前只接到工具路径，从未接入团队任务完成，因此成员可以不顾评分、契约字段缺失或规则命中，直接上报"已完成"。

## 决策

契约化任务完成时必须过组合质量门禁，否则**打回重做**：

- **触发条件**：`config.qualityGate === true`（默认 `false`，在 patent preset 的 `patent-teams` 行设 `true`）且任务带 `worker` 且调用以 `completed` + `output` 收口。这使无门禁的自由任务与非契约任务保持原路径。
- **组合门禁**：`validateWorkerOutput`（契约硬字段）、内容充分性（`evaluatePatentContent('comprehensive', …)` 的 `内容充分性` 维度）、以及（存在时）`patentRuleGate` 规则门禁（`ctx.get('patentRuleGate')` 返回 patent-rule 用于 `tools/post-execute` 的同一 `RuleOutputGate` 实例）。`comprehensive` 综合分仅作反馈提示（`config.passThreshold` 控制何时提示），不单独打回——其结构/流程维度会误伤不带章节的片段产物（这些已被 worker 契约约束）。
- **打回**：门禁未过则不放行 `completed`；任务保持 `in_progress`，写 `TaskGateFeedback`（score / failures / feedback），追加 `patent-teams/task-gated` 事件，`update_task` 返回 `gated: true` 与反馈，成员用同一 `attempt_id` 修订后重新提交。通过则沿用原逻辑（`contractValidation` + `task-validated`）。

## 备选方案

**按角色做硬白名单收缩（`toolFilter.allow`）。** 留作独立事项：它改变成员能力边界，需为每角色推导工具并集加团队生命周期工具；软门禁已在不动该爆炸半径的前提下提高验收线。

**让成员承接 `patent-workflow` manifest。** 更大工程，会重写团队任务模型；门禁是更窄的闭环改进。

## 后果

- `patent-teams` 新增依赖 `@deepseek-ai/dsh-patent-tools`（`evaluatePatentContent`）与 peer `@deepseek-ai/dsh-patent-core`（`RuleOutputGate` 类型）；`patent-rule` 把同一 `gate` 注册到 `ctx.patentRuleGate` 供复用。依赖单向，无环。
- `TeamTask` 增 `worker` / `contractValidation` / `gateFeedback`；新增 `patent-teams/task-gated` 事件。`patent_teams_status` 呈现角色契约摘要、worker 校验与门禁结论。
- 向后兼容：`qualityGate` 默认关，既有测试与非契约任务不变。patent preset 经 `config.qualityGate: true` 启用。
- 已知局限：反复打回无自动上限；持续不过由 captain 用 `reassign_task` 处理。门禁约束可机器校验的质量，不覆盖所有专业判断。
- 评审后门禁收紧到适用于单片段产物的维度（契约字段、内容充分性、规则违规）；`comprehensive` 综合分改为提示（`passThreshold`）而非硬阈值，修复了此前把每个不带章节、契约达标的提交都误拦到 `0.7` 以下的问题。
- 说明：两次会话间工作区被还原，接线与角色→契约层随本轮一并重建（patent-teams 挂载、`apps/cli` 依赖、catalog 钩子、SKILL 工具名）。

## 非归因失败（待对方窗口收尾）

全仓级门禁仍红，指向并发 `self-evolve` 窗口（`packages/test-support/self-evolve-eval`、`packages/host/apiproxy`、`packages/bundle/web-app` synapse 行）。本改动未触及任何一项，待对方窗口落地后重新验证，勿当作本轮回归：

- `verify-cordis-config` / `verify-config-catalog` / `verify-doc-graphs` / `verify-package-readme-model-experience` —— synapse / self-evolve 列表缺口。
- 全仓 `build` 与 `tsdown` 在本工作树无法完成：`dsh-root` 的 `lib/types/startup.js` 缺失（其 `tsc` 类型检查在 `self-evolve-eval` 处失败），导致跨包运行时导入解析到过期的 bundle `lib/index.js`；各包 `tsc -b` 与各包测试通过，组合门禁逻辑经 source-alias 的 vitest 配置验证。
