# @deepseek-ai/dsh-patent-workflow

[English](README.md) | 中文

专利执行管线（`ctx.patentWorkflow`）的 Service Definition：声明式工作流执行器、灵活计划层与 plantask 人机协作状态机，移植自 Sati。服务把持久的 `patent/plantask` 与 `patent/workflow-run` 事件写入调用代理的会话日志，并经可选的 `ctx.approval` 接缝解决 plantask 审批。

## 服务

`PatentWorkflow` 服务暴露管线入口，并从本包根导出再导出纯管线 API（workflow、workflow-dag、workflow-store、flexible-plan、flexible-plan-store、plantask、worker-contract、approval、output-gate、quality-gate）。

### runWorkflow(manifest, ctx, executor?, options?, agent?)

经移植的执行器运行工作流 manifest，并在传入 agent 时把 `patent/workflow-run` 事件写入 `agent.session`。阶段声明 atom 或回退到 `executor`；审批门 `InterruptStageError` 暂停运行并返回 `interrupted` 而非失败，宿主以 `options.approvalGrants` 重跑续接。

### runPlantask(agent, caseId, planSteps, options?)

驱动 plantask 计划经过 planning → awaiting_approval → executing。awaiting_approval 门经 `ctx.get('approval')` 解决；无审批服务时计划 fail-closed（replanning）而非自动放行。`options.autoApprove: false` 让计划停在 awaiting_approval 等待带外决策。

### approve(caseId) / reject(caseId, feedback?)

针对停在 awaiting_approval 的 plantask 的决策入口：`approve` 续接至 executing，`reject` 带反馈回退至 replanning。以 `caseId` 为键；无匹配的挂起 plantask 时抛错。

## 审批接线

Sati 的 `approval_pending` 事件加 `approvalDecide` 命令映射为 `approval/request` 瀑布（`ctx.approval.request(req)`）。plantask 的 awaiting_approval 状态即一次未决审批请求；`allowed-once` 为 approve（续接），`rejected`/`cancelled`/`unavailable` 为 reject（replanning 并回退阶段）。审批是经 `ctx.get('approval')` 读取的可选接缝，故本包对 dsh-user-approval 无编译期依赖。

## 配置

服务无 cordis.yml `Config` schema；`runPlantask` 取逐调用选项。

| 方法 | 键 | 默认 | 含义 |
| --- | --- | --- | --- |
| `runPlantask` | `autoApprove` | `true` | 为 false 时让计划挂起，等待带外 `approve`/`reject`。 |
| `runPlantask` | `approvalReason` | （无） | 传给审批答案者的人类可读理由。 |

## Model Experience

None, as the pipeline executes work for the tool layer; tool schemas, results, and approval prompts are owned by dsh-patent-tools and the interaction seam.

#### KV Cache effect

Independent; the pipeline registers no prompt, tool schema, or result of its own.

## 已知局限与延期工作

- **规则引擎运行时注入（P4.1）** — 输出门的 `ruleGate` 接缝结构化接受 dsh-patent-rule 的 `RuleOutputGate`，但引擎在运行时注入；本包对 dsh-patent-rule 无编译期依赖，需要引擎的规则检查在未注入时 fail-loud。
- **存储经 `ctx.get('storage')` 可选** — 文件产物（workflow-run 与 flexible-plan 存储）使用调用方提供的 `JsonFileStore` 后端；服务不接线 storage-domain 接缝，ctx.storage 集成延期。
- **无答案者时审批 fail-closed** — 无审批服务挂载（或未组合答案者）时，`runPlantask` 拒绝计划转至 replanning 而非自动放行。
