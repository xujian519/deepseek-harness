---
kind: upgrade-guide
description: "Five patent-plugin surfaces now enforce what a session could skip: artifact gating, three figure findings, required cutting-plane marks, the deployment figure font, a requirement checklist, and the guideline channel filled by law_search."
---

# Patent enforcement surfaces: artifact gate, figure checks, requirement checklist

English | [中文](guide.zh.md)

## Change

**`patent-rule` gates artifacts before dispatch (`structuralGate`) and can widen the result gate (`gateCheckTypes`).** The result gate keeps `keyword_blocklist` by default; `gateCheckTypes` accepts the other incident families only, whose shipped rules are `action: warn` — widening adds log lines, and an absence-based family is rejected with a warning. A `structuralGate` entry declares, per tool, the arguments holding an artifact text and the absence-based rule ids to judge it by; a block-level hit denies the call; an unknown rule id is warned and dropped. No entry ships: a renderer's arguments hold slot fragments, not the document.

**`verify_patent_figure` reports three new findings.** `element-overlap` — two closed outlines whose bounding boxes partially overlap (touch, containment, a shared `data-dsh-hatch-group`, and a fill-only pair are excluded). `font-below-minimum` — text below the floor in `min_font_mm` or `Config.figureMinFontMm`; the report also carries the measured `minFontMm`. `figure-hierarchy` — a claim's construction statement (「控制单元31的输入端311」) contradicting the nesting declared through `hierarchy`; it runs only with both `hierarchy` and `claims`.

**`generate_patent_figure` enforces cutting-plane marks and the deployment font.** `require_cutting_marks` (and `Config.figureRequireCuttingMarks`) makes a cross-section without `sections.cutting_marks` an `invalid_input` error; GB/T 4458.6 waives the marks only for a symmetric full section, which may pass `false`. `Config.figureFontMm` sets the DOT `fontsize`, the direct-draw label default and the layout's body font, so 小四 (4.23 mm) or 四号 (4.94 mm) is met without per-call tuning.

**`verify_deliverable` produces the requirement checklist.** New optional `requirements` (the instructing party's wording plus its evidence paths) fails a requirement with no evidence or a missing evidence file, and the result carries one row per requirement.

**`law_search` fills the guideline channel.** The cnlaw index verifies statutes and decisions only, not 《专利审查指南》 sections, so guideline text comes from the deployment's external IP knowledge base — `law_search` (scope=guideline for the chapters, scope=law for statute text; every hit carries its corpus path), plus `patent_kg_query` (node_type=GuidelineRule) and `patent_wiki_search` for rule cards. A section no retrieval returns stays 未核验.

## Migration

1. Expect `element-overlap` and `font-below-minimum` on drawings that passed before; resolve each — a rejection needs the measurement quoted and a second reviewer.
2. Set `Config.figureFontMm` (小四 = 4.23 mm) and `Config.figureMinFontMm`; with `Config.figureRequireCuttingMarks: true`, each cross-section supplies `sections.cutting_marks` or passes `require_cutting_marks: false` when symmetric.
3. Pass requirements to `verify_deliverable({ …, requirements: [{ requirement, evidence }] })`.
4. Deploy `structuralGate` only where the tool's argument is the whole document text.
5. A guideline citation `law_verify` reports 未核验: run `law_search` with `scope: 'guideline'` and record the hit's `sourcePath` as the citation source.
6. Confirm: `verify_patent_figure` with `min_font_mm` reports `font-below-minimum`; a cross-section with `require_cutting_marks: true` and no marks fails; a requirement with no evidence fails.
