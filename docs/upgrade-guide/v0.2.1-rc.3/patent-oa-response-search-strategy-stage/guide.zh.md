---
kind: upgrade-guide
description: "The office-action answer manifest gained a model-backed `generate_keywords` stage, so run records list 13 stages and recap callers must supply that stage's output."
---

# 审查意见答复现在带上检索策略

[English](guide.md) | 中文

## 变更

`patent_oa_response_v1` 在 `adversary-model` 与 `draft` 之间新增 `generate_keywords` 阶段。它跑既有的 `keywords` 原子——由模型执行、不发起网络调用——所以清单现在是 13 个阶段、4 个模型阶段（出厂预算仍是 24/12）。

`draft` 在 `consumes` 里点名该阶段，生成的关键词因此进入撰写；其指导同时要求「证据与引用」一节给出可执行的检索方案——覆盖上位、下位与同义词的关键词组、要用的 IPC/CPC 分类号、要检索的数据库，以及每组检索要判定什么——并禁止把没做过的检索写成已完成、禁止编造文献号与公开日。

该 manifest 的 `WorkflowRunResult` 记录因此多出这一阶段，摘要写作 `n/13`。`patent_workflow` 的 recap 模式只组装调用方交上来的产出：按阶段 id 给的 `outputs` 里没有 `generate_keywords` 时，该阶段按降级标记，与今天缺阶段的表现一致。

`packages/self-evolve/self-evolve-benchmark/examples/patent-oas/gate.yaml` 里的 `patent-oas` 门禁不再在工作流面豁免 `prior-art-search` 与 `deliverable-format`；`surfaces` 机制本身保留。

## 迁移

1. 用 `patent_workflow_run` 做审查意见答复的调用方不需要改参数——阶段定义来自清单。代价是每次运行多一次模型调用。核对落盘记录 `data/cases/<caseId>/workflow-runs/<caseKey>__patent_oa_response_v1.json`：`stages` 含 `generate_keywords`，`degradedSteps` 保持为空。
2. 自己拼装答复的 recap 调用方（`patent_workflow`）必须在 `outputs` 里补一条 `generate_keywords`，与原有的八个阶段并列，否则接受该阶段标记为降级。
3. 任何断言该 manifest 落盘记录的地方——阶段 id 列表、`n/12` 的摘要文本、逐轮阶段数——都改为 13 个阶段。`snapshots/session/patent-oa-response/` 与 `snapshots/session/patent-oa-chain/` 两份录制快照用 `pnpm run test:snapshot:record` 重录。
4. 升级后复核的答复书应当在「证据与引用」里带上检索方案。若某份交付物为没人做过的检索写出了文献号，那正是指导禁止的情形；按缺陷上报，不要把它当作凑章节的内容。
