# Agent Note: Office drawing profiles, sheet layout, and vector figure types

Status: implemented

English | [中文](2026-09-21-patent-drawing-office-profiles-and-vector-figures.zh.md)

## Problem

The figure tools drew at the drawing's own size and stopped there. `generate_patent_figure` set Graphviz `page`/`size`/`margin`/`dpi` attributes and reported nothing about the sheet; `generate_structure_figure` returned view fragments and stated in code that leaving the figure number out of the pixels is what CNIPA Guidelines Part I Chapter 1 §4.3 wants. Neither could answer the questions a filing raises: which sheet the drawing lands on, how large the characters end up, whether the figure needs a number, and whether the selected colour policy is allowed where the application is going. Measured on Graphviz 15.1.1, `page` produces no sheet for svg/png/pdf (only PostScript paginates), `size` scales a drawing down only when it exceeds the box, and `margin` adds whitespace — so the existing submission knobs could not be built into a sheet even in principle.

Three figure families the domain needs could not be expressed at all: circuit diagrams (electrical symbols, orthogonal wiring, junction dots), plots (axes, ticks, units), cross-sections (hatching clipped to a part outline, cutting-plane marks), sequence diagrams (lifelines, message arrows), and appearance-design view sheets (six orthographic views at one scale with each view name below its view).

Four internal inconsistencies also contradicted the tools' own guidance: `generate_patent_figure` defaults to a numeral step of 2 while `analyze_patent_figure` reported a step change as a discontinuity and `FIGURE_SPEC_GUIDE` told the model numerals must not skip; the figure-description sentence differed across three tools; `dot-builder` quoted the guidelines as 「墨色墨水」 where the text says 「黑色墨水绘制」; and the structure-figure "figure number belongs outside the pixels" claim holds only for a single-figure application, because §4.3 requires the number below the drawing once an application has two or more figures.

## Decision

**Per-office profiles, a layout step, and a compliance check.** `figure/office-profile.ts` fixes the verified values — China A4 with 25/25/15/15 mm margins and `图N` numbering from two figures up (Guidelines §4.3, Part V Chapter 1 §4.2/4.3); PCT's 0.32 cm minimum character height, `Fig. N`, `without colorings` and `1/3` sheet numbers (Rules 11.6(c), 11.13(a), 11.13(h), 11.13(k), Administrative Instructions Section 207(b)(iii)); the USPTO margins, 0.32 cm minimum character height, `FIG. N`, petition-bound colour (37 CFR 1.84(a)(2), 1.84(g), 1.84(p)(3), 1.84(u)) — and deliberately omits EPO. `figure/submission-page.ts` parses a rendered SVG (width/height/viewBox, mm/cm/in/pt/px), scales it into the profile's type area, writes the caption below the drawing and the sheet number at the bottom of the type area, and returns the layout scale, placed size, and character height derived from the caller's font size. `figure/compliance.ts` reports colour-policy violations, an unnumbered figure in a set of two or more, and a laid-out character height below the office minimum.

**Layout is SVG-only and says so.** png/pdf returns a "not laid out" warning instead of a drawing that silently lacks the sheet geometry; `fit_to_page: false` measures without rewriting the canvas. Graphviz + a page-assembly step is the only combination that yields an A4 sheet without adding a PDF engine.

**A second drawing path for the figure families Graphviz cannot express.** `figure/vector-figure.ts` defines the seam: a `VectorFigureSpec` (millimetre canvas, black-stroke fragment, drawn words) plus a wrapper that emits a standalone SVG; `figure/vector-figure-build.ts` maps the tool's snake_case JSON onto five modules (`circuit-diagram`, `plot-diagram`, `section-diagram`, `sequence-diagram`, `appearance-view-sheet`). The fragment contract requires text elements to carry `fill="#000000" stroke="none"`, since the wrapper's group sets `fill="none"`. Vector types are SVG-only, reject `format` other than `svg`, carry their own wording into the wording check, and are excluded from `panels` by that schema.

**Missing figure types added on the DOT path.** `buildStateDiagramDOT` draws states as rounded boxes, a final state as a double circle, and — per §4.3's requirement that flow and block diagrams carry their necessary words and symbols inside the shapes — an initial pseudo-state as a filled circle with no label and therefore no reference numeral.

**Checks extended where the rules reach.** `figure/wording-rules.ts` adds a figure number drawn inside the figure, a scale callout (PCT Rule 11.13(d), 37 CFR 1.84(k)), and a numeral bound to brackets or quotes (PCT Rule 11.13(e), 37 CFR 1.84(p)(1)); a pure figure number takes precedence over the non-Chinese-word report, because the defect is the number's position, not its language. `validate_specification` reconciles figure marks against the body and the claims as well as the drawing-description section (the Implementing Regulations Article 21 duty runs in both directions), reads the bracketed claim marks of Article 22(4), and checks that the abstract's designated figure exists. `analyze_patent_figure` accepts a constant numeral step and reports only a step change, and `figure/figure-description.ts` gives all three generating tools one sentence template.

