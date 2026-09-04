# Agent Note: Patent team adds a document-specialist role and scenario templates

Status: implemented

English | [中文](2026-09-04-patent-team-document-specialist.zh.md)

## Problem

The `patent-team-composition` durable-team template produces analysis and draft content but no scenario-matched formal deliverable: each member returns markdown, and the fallback output discipline (md draft → docx via officecli, or html/pdf via `render_patent_document`) is applied ad hoc without a named owner. `render_patent_document` ships five templates (patentability-opinion, search-report, oa-response, claims-spec, invalidation-opinion) that leave correction, reexamination, and litigation scenarios without a matching form, and no team position owns correction (terminology, law-citation format, numbers/dates/deadlines, numbering, salutations) or beautification (template, brand, A4 layout).

## Decision

The team gains a **document-specialist** role (`document-specialist`, stance `neutral`, unchanged from the 12-role roster to 13):

> Extends [2026-08-19-patent-team-composition-roles](2026-08-19-patent-team-composition-roles.md): the seven scenario packs keep their structure, gain the document-specialist member and an extra closure-position task.

- Registered in `packages/patent/patent-workflow/src/role-contracts.ts` with worker `patent-document-renderer` (tier `work`, allowed `read_file` / `write_file` / `render_patent_document`, hard output contract `交付场景 / 矫正清单 / 渲染产物`, `triggersHITL`, forbidden actions: no substantive conclusions, no drafting for either side). The worker registry and `patent_teams_status` role_contract pick it up automatically; `patent_teams_add_member` role description lists it.
- The `patent-team-composition` SKILL adds the roster row, adds the document-specialist to all seven scenario packs, and inserts a "formal document output" task after the pack's last quality-check task and before the captain's closure. Pack sizes stay within `maxMembers` 8 (litigation 7 + optional tech-investigator 8).
- A new preset skill `patent-document-polish` carries the deliverable discipline: scenario→template mapping, correction checklist (terminology, law-citation format with provenance, numbers/dates/deadlines computed by tools, numbering levels, salutations), beautification checklist (template selection, brand injection, A4, md draft → html/pdf or docx), and a single merged delivery-release ask_user with the quality-gate closure.
- Four new templates in `packages/patent/patent-document/assets/templates/patent/`: `rectification-response` (correction sheet with replacement-page list), `re-examination-request` (reexamination request), `infringement-opinion` (infringement comparison opinion), `litigation-pleading` (civil complaint / defense, switchable). Each ships SKILL.md, assets/template.html, example.html, and references (conventions/checklist/citation-log) following the existing DOCS.md brand contract. `DocumentTemplateId`, `TEMPLATE_IDS`, manifest.json, tool description, and the README pair move to nine templates.
- `patent-quality-gate` gains the formal-deliverable check (scenario template + correction/beautification complete, docx rules kept) and a no-duplicate-confirmation rule; `patent-workspace-layout` documents where rendered deliverables land (same directory as the md draft, `_matter-log.md` delivery entry).

The design doc status note and preset README (bilingual) reflect the 13-role roster, 13 skills, and nine templates.

## Alternatives considered

**No code change; role documented only in the SKILL.** Rejected: an unregistered role gets no role contract, so the member persona carries no stance/deliverables/forbidden actions, `patent_teams_status` shows no role_contract, and the quality gate cannot validate the worker output.

**Document-specialist as an optional member only.** Rejected after user decision: the role defaults into every scenario pack; the closure task sequence makes the deliverable a mandatory step rather than a nicety.

**Reusing the five templates for correction/reexamination/litigation.** Rejected after user decision: those scenarios get dedicated templates so the deliverable matches the procedure (replacement-page list, request items, per-feature comparison, party/relief structure).

## Consequences

- `role-contracts.spec` / `worker-contract.spec` counts and assertions updated (13 roles; 16 workers) and cover the new role and worker.
- `render-patent-document.spec` and `template-resolver.spec` cover the four new templates through the real assets.
- `pnpm run gen-tool-catalog` rewrote `docs/tool-catalog.md` (template enum and role description); the Chinese catalog is pairing-excluded.
- Skills register through the preset's `customSkillDirs`; the SKILL.md stays outside skill-metadata gates (same as the other preset skills).
