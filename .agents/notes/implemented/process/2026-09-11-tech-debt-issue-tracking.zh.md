# Agent Note: tech-debt tracking in same-repository Issues

Status: implemented

[English](2026-09-11-tech-debt-issue-tracking.md) | 中文

## Problem

`docs/TECH_DEBT.md` 曾是已知债务的唯一载体,且没有任何东西把台账条目与一个 PR 能关闭的工作绑定起来。台账还在无声漂移:它 2026-08-17 的行数、小工具收敛的「0 剩余」结论、hygiene 门禁的状态,都已与代码树不符,后续工作因此按错误前提推进。一项没有 tracker 身份的债务,对「每个非机械改动都必须引用同仓 Issue」的逐 PR 规则是不可见的。

## Decision

- **台账持有一列跟踪信息,Issue 持有工作本身。** `docs/TECH_DEBT.md` 保留严重度、证据与理由;同仓 Issue 负责范围、优先级与关闭。仍开放的台账条目点名它的 Issue,已收敛的条目就地标注为收敛,不再以开放的样子留着。
- **全仓扫描是刷新机制,其清单是证据之家。** 2026-09-11 扫描写入 `.agents/audits/2026-09-11-tech-debt-issue-manifest.md`,内含扫描方法、门禁基线、每条拟建 Issue 一行及其 `file:line` 证据、完整 Issue 正文,以及「不建 Issue」清单。清单作为历史记录留在仓库;台账仍是当前状态的事实源。
- **Issue 按主题聚合,而非逐 TODO。** 一条 Issue 覆盖一个可独立评审的修复,因此单个 PR 可以关闭它。同根因而散布在多个调用点的问题,落成一条带调用点清单的 Issue,而不是许多只有一行的 Issue。
- **发现只在扫描代理的结论被回源复核后才立案。** 每条候选都由立案的会话对照 `file:line` 验证;被证伪的候选连同理由记进清单的「不建 Issue」一节,使同一条误报不会在下一次扫描被重新提出。
- **台账记录 tracker 自身的边界。** 该 fork 无法写入 Project 的 Status 与 Priority(缺 `read:project` scope;Project 属上游组织),也无法通过可用 API 指定原生 Issue Type,因此优先级落在每条 Issue 正文首行、分类落在 `area/*` 标签。清单连证据一并声明这两项限制。
- **仅靠扫描发现、且没有单个 PR 能关闭的条目保持只登记在台账。** 台账 L5 一节承载的低危余项继续只做台账登记而不建 Issue,因为一条横跨互不相关修复的滚总 Issue 永远无法被单个 PR 关闭;台账明确写出这一点,而不是把遗漏留在暗处。

## Alternatives considered

- **每个 TODO 或每条 lint 抑制各建一条 Issue。** 否决:仓库有 26 处闭合联合缺 `assertNever`、63 处静默 `.catch(() => {})`,逐行建 Issue 会产出一个没人能分诊的 tracker,同时掩盖共同根因。
- **只把台账当 tracker。** 否决:台账不可查询、没有开闭生命周期、也无法被 PR 关闭,债务条目会悄然活得比解决它的工作更久。
- **把扫描代理报告的全部候选直接立案,不回源复核。** 否决:扫描至少产出四类误报,包括代码明确记录为有意的 never-produced 联合成员,以及实为「文档化的 duplicate-install-safe 分层」的所谓重复包。
- **在 fork 上另开 Project 镜像 Status,而不是记录该限制。** 否决:这会造成第二个与上游 Project 意见相左的状态权威,而缺同一个 scope 的 fork 也无法让镜像保持最新。
- **删掉台账,让 Issue 承载全部历史。** 否决:台账承载收敛记录、有意权衡与严重度理由,这些属于代码历史,而非一个会关闭的 tracker。

## Consequences

债务现在可查询、可按 PR 关闭,台账也不能再声称它并不具备的收敛:本次扫描就地更正了 M1 的收敛结论、M6 的行数表与 M8 关于 `settingsNamespace` 的描述。代价是多了一件需要保持最新的产物——清单是带日期的快照,不得为跟踪进度而编辑;台账那一行必须在 Issue 开闭时随之移动。两项治理字段在本 fork 上仍不可写,因此优先级与类型在 Issue 正文与标签之间重复,直到 Project 可写;读者不应当把缺失的 Project 状态读成「未定优先级」。

## Testing

扫描的门禁基线为本地实测:typecheck、lint、duplication 与 `test:docs` 通过,hygiene 仅在 `verify-package-dependencies` 上失败,单测报告 3 例失败——其中两例对负载敏感、一例是本机 DNS 环境产物。台账与清单编辑后用 `pnpm run test:docs` 重跑了文档门禁。