## Alternatives considered

**Build the sheet from Graphviz's own page attributes.** Rejected by measurement: `page` is a no-op for svg/png/pdf, `size` scales only downward, and `margin` cannot reserve a caption band. The submission knobs stay meaningful for the drawing's own canvas, and the sheet comes from a separate step.

**Convert SVG to PDF to get a real sheet.** Rejected for now: it adds a rasterizer or a headless browser to a path that already works through SVG, and SVG is accepted for electronic filing.

**Hard-error when the two-thirds reduction leaves characters below the office minimum.** Rejected: none of the three offices states a numeric floor for the reduced size, so the tool reports the measured reduced height in `layout` and warns only against the as-filed minimum.

**Draw the vector figure types with Graphviz.** Rejected: electrical symbols, hatching, axis ticks, lifelines, and view-name placement are not node-and-edge constructs, and approximating them with record shapes produces drawings that no longer follow the drafting practice the rules point at.

**Add an EPO profile from the PCT values.** Rejected: EPC Rule 46/47 and the EPO Guidelines were unreachable during this work (epo.org returns 403 to this host), and EPO's own 2025-10-01 colour and greyscale acceptance arrives through the PCT route. An unverified office profile would state rules the tool cannot cite.

**Number every figure unconditionally.** Rejected: §4.3 and PCT IP 5.141 make the number conditional on the application having two or more figures, so `figureCaption` returns nothing for a single-figure application and the tool takes `figure_count` for the rest.

**Support the vector figure types inside `panels`.** Deferred rather than approximated: panel entries are DOT-shaped, so the vector types are rejected by the panel schema, and a multi-panel vector set would need its own input contract.

## Consequences

- A drawn figure now carries a sheet, a caption, a sheet number, and measured sizes, and the tool reports which of those it could not provide. Callers submitting to a named office get the office's margins and numbering without restating them.
- The office profiles are constants sourced to individual provisions; a provision that changes (EPO's colour practice, a new CJK office) means editing one table, and the module records why EPO is absent.
- Vector figures are SVG-only. A caller who needs PNG or PDF for one of them must convert downstream, and the tool says so instead of emitting a file that looks accepted.
- The appearance-design sheet composes views the caller supplies; it does not draw product outlines, so the shape-drawing half of that workflow (line drawings, surface shading, photo compliance) remains with the caller or a CAD step.
- The wording rules report more, including cases where the report is arguably a preference rather than a defect (a scale callout inside a plot). They stay advisory and never rewrite input, so a caller may ignore them.
- The figure-number rule interacts with assembly: the caption sits below the drawing on the sheet, so a caller who later rearranges sheets must move the caption with the drawing rather than re-numeral the pixels.

## Testing

- `tests/figure-submission.spec.ts` pins the office profiles, caption and sheet-number forms, SVG length parsing (mm/cm/in/pt/px/unitless/percent), geometry parsing (viewBox-only fallback, unsafe and dimension-less rejection), layout output (A4 dimensions, caption below the drawing, clamp warning, size and character-height metrics, parameter range errors), every compliance branch, and the tool paths for caption-on-multi-figure, `fit_to_page: false`, PNG rejection, PCT colour rejection, and per-panel captions.
- `tests/figure-vector.spec.ts` pins the seam contract; `tests/figure-vector-tool.spec.ts` drives the five vector types through the tool, including that they never reach the Graphviz renderer, that `cross_section` and `plot` carry their warnings, that layout applies, and that bad input and non-SVG formats map to `invalid_tool_input`.
- Each figure module has its own spec: `figure-circuit-diagram.spec.ts`, `figure-plot-diagram.spec.ts`, `figure-section-diagram.spec.ts`, `figure-sequence-diagram.spec.ts`, `figure-appearance-view-sheet.spec.ts`.
- `tests/figure-wording.spec.ts`, `tests/validate-specification.spec.ts`, `tests/figure-tools.spec.ts`, and `tests/structure-figure-tool.spec.ts` cover the extended checks, the numeral-step acceptance, the shared sentence, and the structure-figure layout path.
- `snapshots/session/patent-oa-response/tool-schemas.expected.json` was refreshed for the new tool inputs.

## Deferred

- Chemical structure rendering (RDKit remains unavailable) and the appearance-design shape-drawing half.
- PNG/PDF output for `generate_structure_figure` and for the vector figure types.
- `docs/tool-catalog.zh.md` and its pairing record still need the translation pass that follows the regenerated `docs/tool-catalog.md`.
