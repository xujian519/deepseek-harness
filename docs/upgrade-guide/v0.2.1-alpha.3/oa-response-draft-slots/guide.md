---
kind: upgrade-guide
description: "The oa-response controlled draft drops its nine arg-* fields for fact, rule, and argument section slots, so drafts built for the previous slots fail validation."
---

# The oa-response draft moves to fact, rule, and argument sections

English | [中文](guide.zh.md)

## Change

`render_patent_document` with `template: 'oa-response'` took the contested part of the response as nine leaf fields: `arg-nov-oa`, `arg-nov-reply`, `arg-nov-evidence`, `arg-nov-conclusion`, `arg-inv-oa`, `arg-inv-reply`, `arg-inv-evidence`, `arg-inv-conclusion` (required), and `arg-other` (optional).

The nine fields are removed. The draft now carries the contested part as section blocks in `sections`: `facts-application` and `facts-prior-art` for the facts, `rules-body` for the law and rules the arguments rest on, `argument-novelty` and `argument-inventiveness` for the per-ground arguments, plus optional `argument-other` and `formalities-body`. Those five named first are required, and the section slots carried over from the previous draft stay required (`doc-number`, `position-points`, `amendment-table`, `amended-claim-1`, `evidence-table`, `citation-table`).

After upgrading, a previously built oa-response draft fails validation: each `arg-*` name is reported as an unknown slot, the missing required sections are listed, and no document is written. The rendered document also renumbers its headings around the same order (三、本案事实 through 八、结论与请求), so a diff between old and new renders of an equivalent document shows heading and numbering changes.

## Migration

1. Rebuild the draft's contested part as section blocks: novelty arguments into `argument-novelty`, inventiveness arguments into `argument-inventiveness`, the two fact groups into `facts-application` and `facts-prior-art`, the cited law into `rules-body`, grounds outside novelty and inventiveness into `argument-other`, and the handling of other defects into `formalities-body`. The template `SKILL.md` in `assets/templates/patent/oa-response/` documents the slots and the section order the document follows.
2. Confirm: rendering the migrated draft writes the HTML/PDF pair as before, while a draft that still carries `arg-*` fails with those names listed as unknown slots and the new sections as missing.
