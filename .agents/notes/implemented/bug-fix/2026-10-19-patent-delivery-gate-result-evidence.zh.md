# Agent Note: 专利交付门禁核对结果证据

Status: implemented

[English](2026-10-19-patent-delivery-gate-result-evidence.md) | 中文

## Problem

交付门禁原先只记录某个前置工具在本会话成功返回过。`rule_check` 与 `law_verify` 接受空白文本，返回 `blocked: false`，并留下这条记录；`patent_workflow_run` 对任意 manifest id 都返回成功结果。因此模型可以空调用 `rule_check`、`law_verify`，再跑一个无关 manifest，就满足 `render_patent_document(template=oa-response)` 的前置，persona 的交付纪律在本该被强制的调用上仍只是提示词。

改动前实测：`createRuleCheckTool().execute({ text: '' })` 返回 `{ blocked: false, scope: 'patent', violations: 0 }`；`createLawVerifyTool(...).execute({ text: '' })` 返回 `{ blocked: false, findings: 0, unrecognized: 0 }`；预置的收口条目接受任意成功的 `patent_workflow_run`。

## Decision

`rule_check` 以 `invalid_tool_input` 拒绝空白 `text`；`law_verify` 在未提供 references 时以 `no_input` 拒绝空白 `text`。两条错误都说明该调用不能作为交付前置证据。

`deliveryGate` 条目可声明 `evidence`，按前置工具名分组：每个条件给出该工具规范结果的一个顶层字段，以及可接受的精确值（`equals`）或数组最小长度（`minItems`）。`tools/post-execute` 只提取声明过的字段并随台账记录保存；`deliveryGateMissing` 按条目核对。记录缺少声明字段或取值不符时，该前置仍算缺失，拒绝理由点名字段与期望值。证据声明挂在条目未 require 的工具上会在加载期失败，因为该条件永远不会被读取。

`patent` 预置给两个交付工具都声明了证据：`rule_check.evaluated` 必须非空。引用型模板另要求 `law_verify.findings` 非空。每条收口声明写明模板对应的 manifest（`patent_patentability_v1`、`patent_novelty_v1`、`patent_oa_response_v1`、`patent_invalidation_v1`、`patent_reexamination_v1`、`patent_infringement_v1`、`patent_disclosure_v1`），并要求 `ok: true`；`search-report` 与 `search-report-form` 接受可专利性或新颖性 manifest。申请文件、表格、补正与评价报告在没有法条引用或 manifest 通路的场景下不进入引用与 manifest 条件。

## Alternatives considered

- **只在工具层拒绝空白输入。** 能堵住零字节调用，但 `patent_workflow_run` 仍接受任意 manifest，`law_verify` 没有识别到引用也仍算一次法条核验。
- **由 `patent-rule` 判定各工具的结论。** 否决：门禁将需要了解三个工具的结果语义，倒置能力缝，并把正常发现变成永久拦截。
- **比较 `rule_check` 摘要与渲染 draft。** 本次否决：draft 是结构化 JSON，而 `rule_check` 接收散文，合法运行也可能只检查交付件的一部分。门禁现已记录身份；要与制品比对，需要渲染入参目前不提供的声明式比较。
- **把预置的 manifest 映射写死在插件里。** 否决：哪个模板欠哪个 manifest 是部署政策，证据声明把它和其余门禁声明一起留在预置中。

## Consequences

- 空的 `rule_check` / `law_verify` 调用不再产生前置记录，`render_patent_document(template=oa-response)` 只接受成功的 `patent_oa_response_v1` 收口。
- 部署新增模板通路时必须在预置中声明 manifest；没有该条目时模板保持只核对前置调用的旧行为。
- 停在人工确认门的 `patent_workflow_run` 仍返回 `ok: true`，审批门语义不变；未知 manifest 或校验失败返回 `ok: false`，不再满足收口条目。
- 台账只保留声明过的结果字段，不保留完整结果；在调用记录之后新增的证据字段不会出现在旧记录里，该前置必须重跑。
