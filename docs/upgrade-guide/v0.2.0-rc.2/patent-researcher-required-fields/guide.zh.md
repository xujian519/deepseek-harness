---
kind: upgrade-guide
description: "patent-search-commander 的检索报告在 检索式、对比文件、公开日 之外新增 命名族清单 与 正交维度 两项必填字段；缺任一项的报告退回 in_progress，不再直接完成。"
---

# 检索员的检索报告必须声明命名族清单与正交维度

[English](guide.md) | 中文

## 变更

`patent-search-commander` 的 `search-report.md` 输出契约（`data/cases/<caseId>/outputs/`）新增两项必填字段：

```
requiredFields: ['检索式', '对比文件', '公开日', '命名族清单', '正交维度']
```

`runQualityGate()` 在 `completed` 转换处执行 `validateWorkerOutput()`，按子串匹配逐项校验报告。在开启 `qualityGate` 的部署里（随包发布的 `patent` 预设已开启），报告缺少任一新字段的检索任务不再能完成：它以 `missingHardFields` 点名 `命名族清单` 和/或 `正交维度`，退回 `in_progress`。保持默认 `qualityGate: false` 的部署不跑该检查。已经声明这两项的报告不受影响。

`researcher` 角色的交付说明同步取自同一列表——`workerDeliverables('researcher')` 现在读作 `检索式、对比文件、公开日、命名族清单、正交维度`，`patent-team-composition` 的角色总表列出同样的交付物。

这两项强制的是声明，不是判断：声明的词族集合是否穷尽，仍由红队或人工裁定。门禁去掉的是静默遗漏——此前只从发明方案自身权利要求用语推导检索式、或完全没有跑 IPC/CPC、申请人、引证维度的报告也能满足契约。

## 迁移

1. 只写了旧三项字段的报告会在下一次 `completed` 转换被拒，续跑与重跑的任务同样如此。补一节 `命名族清单`，逐个被检索的功能列出中文在先文献所用的至少三个不同成词族；补一节 `正交维度`，写明实际跑过的维度：IPC/CPC、申请人反查、引证或同族扩展、非专利文献。
2. `search-commander` 技能载有六条锚点规则与三个权利要求形式问题；起草报告前加载它即可产出这两节。
3. 确认：把一次检索任务跑到完成，检查报告含这两节标题，且任务到达 `completed` 而非退回 `in_progress`。
