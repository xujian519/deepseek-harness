---
kind: upgrade-guide
description: "Rendered OA responses now warn when the amendment table has no amended claim text, and when any of the three tables carries an empty or placeholder-only body."
---

# OA responses cross-check the two views of amendments and evidence

English | [中文](guide.zh.md)

## Change

Rendering an OA response (`template: 'oa-response'`) now adds two kinds of entry to the result's `warnings`. Both come from `checkDocumentCompliance` and neither changes the rendered HTML.

`amendment-cross-reference` guards the pair the house rules keep in two places: the amendment table (表 1) and the amended independent claim in full (2.1). It fires in two directions:

- the table lists at least one amendment, but the section holds no `claim-text` block — a draft that answers「参见修改对照表」instead of publishing the amended text;
- the `claim-text` block names a claim number the table never registers.

The reverse direction stays silent: a dependent claim amended only in the table is legitimate, since the full text is required for the independent claim alone.

`empty-table` reports a table with no data rows at all, or whose data rows are nothing but the template placeholder (`________`). It is scoped to the three OA tables by their body ids: `amendment-table`, `evidence-table`, `citation-table`. Other templates' tables are not inspected.

The policy behind it is new: the two pairs — amendment table with amended claim text, evidence list with citation log — stay separate. They are two views of one fact, not duplication, so nothing was merged and nothing will be. The reasoning and the matching rules are written down in `references/conventions.md` §11 of the `oa-response` template, and a new spec (`oa-double-carrier.spec.ts`) fails if either side is dropped from the conventions, the checklist, the two SKILL files, or the template itself.

Anyone who treats a non-empty `warnings` array as a failed render is affected, as is anyone matching on the old warning set.

## Migration

1. If your pipeline fails on any warning, check existing drafts before upgrading: every claim registered in 表 1 that is an independent claim needs its full text in 2.1, and every claim number in the full text must appear in 表 1.
2. Keep dependent-claim amendments in the table only — that direction is not reported.
3. Drop tables you have nothing to put in; do not ship a placeholder row. If you must keep one cell blank, the row still counts as filled as long as one cell carries real content.
4. Match on the rule names `amendment-cross-reference` and `empty-table` rather than on message text, which is written for the drafter.
5. Re-run `pnpm exec vitest run packages/patent/patent-document/tests`; the new spec and the compliance cases are part of that suite.
