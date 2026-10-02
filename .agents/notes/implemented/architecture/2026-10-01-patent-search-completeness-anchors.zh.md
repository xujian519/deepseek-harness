# Agent Note: 专利检索报告必须声明命名族与正交维度

Status: implemented

[English](2026-10-01-patent-search-completeness-anchors.md) | 中文

## 问题

一件完成的检索任务可以在不声明检索锚点如何选定的情况下满足 `patent-search-commander` 的输出契约。该契约要求 `检索式`、`对比文件`、`公开日`，这绑定了一份报告的来源与日期，却对检索自身的用词是否穷尽不作要求。

代价可以量化。在 2026-UM-002 案中，六轮现有技术检索的每一条检索式都从发明自身的权利要求用词推出。红队改用同一功能的另一种叫法检索后，取回了六轮遗漏的两篇 2017 年文献，而该案五个入选方向最终各被单篇文献公开。六轮中没有任何一轮跑过 IPC 维度，尽管 worker 描述里已经写着 `先经 patent_analysis_report 做 IPC 分类并取得建议检索策略`——指令停留在散文里，而散文没有执行者。

门禁机制的两处性质决定了应在此契约上修复。`workerDeliverables()` 用同一份 `requiredFields` 派生角色的 `Required deliverables` 人设行，而 `runQualityGate()` 在 `completed` 状态转换处对同一份清单运行 `validateWorkerOutput()`，把未达标的提交退回 `in_progress`。因此一次声明同时告知成员应交付什么并在完成时强制它。

## 决策

`patent-search-commander.outputs[0].requiredFields` 在 `检索式`、`对比文件`、`公开日` 之外，要求 `命名族清单` 与 `正交维度`。检索任务只有在报告为每个检索的功能声明至少三个中文在先文献用它的不同成词族，并写明实际跑过哪些正交维度（IPC/CPC、申请人反查、引证或同族扩展、非专利文献）之后，才能到达 `completed`。`researcher` 角色描述写明同一顺序——先命名族与维度，再构造含 IPC 限定的布尔检索式。

这些字段强制的是声明而非判断。`validateWorkerOutput()` 做子串匹配，因此声明的成词族是否穷尽仍由红队或人工判定。门禁消除的是静默遗漏。

## 考虑过的替代方案

**只把纪律放进 `search-commander` 技能。** 它在技能里，并保留在那里，承载六条锚点纪律与三个权项形态问题。技能是建议性的：harness 只在模型调用 `skill` 工具时加载它，而在 2026-UM-002 案中，模型把该技能列在可用技能之中却没有加载。worker 描述里的 IPC 指令是同一失效在下一层的复现。

**改为校验输入契约。** `WorkerInputContract.contentSchema` 已声明、已文档化，而没有任何代码校验它；`WorkerRegistry.verify()` 同样没有生产调用方。输入侧前置条件需要一条新的校验通路与每个任务的调用点，比在既有门禁已经检查的字段上追加改动更大。

**要求结构化的锚点记录。** `requiredFields` 做子串匹配，没有解析器。结构化要求——成词族清单及其维度结果——需要自己的 schema 与校验通路。

## 测试

| 证据 | 行为 |
|---|---|
| [worker-contract.spec.ts](../../../../packages/patent/patent-workflow/tests/worker-contract.spec.ts) | 针对已发布契约：只带来源与日期的报告产出 `missingHardFields` `['命名族清单', '正交维度']`；声明了成词族与维度的报告校验通过。 |
| [role-contracts.spec.ts](../../../../packages/patent/patent-workflow/tests/role-contracts.spec.ts) | `workerDeliverables('researcher')` 连接这五个字段，因此人设行携带新的交付项。 |
| [service.spec.ts](../../../../packages/patent/patent-teams/tests/service.spec.ts) | 在 `qualityGate: true` 下，契约完整的提交被接纳，契约不完整的提交以 `契约缺字段` 被打回。 |

## 后果

- 只声明来源与日期的检索报告现在会被打回，直到它声明两个锚点。门禁在启用 `qualityGate` 处运行；默认值为 `false`。
- 字段是按子串匹配的中文字面量，因此报告须逐字使用这些章节名。改动章节标题即改动契约。
- `validateWorkerOutput()`、`runQualityGate()` 与 `workerDeliverables()` 未改动；本次修复是字段清单加角色描述。
- 门禁无法验证声明的成词族是否穷尽。声明记录检索了什么，并不证明其完备性。
