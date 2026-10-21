---
kind: upgrade-guide
description: "Patent ground findings now carry `negated`, so a denied ground is no longer read as asserted."
---

# Patent ground findings distinguish denied grounds

English | [中文](guide.zh.md)

## Change

`identifyInvalidationGrounds`, `identifyReexaminationGrounds`, and `identifyDesignGrounds` return `negated: boolean` on every finding. A keyword hit inside a same-clause pre-negation (`未主张`, `不主张`, `并非`, `没有证据表明`, and similar phrases) stays in the result for review but is marked `negated: true`. When the same ground is both denied and asserted, the later asserted occurrence wins; when every occurrence is negated, the first negated hit is returned.

Downstream behavior:

- `detectPatentSubject` no longer infers `utility-model` from a negated subject-matter ground.
- The `grounds` atom appends `，文中为否定表述` to a negated finding in `grounds_summary`; the JSON output keeps the full list.
- `buildReexaminationPreparation` excludes negated findings before building its sections and `grounds`.

The heuristic only inspects text before the hit, within the same clause (，；。 and line breaks cut scope), after the last contrast marker (但/然而/…). Post-position negation (…的理由不成立) and double negation are not detected.

## Migration

1. TypeScript consumers must accept the new required field. Code that constructs `GroundFinding` literals adds `negated: false` for an asserted ground.
2. Before treating a finding as asserted, filter on `!finding.negated`. The entry stays in the result with `negated: true` so a report can show what the document denied.
3. JSON consumers reading persisted `grounds` output receive the field automatically; no parser change is needed unless they reject unknown keys.
4. Confirm: pass `请求人未主张权利要求1不具备新颖性，但主张不具备创造性` to the invalidation table and observe novelty `negated: true` and inventiveness `negated: false`.
