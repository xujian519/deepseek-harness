# Agent Note: 专利团队新增文档专员角色与场景模板

Status: implemented

[English](2026-09-04-patent-team-document-specialist.md) | 中文

## 问题

`patent-team-composition` 持久团队模板产出分析与起草内容，但没有对应的场景化正式交付物：各成员返回 markdown，而现有交付纪律（md 起草 → officecli docx，或 `render_patent_document` 渲染 html/pdf）是临时套用、没有指定负责人。`render_patent_document` 随包 5 个模板（patentability-opinion、search-report、oa-response、claims-spec、invalidation-opinion）覆盖不到补正、复审与诉讼场景；团队内也没有角色承担矫正（术语、法条引用格式、数字/日期/期限、编号、称谓）与美化（模板、品牌、A4 版式）。

## 决策

团队新增**文档专员**角色（`document-specialist`，立场 `neutral`，角色目录 12 → 13）：

> 扩展 [2026-08-19-patent-team-composition-roles.zh.md](2026-08-19-patent-team-composition-roles.zh.md)：七个场景包结构不变，新增文档专员成员与一个收口位任务。

- 注册于 `packages/patent/patent-workflow/src/role-contracts.ts`，worker 为 `patent-document-renderer`（tier `work`，允许 `read_file` / `write_file` / `render_patent_document`，硬性输出契约 `交付场景 / 矫正清单 / 渲染产物`，`triggersHITL`，越界禁止：不改实体结论、不代任一立场起草）。worker 注册表与 `patent_teams_status` 的 role_contract 自动生效；`patent_teams_add_member` 的 role 描述已列出。
- `patent-team-composition` SKILL 增加角色总表行，七个场景包均加文档专员，并在各包最后一个质量核验任务之后、captain 收口之前插入「正式文档输出」任务。包规模仍在 `maxMembers` 8 内（诉讼 7 + 可选技术调查官 8）。
- 新预设技能 `patent-document-polish` 承载交付纪律：场景→模板映射、矫正清单（术语、法条引用格式与出处、数字/日期/期限用工具计算、编号层级、称谓）、美化清单（模板选择、品牌注入、A4、md 起草 → html/pdf 或 docx）、与质量门禁收口合并为一次 ask_user 的交付放行。
- `packages/patent/patent-document/assets/templates/patent/` 新增 4 个模板：`rectification-response`（补正书 + 替换页清单）、`re-examination-request`（复审请求书）、`infringement-opinion`（侵权比对意见书）、`litigation-pleading`（起诉状/答辩状，可切换）。每个随包 SKILL.md、assets/template.html、example.html 与 references（conventions/checklist/citation-log），遵循既有 DOCS.md 品牌契约。`DocumentTemplateId`、`TEMPLATE_IDS`、manifest.json、工具描述与 README 双语同步为 9 个模板。
- `patent-quality-gate` 增加正式交付检查项（场景模板 + 矫正/美化完成，docx 规则保留）与「放行去重」规则；`patent-workspace-layout` 写明渲染产物落盘（与 md 定稿同目录，`_matter-log.md` 记交付）。

设计文档状态提示与 preset README（双语）反映 13 角色、13 技能与 9 模板。

## 备选方案

**只改 SKILL、不注册角色契约。** 否决：未注册角色无 role contract，成员 persona 不会写入立场/交付字段/越界禁止，`patent_teams_status` 无 role_contract，质量门禁无法按 worker 输出验收。

**文档专员仅作可选成员。** 否决（用户决策）：角色默认纳入全部场景包；收口前的交付任务是必经步骤而非可选项。

**补正/复审/诉讼沿用现有 5 模板。** 否决（用户决策）：这些场景配置专用模板，使交付物与程序结构匹配（替换页清单、请求事项、逐特征比对表、当事人与诉请结构）。

## 影响

- `role-contracts.spec` / `worker-contract.spec` 数量与断言已更新（13 角色；16 worker），覆盖新角色与新 worker。
- `render-patent-document.spec` 与 `template-resolver.spec` 通过真实资产覆盖 4 个新模板。
- `pnpm run gen-tool-catalog` 重写 `docs/tool-catalog.md`（模板枚举与 role 描述）；中文版属配对排除项。
- 技能经 preset 的 `customSkillDirs` 自动注册；SKILL.md 与其余 preset 技能一样不涉技能元数据门禁。
