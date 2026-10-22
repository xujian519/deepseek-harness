---
kind: upgrade-guide
description: "专利 manifest 现在先定位争议再解析，并记录每次回退；law_search 命中带时点效力状态。"
---

# 专利争议定位、回退留痕与法规时点效力

[English](guide.md) | 中文

## 变更

六个必须分析 manifest（`patent_novelty_v1`、`patent_inventiveness_v1`、`patent_oa_response_v1`、`patent_invalidation_v1`、`patent_reexamination_v1`、`patent_infringement_v1`）与可选 `patent_patentability_v1` 现在以确定性的 `dispute-framing` 阶段开头，并在 `time_baseline`（没有时间基准的 manifest 则在 `grounds`/`parse`）之后运行 `dispute-framing-refine`。`patent_disclosure_v1` 保持 22 个阶段。两个原子由 `registerBuiltinAtoms()` 注册；它们不调用模型，模型阶段预算不变。

`WorkflowRunResult` 新增可选的 `revisions` 与 `revisionsTruncated`。文本或结构化回退信号现在会追加 `RevisionRecord`（缺口编号、回退目标、前后产出摘要、原因、结果），不再把回退留在隐式状态。阶段可返回 `_revision_signals: RetrySignal[]` 请求结构化回退；在阶段上声明 `retry.whenRevisionRequested: true` 才会消费；即使阶段没有文本产出，结构化信号也能触发回退。`legal-gaps` 为每个未评估项发出信号，并把目标清单留在 `state.revision_targets` 供回退后的提取阶段读取；`revision_coverage` 是可选审计信息，缺失或格式不符不会丢弃已成功的提取结果。

`before` 与 `after` 都描述回退目标阶段：被替换产出与重做后产出的摘要。仅当调用方给 `runWorkflow` 或 `rollbackStage` 注入 `now` 时才写 `at`；不注入时钟时持久化结果保持确定性。回退不得跨过审批门：manifest 校验会拒绝这种配置，避免修改后的产出复用旧放行。`patent_disclosure_v1` 因此把 `review_gate` 放在 `legal_gaps` 之后。

`law_search` 命中新增 `validity`（`in-force`、`expired`、`not-yet-effective` 或 `unverified`），工具新增 `asOf`（YYYY-MM-DD）按历史时点判定效力。`KnowledgeLawSearch` 在应用 `limit` 之前过滤已废止与尚未生效的记录；缺少 `valid_from`/`valid_to`/`expired` 列的记录标为 `unverified` 并默认返回（`includeUnverified: false` 时排除）。格式非法或日历越界的日期按 `unverified` 处理，不当成在效。`installKnowledgeDb` 补可空的 `valid_from`、`valid_to`、`validity_source` 列，不写入「未废止」默认值；存量记录在回填前保持 `unverified`。

## 迁移

1. 传给 `patent_workflow` 的逐阶段 outputs 需补 `dispute-framing` 与 `dispute-framing-refine`。缺失阶段仍标记降级，原本 complete 的 recap 现在会报 `completed: false`。
2. 若断言了内置 manifest 的阶段数或 `consumes` 数组，同步更新。新阶段数：新颖性 14、创造性 16、可专利性 14、OA 答复 10、无效 11、复审 11、侵权 8、披露 22。
3. 需要审计轨迹时读取 `revisions`，不要从阶段输出文本反推是否发生回退。`before`/`after` 是 16 位摘要，日志上限 64 条，超出时 `revisionsTruncated: true`。
4. 依赖命中形状的 `law_search` 消费方需接受 `validity` 与 `asOf`。需要按历史时点检索的调用方传 `asOf`；格式非法的日期会以 `invalid_tool_input` 拒绝。
5. 依赖严格效力过滤前，先回填 `knowledge.db` 的 `valid_from`/`valid_to`/`expired`。`installKnowledgeDb` 只补列，无法推断施行日或失效日。
6. 把审批门移出 retry 的回退范围。retry 跨过审批门的 manifest 现在会在加载时校验失败；披露工作流的 `review_gate` 因此放在最后。
7. 验证：用旧版 OA 八个阶段 outputs 调 `patent_workflow`，应看到两个新阶段降级；用十个阶段调用应得到 `completed: true`。
