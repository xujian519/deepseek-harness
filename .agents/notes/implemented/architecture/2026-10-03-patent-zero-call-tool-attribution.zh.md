# Agent Note: 专利域零调用工具逐一定性并修正路由

Status: implemented

[English](2026-10-03-patent-zero-call-tool-attribution.md) | 中文

## Problem

2026-10-03 的专利域数据轴清算（窗口 2026-09-06..2026-10-02，91 个提供专利工具集的会话，与 2026-09-21 基线等长）记录了 11 个零调用的专利域工具：`add_patent_figure_references`、`evaluate_evidence`、`generate_structure_figure`、`flexible_plan`、`patent_plan_task`、`patent_workflow_run`、`recognize_chemical_structure`、`search_patent_figure`、`patent_teams_remove_member`、`paper_download`、`paper_list_sources`。

零调用本身不构成结论：同一种日志形态同时覆盖「场景未出现」「路由从未到达模型」「该活已由别的机制承担」三种情况。部署侧记录此前已给其中 7 个「保留」结论而调用数没有变化，说明缺的不是结论，而是结论的证据。

其中两条既有归因是错的，且会误导下一个读者。`evaluate_evidence` 被写成「保留：EVI-011 守卫在后台自动运行，模型无需主动调用」——该守卫是只针对这个工具名注册的工具调用守卫（[evidenceComplianceGuards.ts](../../../../packages/patent/patent-rule/src/guard/evidenceComplianceGuards.ts)），所以零调用等于守卫零覆盖，而不是后台已覆盖。`add_patent_figure_references` 被写成说明书撰写的必经步骤，而 `generate_patent_figure` 已经把 `labels[]` 入参里的标号内嵌进图面——按「必经」读，模型被指向一次并不需要的调用，真正成立的场景（外部自绘 SVG 需要补标号）反倒没有写。

## Decision

11 个工具各取一个结论，证据随结论列出。

**进路由，修正触发文本** —— 改动落在 persona（`packages/bundle/web-app/presets/patent.patch.yml`）与重复了同一触发语义的三个交付技能（`patent-document-polish`、`patent-team-composition`、`patent-quality-gate`）：

- `add_patent_figure_references` —— 只对自绘或外部来源的 SVG 路由；persona 与技能都写明这一点，并写明不要对 `generate_patent_figure` 的产物重复标注。`patent-document-polish` 此前还把它描述成"补齐说明书的附图标记"，而它做的是给图面标注，不是改说明书。
- `search_patent_figure` —— 对说明书撰写路由，并写明索引位置：案件工作目录下的 `.sati/figures-index.json`，由 `analyze_patent_figure` 写入，因此换一个案件目录索引即为空。
- `evaluate_evidence` —— 对进入审查意见答复、无效或复审的证据路由。persona 把这次调用写成证据进意见前的必经一步，并写明跳过的代价；守卫机制本身不进提示词——模型的活是判证据，不是了解判定是怎么接线的。

**保留，场景未出现** —— 可达，且本窗口内该场景没有发生：

- `generate_structure_figure` —— 已设 `structureFigureEnabled: true`，且本机 FreeCAD 探测通过（`/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd`，FreeCAD 1.1.3）。窗口内没有 STEP/IGES/BREP 案件。
- `flexible_plan` —— 为没有内置 manifest 入口的外观设计无效 A23 理由表路由。窗口内没有此类案件。

**保留，已有决策覆盖** —— `patent_workflow_run` 由[收口必经的 Agent Note](2026-09-21-patent-workflow-closure-required.zh.md) 承担，[交付前置门禁那篇](2026-10-03-patent-delivery-gate-enforces-gate-runs.zh.md) 现已对分析类模板强制该 run；`recognize_chemical_structure` 按构造即不可用，其移植流水线缺失，description 已如实说明。

**不进路由** —— 保留在工具集内，但有意不出现在 persona 中：

- `patent_plan_task` —— 这个无状态的计划状态机与计划模式加 `todo_write` 重复，且没有任何场景点名它。
- `patent_teams_remove_member` —— 团队以 `patent_teams_delete` 与归档收尾；逐成员移除不是作业会走的路径。
- `paper_download`、`paper_list_sources` —— 文献作业走 `web_search`；窗口内 `paper_search` 只有 1 次调用，两个下游工具为 0。

## Alternatives considered

- **删除不进路由的工具。** 否决：它们属于移植过来的专利工具集，删除其中一个是产品面改动，本批证据不足以强制它。稀释成本改记在 Consequences 下。
- **只修数字，不动归因。** 否决：错误的理由比缺失的理由活得更久，而这里有两条是错的。
- **不改文本，改为对 `evaluate_evidence` 强制。** 本批不做：交付路径是文档渲染而不是状态迁移，强制需要跨调用的证据状态。[收口必经的 Agent Note](2026-09-21-patent-workflow-closure-required.zh.md) 对收口否决过同一形态。[交付前置门禁那篇](2026-10-03-patent-delivery-gate-enforces-gate-runs.zh.md) 把这套机制落地了，同时让 `evaluate_evidence` 继续走路由：门禁能观察到某次调用发生过，观察不到「正在引用证据」。
- **要求每幅起草的图都调用 `add_patent_figure_references`。** 否决：`generate_patent_figure` 已内嵌标号，强制调用只会多出一遍没有产物的重复标注。

## Consequences

- 下一等长窗口可逐条检验结论：在修正后的触发文本下 `add_patent_figure_references` 或 `search_patent_figure` 仍为 0，说明触发文本还是错的；`evaluate_evidence` 仍为 0，说明证据形式缺陷继续不被检查地进入交付件。
- 有四个工具留在模型的工具面上却没有路由，工具面因此长于路由集。后续清算轮应把这份稀释成本与删除代价放在一起计价。
- 部署台账 `~/.dsh/patent-ops/README.md`、persona 与技能载有同一批修正后的结论；台账不在版本控制内，可引用的记录是本 Note。
