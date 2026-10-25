# Agent Note: Measuring the OA workflow surface through the product executor

Status: implemented

[English](2026-10-25-patent-oas-workflow-surface-measurement.md) | 中文

## Problem

`patent-oas` 的每一轮采集都是一次 `headless` 提示词调用,分数描述的是「模型 + 作业规范」。产品已经实现的那两面审查意见实务——`patent_oa_response_v1` 的阶段(要素映射、答复计划、对立模型、撰写、换位复核、检查)与 `_matter-log.md` 的取代链——落在测量之外:阶段交接出错、或修订根本没有取代上一版权项,与一次干净的运行得分相同。

把这两面纳入测量有两条约束。第一,评测器不能变成第二套工作流实现:自己排阶段的评测器测的是自己的排阶段,而 manifest 已经是该案型的定义。第二,已提交的 `headless` 基线要保持可读,而且它的数字不能拿工作流采集来判,因为两者测的不是同一件事。

## Decision

**每轮一个执行者进程,经 `patent_workflow_run` 跑 manifest。** 运行器钉住 `manifestId`、`caseId` 与从 manifest 读出的审批门阶段 id,然后把本轮交给产品工具。阶段顺序、上游产出交接与 `requireAllSteps` 判定留在工作流引擎里。打分之前,运行器从 `data/cases/<caseId>/workflow-runs/` 读回落盘的运行记录,`completed` 为假即整次采集失败,降级或中断的工作流不能当作交付物被打分。

**manifest 与留档工具持有运行器使用的词汇。** `planRun` 的阶段清单、审批门阶段与交付物阶段都取自 `builtinPatentManifests`;交付物阶段是 manifest 里唯一不绑定原子的阶段——绑定原子的阶段确定性执行,因此那一个就是模型的撰写——数量不是 1 时计划直接失败,而不是猜。运行器用 patent-tools 的 `parseMatterEntries` 与 `MATTER_LOG_FILE` 读日志,条目文法因此只有一个家。见 [scripts/patent-oas-run-core.ts](../../../../scripts/patent-oas-run-core.ts)。

**每轮的权项版本从取代链复算。** `claimVersionOf` 返回该轮交付物产物在 `_matter-log.md` 取代链上的深度,`rounds[].claimVersions` 按运行顺序各记一条。每轮交付物另存新路径(`outputs/oa-response-r<N>.md`)、case id 按运行固定(`patent-oas-<case>-run<N>`),这正是 `matter_log_append` 对 `修订` 条目的要求。`validateRunRecord` 拒绝没有逐轮严格前进的链,两轮共用一套权项因此读作一次失败的修订,而不是一个被采纳的分数。

**被测面是采集层的一条轴,基线按被测面声明。** `RunRecord.execution` 取 `prompt` 或 `workflow`,`workflowId` 点名 manifest;一次采集只起一类进程,所以该字段与 `provider`、`modelId` 同级,而不是逐 case。`problem-space.yaml` 声明每个 case 可以在哪个 manifest 下采集,选中没有该声明的 case 做工作流采集在任何调用之前失败。`gate.yaml` 在 `baselines` 下按被测面各声明一条基线,`--accept` 与 `--run` 把记录路由到它自己那条基线文件。早于这条轴的记录省略 `execution`,读作 `prompt`:那时采集器只有提示词这一条路径,字段缺失恰好标识了被测面——这与 `retrieval` 的规则相反,那里未标注的记录两种设置都有可能。

**工作流的组合方式是经 overlay 在宿主平面挂 patent 工具行。** preset 是 agent 平面,只有 `dsh-agent-preset-registry` 能挂它;headless 组合既不装配该注册器,其运行器也会拒绝 preset 会话。`examples/patent-oas/patent-workflow.patch.yml` 因此插入 `@deepseek-ai/dsh-patent-tools`,与录制的 `patent-oa-response` 场景同一做法。shipped `patent` preset 的人设层与技能层留在本次测量之外。

**预算随被测面走。** 一轮工作流执行 12 个阶段,所以 `workflow` 下 `--runs` 缺省 1、`prompt` 下仍是 3;`--dry-run` 在任何调用之前打印每轮阶段数与阶段执行总数。

## Alternatives considered

**让评测器逐阶段各起一个进程。** 拒绝:评测器会重实现阶段排布与上游交接,而这正是本项要求留给 manifest 的边界;两轮采集还会按阶段数乘上 agent 进程数。逐阶段可观测由读回落盘的运行记录提供。

**像包内规格那样在进程内用模型端口跑 `patent_workflow_run`。** 拒绝:那测的是包调用,不是模型可见的工具面,而且会把 `matter_log_append` 挤出本次运行——它是执行者调用的工具,也是被测量的审计链的来源。

**挂载 shipped 的 `patent` agent preset。** 不可得:headless profile 既不装配 preset 注册器,也不允许 preset 会话。工具行已承载工作流与留档两面;preset 会额外带来人设与技能,而本项不给它们打分。

**照 `retrieval` 把 `execution` 做成逐 case 字段。** 拒绝:`retrieval` 是 case 材料本身的属性,一个 case 一个值够用,而同一 case 要在两种被测面下各测一次;做成逐 case 字段要么禁掉第二种被测面,要么按设置复制 case 映射。

**沿用单条基线并切换缺省被测面。** 拒绝:那会悄悄改写已提交的 `headless` 数字,而跨设置的门槛归因不了任何差异。

**采信执行者自报的权项版本。** 拒绝:产出交付物的同一个模型会顺带声明它是否取代了上一版,而这正是被检验的命题。

## Consequences

一次 `oa-answer` 的工作流采集是两轮共 14 次 agent 调用,外加每阶段在引擎内部的模型调用;这就是该设置缺省只跑一次的原因。审批门在运行前按阶段 id 放行,因此人工确认的交互不在测量之内——本基准打的是产物正文与其审计链,确认行为仍由别处覆盖。

提示词基线保持有效且不带标签;门禁只把它与 `prompt` 记录相比。第一条工作流基线只能由一次带 key 的采集记录,并在 `gate.yaml` 追加它自己的 `baselines` 条目。无 key 规格覆盖注入式的每轮接缝、产物契约、链深复算、跨设置拒绝与旧记录读取;真实模型在工作流设置下的行为要等那次采集落地才被验证,示例 README 如实写明。相关:[两轮 OA 评测](2026-10-21-patent-oas-two-round-evaluation.zh.md)与[专利评测测量协议](2026-10-16-patent-eval-measurement-protocol.zh.md)。
