# Agent Note: 专利工作流收口保持必经，由 captain 的收口任务承担

Status: implemented

[English](2026-09-21-patent-workflow-closure-required.md) | 中文

## Problem

2026-09-21 对本部署专利会话的利用度审计（143 个会话、19,807 次工具调用，窗口 2026-08-26..2026-09-21）发现 `patent_workflow` 与 `patent_workflow_run` 在全部案件目录中零调用。preset 的 persona 与五个技能（`patent-novelty-inventiveness`、`patent-oa-response`、`patent-reexamination`、`patent-invalidity`、`patent-infringement`）都把按 manifest 收口写成结论定稿的方式，而这五个技能本身从未被加载。真正发生的组织工作走的是团队工具：3,105 次专利域调用中 2,432 次是 `patent_teams_*`。

这留下两种读法，后果相反：要么收口要求是随着它所引用的工具一起该退役的死文本，要么要求本身正确、而承载它的路径从未到达模型。仅凭用量无法区分：零调用工具配上必做指令，与配上过时指令，在调用日志里长得一模一样。

## Decision

收口保持必经，由团队路径承载：

- persona 写明：分析必须先用 `patent_workflow` / `patent_workflow_run` 收口才可进入文档交付，captain 的收口任务以 stage 记录作为交付依据。
- `patent-team-composition` 中每个场景在收口行点名其 manifest：`patent_patentability_v1`（立案）、`patent_disclosure_v1` 与 `patent_novelty_v1` / `patent_inventiveness_v1`（撰写）、`patent_oa_response_v1`（答复）、`patent_reexamination_v1`（复审）、`patent_invalidation_v1`（无效）、`patent_infringement_v1`（诉讼）。补正没有内置 manifest 入口，以替换页逐项核验清单替代 stage 记录，技能中已写明。
- 五个分析技能把收口保留为必做步骤；`patent-infringement` 的条件式措辞（"需要一次跑完时"）改为必做，与其余四个一致。

## Alternatives considered

- **认定工作流工具已被团队 DAG 取代并退役**——审计自己的首选建议。被产品负责人否决：stage 记录是数月后仍能复核分析的人工制品（哪个阶段跑了、输入是什么、结论是什么），而团队 DAG 记录的是派单与门禁，不是阶段产出。
- **保持文本不变，让技能承载要求。** 否决：五个技能点名了该要求却从未被加载，要求因此从未到达模型；只由"被加载的技能"承载的文本不是要求。
- **让工作流成为唯一收口，去掉 captain 的收口任务。** 否决：收口行同时是案件签收处（期限核验、产品负责人确认、移交文档交付），去掉它会连同门禁一起丢掉。
- **用工具级守卫强制收口（没有 run 就拒绝交付）。** 否决：专利域的交付路径是文档渲染，不是状态机迁移；阻止渲染会打断没有 manifest 入口的案件（补正），也会打断合法停在人工确认门的 run。

## Consequences

- 每类案件现在至少花一次工作流运行在收口上；停在人工确认门的案件必须带 `approveStageIds` 重新调用，persona 与技能都已写明。
- 审计的下一个等长窗口让这个决策可检验：`patent_workflow_run` 达到五次以上，说明要求到达了模型；若要求已同时写进 persona 与收口行而调用仍为零，说明要求又一次放错了位置，退役分支将以比本轮更好的证据重启。
- 团队 DAG 每个场景多一个必做步骤：跳过收口的 captain 会留下最后一行明显未完成的任务表，而不是一份悄悄看起来已完成的分析。
- 补正案件以清单替代 stage 记录，其审计链弱于其他案件类型；技能记录了这一原因，而没有虚构 manifest 入口。
