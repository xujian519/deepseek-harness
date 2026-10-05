# Agent Note: 专利收口门禁覆盖撰写渲染

Status: implemented

[English](2026-10-05-patent-closure-gate-covers-drafting.md) | 中文

## Problem

[交付门禁那篇](2026-10-03-patent-delivery-gate-enforces-gate-runs.zh.md) 把 patent 预置的交付纪律变成了执行点：本会话未记下该纪律点名的闸门调用前，`render_patent_document` 一律被拒。它的收口条要求七个分析类模板先跑 `patent_workflow_run`，两种撰写形态都在外，记录的理由是「`rectification-response` 与 `claims-spec` 不跑 manifest，留在收口条之外」。

这条理由对补正成立，对撰写不成立。`patent_workflow_run` 随包八个 manifest，`patent_disclosure_v1`（它的默认值）末段就是权利要求草稿：PFE 提取、检索、逐特征新颖性、审查门、权利要求草稿——这是撰写通路，不是分析通路。随包的 `patent-team-composition` 技能正是这样写这项要求的：它的收口必经行把「撰写=patent_disclosure_v1」与分析类 manifest 并列，`patent-matter` 按案型重复了这份映射。于是收口纪律中属于撰写的那一半只活在 persona 与技能里——正是门禁要取代的那种安排——而且它就落在门禁自己的模板表里，那里的豁免读起来像一次有意的收窄，而不像一条从未接上的通路。

2026-10-03 起的窗口记录到 1 次 `patent_workflow_run` 调用，同时有 41 次 `render_patent_document`。

## Decision

预置的收口条在七个分析类模板之外列上 `claims-spec`；`rectification-response` 仍在外。这条分界沿用技能已经画出的那条：收口条覆盖每一个「纪律以一次 manifest 运行收尾」的交付模板，而补正是随包模板中唯一没有 manifest 入口的那个——技能为它用逐项替换页核验记录替代。

因此 `claims-spec` 渲染要求本会话成功跑过一次 `patent_workflow_run`，实际即 `patent_disclosure_v1`。persona 讲收口的那段陈述了扩大后的覆盖范围、并把补正留在其外，故提示词与实际强制一致。

## Alternatives considered

- **把 `rectification-response` 也纳入，且不为它造 manifest。** 否决：这会在渲染解锁前逼出一次与本案无关的运行——正是[收口必经那篇](2026-09-21-patent-workflow-closure-required.zh.md)对渲染守卫记下的那条反对意见，也是按模板收窄所化解的那一条。
- **新增 `patent_rectification_v1` manifest，让补正经它纳入。** 否决：它需要阶段设计、夹具与相应的技能改写才算有意义，而技能的替换页记录已经承担了这个案子。扩大覆盖并不足以支撑一个其阶段无人对照实务复核过的 manifest。
- **保持原声明不变，第三次加强 persona 措辞。** 否决：这项要求此前既在 persona 里、也在五个技能的收口行里，2026-10-03 窗口仍只记到 1 次收口调用。门禁取代的正是「写文本」这件工具。

## Consequences

- `claims-spec` 渲染不能再从一个没有收口记录的会话里出件。下一个等长窗口检验的就是这条扩大后的门禁在撰写上的效果——撰写没有其他收口要求可依赖。
- 台账以活动 agent 为键、不跨恢复保留，故交底书分析在更早会话里做过的案件，会在撰写前重跑一次 manifest。失败方向与既有的一致：多跑一次闸门，不是少跑。
- `scripts/preset-divergence-baseline.json` 重录 `persona` 行的 `patent.patch.yml` 哈希。`patent-rule` 行不属分歧行，故单改声明本身不进基线。
- [patent-rule 的 README](../../../../packages/patent/patent-rule/README.zh.md) 陈述收口条覆盖哪些模板，现在把 `claims-spec` 列在内、`rectification-response` 列在外。
- 无需重录任何 recorded-session 快照。没有快照钉住 persona 前缀或 `deliveryGate` 块；唯一含这些模板 id 的快照钉的是渲染器的工具 schema，其枚举本就列出全部九个模板。
