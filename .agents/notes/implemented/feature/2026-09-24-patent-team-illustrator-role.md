# Agent Note: Patent team adds an illustrator role owning drawings and the numeral table

Status: implemented

English | [中文](2026-09-24-patent-team-illustrator-role.zh.md)

## Problem

Drawings carry a large share of real patent-team work and had no owning position. Across 21 archived and live teams in the deployment case corpus, 122 of 313 tasks (39%) involve drawings, 15 of 21 teams carry at least one drawing task, and one team (`patent-team-起垄器附图评审`) exists solely for drawing review. The 13-role roster nonetheless assigned drawings to nobody: the `formal-examiner` role lists "附图清晰度" in its description with no implementation behind it, no worker's `allowedTools` names any of the five figure tools, and the `patent-quality-gate` checklist had no drawing item at all. Numeral backfill and surface self-checks ran through per-case Python scripts (`_fig_check.py`, `_leader_map.py`), whose results enter no index and cannot be re-inspected, and an archived team member named `figchecker` had to be registered under the unrelated `technical-expert` role because no drawing role existed.

## Decision

The roster gains an **illustrator** role (`illustrator`, stance `neutral`) over the worker `patent-illustrator` (tier `work`), registered in `packages/patent/patent-workflow/src/role-contracts.ts` and `worker-contract.ts`:

- Hard output contract `${caseOutputsDir('{caseId}')}/figure-deliverable.md` with required fields `附图文件` / `附图标记表` / `图文一致性` / `形式要件核验`, so the composed quality gate validates drawing output the same way it validates the other workers.
- `allowedTools` names `generate_patent_figure`, `generate_structure_figure`, `add_patent_figure_references`, `analyze_patent_figure`, `search_patent_figure`, `validate_specification` plus `read_file` / `write_file`; forbidden actions are no substantive conclusions (claim layout, protection scope, amendment plan), no novelty/inventiveness judgment, and no drafting for either side; `triggersHITL` is true.
- The role owns the numeral table as the single authority for the two-way consistency of 《专利法实施细则》第二十一条第二款 between the drawing surface, the numeral table, and the description.
- `patent-team-composition` gains the roster row and inserts a drawing task into the drafting pack (t4a, after the description draft, before adversarial review), the office-action-response pack (t3a, after the confirmed amendment plan), the correction pack (t2a), and the reexamination pack (t2a). Pack sizes become 7 / 7 / 4 / 7, inside `maxMembers` 8. The invalidation and litigation packs stay without the illustrator because their drawings are comparison and claim-construction material, not deliverables; the captain adds `illustrator` on demand within the member cap.
- `patent-quality-gate` gains item 6, "附图与标号": numeral-table presence and per-numeral agreement across surface, description, and claims, figure numbers below their drawings, no annotations beyond necessary words, color and layout dimensions per target office, and the ban on replacing the figure tools with ad-hoc scripts.
- `patent_teams_add_member`'s role description derives from `defaultRoleContracts()` instead of repeating the roster in tool text.
- The member persona's role section renders the role's tools (`workerTools`) beside its stance, required deliverables, forbidden actions, and HITL flag, so every member — the illustrator included — sees which tools its role owns. `allowedTools` still has no enforcement point, so the list informs rather than restricts.

Extends [2026-08-19-patent-team-composition-roles](2026-08-19-patent-team-composition-roles.md) and [2026-09-04-patent-team-document-specialist](2026-09-04-patent-team-document-specialist.md); the figure-capability notes [2026-08-28](2026-08-28-patent-figure-generation.md), [2026-08-30](2026-08-30-patent-figure-vision-path.md), [2026-08-31](2026-08-31-patent-figure-rendering-pipeline.md), and [2026-09-21](2026-09-21-patent-drawing-office-profiles-and-vector-figures.md) remain current.

## Alternatives considered

**A worker contract without a role.** Rejected: an unregistered role produces no role contract, so the member persona carries no stance, required deliverables, forbidden actions, or HITL flag, and `patent_teams_status` reports no `role_contract`. Real teams already borrowed the role: captains, drafters, technical experts, and formal examiners all executed drawing tasks, which is what a named owner removes.

**Documenting the role in the SKILL only.** Rejected for the same reason the document-specialist role rejected it: text alone reaches no persona and no gate.

**Adding the illustrator to the invalidation and litigation packs.** Rejected: the litigation pack already sits at the member cap before its optional tech-investigator, and in both packs drawings are evidence and claim-construction material rather than produced deliverables.

**Enforcing `allowedTools` in the same change.** Deferred. The field is declarative metadata with no runtime consumer, and the only existing restriction path is `request.toolFilter.deny`, which hides captain-only team tools from members. Enforcing per-worker tool allowlists would change the runtime behavior of all 16 workers and needs its own scoping. The list reaches the member through the persona's role section, while the routing discipline lives in the composition skill, the gate item, and the task descriptions the captain writes; nothing rejects a tool call outside the list.

## Consequences

- `role-contracts.spec` and `worker-contract.spec` assert 14 roles and 16 workers, and cover the new role's stance, deliverables, worker, and required fields.
- `pnpm run gen-tool-catalog` rewrites `docs/tool-catalog.md` because the `patent_teams_add_member` role description now derives from the roster; `docs/tool-catalog.zh.md` carries the same schema text and was re-recorded in the bilingual pair.
- The quality-gate checklist grows from ten items to eleven.
- The role buys consistency that was previously improvised: one authority for numerals, two-way consistency checks, formal-requirement verification, and results that land in the figure index instead of a case-local script. It does not buy better drawing content: surface-quality judgment, vector-figure numeral assignment, and raster-only figure analysis stay open, as [2026-09-21](2026-09-21-patent-drawing-office-profiles-and-vector-figures.md) records for the vector types, and the document renderer still has no figure page or image embedding, so a delivered application file reaches the client with the drawings attached outside the rendered document.
