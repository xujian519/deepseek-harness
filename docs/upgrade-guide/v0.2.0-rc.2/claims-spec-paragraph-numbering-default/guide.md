---
kind: upgrade-guide
description: "The shipped claims-spec template no longer declares paragraph numbering, so render_patent_document output drops the [0001] numbers unless a template declares data-paragraph-numbering itself."
---

# The claims-spec template renders without paragraph numbers by default

English | [中文](guide.zh.md)

## Change

`assets/templates/patent/claims-spec` no longer carries `data-paragraph-numbering` on its specification section. A document rendered through `render_patent_document` with `template: 'claims-spec'` therefore has no `[0001]`, `[0002]`, … numbers: the rendering engine numbers a section only where the template declares it. This changes the file the deliverable ships, so a reader comparing a newly rendered 权利要求书与说明书 against one rendered before this change sees the numbers gone.

The template comment records the reason: no Patent Law, 专利法实施细则, or 专利审查指南 clause requires paragraph numbering, so whether a filing uses it is a property of the delivery format. The `paragraphNumbering.ts` engine and its `data-paragraph-numbering` declaration are unchanged; only the shipped default flipped.

## Migration

1. A deployment whose filing format uses paragraph numbers adds the declaration back on the section it wants numbered:

   ```html
   <section id="specification" aria-label="说明书" data-paragraph-numbering="[0001]">
   ```

   Edit the copy of `claims-spec` under the deployment's own template root, not the shipped asset. Do not author the numbers by hand: the engine strips and rewrites them on every render.
2. A deployment whose format omits the numbers needs no change; re-render to drop them from new deliverables.
3. Confirm: render `claims-spec` and grep the HTML for `<p>[0` — none without the declaration, one per paragraph with it.
