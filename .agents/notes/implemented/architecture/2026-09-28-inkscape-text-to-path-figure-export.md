# Agent Note: Font-independent figure export through an optional Inkscape step

Status: implemented

English | [中文](2026-09-28-inkscape-text-to-path-figure-export.zh.md)

## Problem

Generated figure SVGs declare no `font-family`, so their `<text>` is rendered by whichever font the reader has. On a machine without a CJK font (a print shop, an examiner's viewer, a colleague's laptop) the labels come out as tofu boxes or with different metrics — on a document whose entire purpose is to be read. Both drawing paths inherit this: the direct-SVG figures and the Graphviz DOT ones. The render-check that guards figure quality has to estimate text boxes with per-character width ratios for the same reason: the real font is unknown at measurement time.

## Decision

Both figure generators (`generate_patent_figure` and `generate_structure_figure`, whose FreeCAD TechDraw views carry callout numerals as `<text>`) take an optional export step, gated by `Config.figureTextToPath` (default off). When it is on, the host injects one `outlineText` port into each tool — the same injection shape as the DOT `render` port — and every finished SVG goes through the system Inkscape as `--export-type=svg --export-plain-svg --export-text-to-path`, which replaces the glyphs with outline paths. The facts that fall out of that choice:

- **It runs last.** After submission layout (`applySubmissionPage` rewrites the coordinates) and before the index upsert; no later step parses the file.
- **SVG only.** For png/pdf the renderer draws the glyphs itself (`Config.dotFont`), so the tool reports "not in effect" as a warning instead of staying silent.
- **Absence fails loud.** A missing subprocess service or a missing/invalid Inkscape path is `not_installed` → `setup_required` with install guidance; a conversion whose product still contains `<text>` is `render_failed`. The flag promises font independence, so shipping the text version quietly is not an option.
- **The product is validated, then swapped in atomically.** Three gates: the pipeline's `assertSafeSvg` check, no `<text>` left behind (comments excluded), and a geometry guard that rejects a product whose ink leaves the original drawing by more than a millimetre. Only then is it written back over the original path through `writeFileAtomic`, so a reader sees either the old figure or the complete new one; the temporary directory is removed, and a rejected conversion leaves the original byte-identical.
- **It reuses the shared bootplate.** `figure/inkscape-renderer.ts` calls `findExecutable`, `spawnRenderProcess` and `describeRenderThrow` from `figure/subprocess-render.ts`, so executable discovery, the spawn grace period, the deadline and the failure classification are the same ones Graphviz and FreeCAD go through ([shared subprocess bootplate](../simplification/2026-09-17-figure-tools-shared-bootplate.md)).

## Alternatives considered

**Measure the text with a real font in-process (`opentype.js`/`fontkit`) instead of outlining.** Rejected for export: exact metrics would sharpen both the placement and the render-check model, but the file would still need the reader to own that font. Those libraries remain the way to refine the model if a deployment wants it.

**Embed the font in the SVG.** Rejected: every figure would carry a font program, CJK subsets stay large, and it forces a font-licensing choice we cannot make for the user.

**Rasterize the figures instead.** Rejected: patent drawings are line art that must stay vector (300 dpi is a floor, not a goal), and a bitmap throws away the geometry the render-check measures.

**Outline unconditionally, with no Config gate.** Rejected: a deployment without Inkscape must still be able to generate figures, and a `<text>` figure is the better artifact when a drafter will finish it in a vector editor.

**Warn and keep the text when Inkscape is absent.** Rejected: that would defeat the promise and be invisible in the artifact.

## Consequences

Exported figures no longer depend on any font: what the drafter sees is what the printer renders. The cost is an external GPL binary the deployment has to install (~645 MB), roughly 0.4 s per figure, files around ten times larger (glyph outlines instead of `<text>`), and text that is no longer searchable or editable in place.

The render-check has no text to measure in such a file — glyph outlines are measured as ordinary paths, and their curve segments are reported `not-measured` by design. The strike-through check therefore runs at generation time, on the text version, after submission layout and before this step; a later `verify_patent_figure` pass still measures line work, hatching and canvas bounds.

## Verification

`packages/patent/patent-tools` runs 994 tests (992 green; the two real-Inkscape cases self-skip without it). That includes the renderer's own suite over a fake subprocess (install guidance, the exact argv, the `<text>`-still-present rejection, the safety check, the geometry guard, a failing write-back, a read failure, cancellation before the swap) and a real-subprocess end-to-end suite that self-skips without Inkscape — CI installs none, so CI has no signal for that path, the same situation the FreeCAD projection suite documents.

The real path was also run by hand on a CNIPA-laid-out A4 page: the artifact has no `<text>`, keeps `width="210mm" height="297mm" viewBox="0 0 210 297"` and every `stroke-width` value, and the rasterized page is visually identical to the text version. `pnpm run duplication`, `pnpm run typecheck`, `pnpm run lint` and the documentation gates pass.
