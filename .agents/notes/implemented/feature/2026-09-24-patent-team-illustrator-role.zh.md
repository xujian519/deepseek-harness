# Agent Note：专利团队新增制图员角色，主责附图与附图标记表

Status: implemented

[English](2026-09-24-patent-team-illustrator-role.md) | 中文

## Problem

附图在真实专利团队作业中占比很高，却没有归属岗位。部署案件语料里 21 个团队共 313 个任务，其中 122 个（39%）涉及附图，15 个团队至少有一个附图任务，`patent-team-起垄器附图评审` 整支团队只为附图评审而建。但 13 个角色的目录里没有人负责附图：`formal-examiner` 的职责描述写着"附图清晰度"而背后没有实现，没有任何 worker 的 `allowedTools` 列出附图五工具，`patent-quality-gate` 检查清单也没有附图条目。标号回填与图面自检由案件内的临时 Python 脚本承担（`_fig_check.py`、`_leader_map.py`），产物不进索引、不可复查；归档团队里已出现名为 `figchecker` 的成员，却只能注册在不相关的 `technical-expert` 角色下。

## Decision

角色目录新增**制图员**（`illustrator`，立场 `neutral`），其 worker 为 `patent-illustrator`（tier `work`），注册于 `packages/patent/patent-workflow/src/role-contracts.ts` 与 `worker-contract.ts`：

- 硬性输出契约 `${caseOutputsDir('{caseId}')}/figure-deliverable.md`，必含字段 `附图文件` / `附图标记表` / `图文一致性` / `形式要件核验`，使组合质量门禁按与其他 worker 相同的方式验收附图产出。
- `allowedTools` 列出 `generate_patent_figure`、`generate_structure_figure`、`add_patent_figure_references`、`analyze_patent_figure`、`search_patent_figure`、`validate_specification` 以及 `read` / `write`；越界禁止为不改实体结论（权利要求布局、保护范围、修改方案）、不评新颖性/创造性、不代任一立场起草策略内容；`triggersHITL` 为 true。
- 该角色是附图标记表的唯一权威源，负责《专利法实施细则》第二十一条第二款在图面、标记表与说明书之间的双向一致。
- `patent-team-composition` 增加角色总表行，并在撰写包（t4a，位于说明书草稿之后、对立评审之前）、答复审查意见包（t3a，位于修改方案确认之后）、补正包（t2a）、复审包（t2a）插入附图任务；各包规模变为 7 / 7 / 4 / 7，仍在 `maxMembers` 8 之内。无效宣告包与侵权诉讼包不纳入制图员，因为这两类场景的附图是比对与解释权利要求的材料而非产出物；确需重绘图面时由 captain 在成员上限内按需增补 `illustrator`。
- `patent-quality-gate` 增加第 6 项「附图与标号」：附图标记表在场且与图面、说明书、权利要求逐号一致；图号位于附图正下方；图面除必需词语外无注释；色彩与落版尺寸符合目标法域；禁止用临时脚本代替附图工具。
- `patent_teams_add_member` 的 role 描述改为从 `defaultRoleContracts()` 派生，不再在工具文本里重复角色清单。
- 成员 persona 的角色段落渲染该角色的工具清单（`workerTools`），与立场、必含交付、越界禁止、HITL 并列，因此包括制图员在内的每个成员都能看到自己角色拥有哪些工具。`allowedTools` 仍无强制点，该清单是告知而非限制。

本变更延续 [2026-08-19-patent-team-composition-roles](2026-08-19-patent-team-composition-roles.zh.md) 与 [2026-09-04-patent-team-document-specialist](2026-09-04-patent-team-document-specialist.zh.md)；附图能力类记录 [2026-08-28](2026-08-28-patent-figure-generation.zh.md)、[2026-08-30](2026-08-30-patent-figure-vision-path.zh.md)、[2026-08-31](2026-08-31-patent-figure-rendering-pipeline.zh.md)、[2026-09-21](2026-09-21-patent-drawing-office-profiles-and-vector-figures.zh.md) 仍然现行有效。

## Alternatives considered

**只加 worker 契约、不注册角色。** 否决：未注册角色就没有 role contract，成员 persona 不携带立场、必含交付、越界禁止与 HITL 标记，`patent_teams_status` 也不显示 `role_contract`。真实团队已经在借用这个岗位：captain、撰写员、技术专家、形式审查员都执行过附图任务，这正是具名 owner 要消除的。

**只在 SKILL 里写角色。** 与文档专员当初的否决理由相同：纯文本既到不了 persona，也进不了门禁。

**把制图员纳入无效宣告包与侵权诉讼包。** 否决：诉讼包在可选技术调查官之前就已达到成员上限，且这两类场景的附图是证据与权利要求解释材料，不是需要产出的交付物。

**在同一次变更里强制 `allowedTools`。** 推迟。该字段是声明性元数据，没有运行时消费者；现存的唯一限制通道是 `request.toolFilter.deny`，用于对成员隐藏队长专属团队工具。按 worker 强制工具白名单会改变全部 16 个 worker 的运行时行为，需要单独界定范围。该清单经成员 persona 的角色段落到达成员，路由纪律由组建技能、门禁条目与 captain 撰写的任务描述承担；任何超出清单的工具调用都不会被拒绝。

## Consequences

- `role-contracts.spec` 与 `worker-contract.spec` 断言 14 角色、16 worker，并覆盖新角色的立场、交付字段、worker 与必含字段。
- `pnpm run gen-tool-catalog` 会重写 `docs/tool-catalog.md`，因为 `patent_teams_add_member` 的 role 描述改为派生；`docs/tool-catalog.zh.md` 承载同一段 schema 文本，已随双语配对重新记录。
- 质量门禁检查清单由十项增至十一项。
- 该角色买到的是此前靠即兴发挥维持的一致性：标记的唯一权威源、双向一致核验、形式要件核验，以及进入附图索引而非留在案件脚本里的结果；买不到的是图面内容质量本身——图面质量判定与仅支持栅格图的附图分析仍是未决缺口，矢量图型的标号分配见 [2026-09-21](2026-09-21-patent-drawing-office-profiles-and-vector-figures.zh.md)，且文档渲染器仍无附图页与图片嵌入，交付的申请文件只能把附图以渲染文档之外的方式随附。
