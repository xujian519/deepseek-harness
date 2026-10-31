---
kind: upgrade-guide
description: "Rendered OA responses drop optional sections the draft leaves empty, and the section numbers after a dropped section shift down by one."
---

# OA responses drop empty optional sections

English | [中文](guide.zh.md)

## Change

`render_patent_document` with `template: 'oa-response'` now removes an optional section whose slot the draft leaves out, instead of rendering its heading around an empty container:

- `argument-other` — the「5.3 其他争点」heading and the slot are removed together.
- `formalities-body` — the whole「六、其他缺陷的处理」section, heading included.

A removed section leaves a gap in the Chinese section numbers, so the renderer renumbers the remaining section-level headings to 1..N in document order and rewrites the `<section>.<n>` prefixes of their subheadings. A draft without `formalities-body` therefore renders 七、证据与引用 as 六、证据与引用 and `7.1`/`7.2` as `6.1`/`6.2`. Renumbering runs only when a section was actually folded, so every other template keeps its numbering untouched.

Each folded section is reported in the render result's `warnings` as `已折叠空节：<title>（槽位 <id> 无内容）`.

The OA template body also no longer carries the drafting instructions that used to sit under 三、本案事实, 四、适用规则, 五、意见陈述, 六、其他缺陷的处理 and 7.2. Those rules live in `references/conventions.md` and address the drafter, not the reader; the delivered document now holds only reader-facing prose.

Anyone diffing rendered OA responses against a stored fixture, or reading a fixed section number from the output, is affected.

## Migration

1. Do not assume the response has eight sections: check the `已折叠空节` warnings, or the rendered HTML, to learn whether 六、其他缺陷的处理 exists.
2. Read section numbers from the document instead of hard-coding them; after a fold the evidence section is 六, not 七.
3. Address subheadings by their text (`证据清单`), not by their `7.1`-style prefix.
4. To force a section into every deliverable, fill its slot with one sentence (e.g. `本次审查意见未涉及其他争点`): the fold only triggers on an absent or empty slot.
5. Re-record fixtures that embed a rendered OA response — the fold and the renumbering change the HTML — and run `pnpm exec vitest run packages/patent/patent-document/tests` to confirm the template structure, draft skeleton and fold cases.
