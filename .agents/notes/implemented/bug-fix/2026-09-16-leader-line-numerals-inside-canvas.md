# Agent Note: Leader-line numerals land inside the figure canvas

Status: implemented

English | [中文](2026-09-16-leader-line-numerals-inside-canvas.zh.md)

## Problem

`generate_patent_figure` draws reference numerals with leader lines for block diagrams and component hierarchies (`leader_lines` defaults on for those figure types in SVG), and `add_patent_figure_references` offers the same placement for caller-supplied SVGs. The annotator read each node outline from its `<g class="node">` group, then injected the numeral and its `<line>` connector immediately before `</svg>`. Two defects left that output without rendered numerals.

Graphviz expresses node geometry in the coordinate system of the enclosing `<g class="graph">` group — `dot` 15.1.1 emits `transform="scale(1 1) rotate(0) translate(4 40)"` — while the injected leader group sits at the document root, outside that group. Every leader line and numeral was therefore offset by the group translation: on a three-block left-to-right fixture, 40 pt above the component it named and detached from its outline.

Placement also ignored the canvas the root element declares. SVG clips content outside the `viewBox`, so the numeral on the rightmost component (`x` 368.4 in a 363 pt canvas on the same fixture) and every numeral whose offset landed above the canvas were not rendered at all. The call still returned success with an empty `warnings` array, and the rasterized output was pixel-identical to the same figure generated with `leader_lines: false`.

A third gap appeared once placement was corrected: candidates were checked against node outlines and other numerals only, so on a left-to-right chain the right-side leader line ran collinear with the outgoing edge line and read as part of the connector arrow instead of as a numeral leader.

## Decision

**Placement happens in root coordinates, the canvas grows to hold the placed geometry, and drawn lines are obstacles.**

- `groupScopes` walks every `<g>` scope and accumulates each scope's translation towards the root frame; `frameAt` resolves the innermost frame at a given document offset. Node outlines, edge paths, arrowheads, and edge-label boxes are converted into root coordinates before any geometry decision, so nodes nested in clusters or under a translated graph group are placed correctly. A frame carrying scale, rotation, reflection, or an unparsable transform yields no frame: that node's numeral is embedded in its component label and the call reports it.
- The leader segment and the numeral's text box must both clear three obstacle sets: node outlines, numerals already placed, and content drawn by edges — `<path>` beziers sampled into polylines, arrowhead polygons, and edge-label text boxes estimated from `font-size`, `text-anchor`, and per-character widths (full width for CJK, narrow otherwise). Collinear overlap counts as a conflict, following 《专利审查指南》第一部分第一章 4.3 「剖面图中的剖面线不得妨碍附图标记线和主线条的清楚识别」.
- After placement, `expandCanvas` compares the placed rectangles against the root's declared `viewBox`/`width`/`height` and grows the canvas by a 2-user-unit pad on every side that overflowed: the size attributes grow for right and bottom overflow, and the `viewBox` origin moves outwards for left and top overflow so the drawing itself does not shift. A root without a `viewBox` gets one synthesized from `width`/`height`, with length units converted to px because px is the user unit of a canvas without a `viewBox`. Size values that cannot be converted (percentages, a missing axis, non-positive or unparsable numbers) skip the expansion instead of guessing.

## Alternatives considered

**Convert the whole document into root coordinates.** Rewriting every element's coordinates removes the frame question entirely, but it edits content the annotator does not own (including caller-supplied SVGs), and one missed element silently corrupts the drawing. Converting only the geometry the annotator reasons about, and emitting the leader group at the root, keeps the edit surface to the root tag's canvas attributes plus the injected group.

**Reserve space in the DOT (`margin`, a spacer rank, or an invisible node).** Graphviz margins would pre-open room, but they cost the same blank band on every figure whether or not a numeral needs it, they cannot cover four anchor directions with unbounded numeral lengths, and they shrink the drawing inside a submission page box further than the numerals require.

**Inject the leader group inside the graph group** so that it inherits the frame by construction. That fixes placement but not visibility: the canvas comparison still needs the frame's translation, and the injected group would draw before its later siblings, putting leader lines underneath the very lines they must stay clear of.

**Handle scale, rotation, and reflection in the frame math.** A full affine conversion is implementable, but reflection inverts the top/bottom anchor semantics and the text baseline offset, and Graphviz 15 — the version the CLI renderer targets — emits a pure translate. Degrading to an embedded numeral with a warning keeps the limitation visible instead of guessing at geometry.

**Treat every `<path>` and `<polygon>` in the document as an obstacle.** Graphviz draws its own white background rectangle across the canvas, so that rule rejects every candidate and forces every numeral inline. Restricting obstacles to `<g class="edge">` groups keys on the same structural marker the node parsing already uses.

## Consequences

- Leader-line numbering produces rendered numerals: the component-to-numeral mapping is visible on the figure, not only in `numeralMap` and the model-facing text.
- The declared canvas can exceed the layout Graphviz produced by the leader gap plus the numeral width plus the pad on each overflowing side. Combined with the `page`/`size` submission attributes, a drawing can therefore exceed the configured page box by that margin; keep `figureMargin` at roughly 0.5 cm or more for submission output.
- Placement is more conservative in dense figures: an edge label or arrowhead occupying all four anchor positions pushes the numeral into the component label (with a warning) where the earlier rule would have drawn a leader across a line. The trade is deliberate — an embedded numeral over a leader that collides with a main line.
- Nodes inside scaled, rotated, or reflected groups report the degraded placement instead of drawing a misplaced numeral, so a caller supplying such a `raw_dot` sees the limitation in `warnings`.

## Testing

- `packages/patent/patent-tools/tests/figure-leader-line.spec.ts` covers frame conversion (nested and matrix translates, unsupported transforms), edge and edge-label avoidance, and every canvas-expansion branch: `viewBox` only, synthesized `viewBox` from pt sizes, unconvertible sizes, and left/top overflow.
- `packages/patent/patent-tools/tests/figure-svg-annotate.spec.ts` covers the placement contract with the right and left overflow cases; `packages/patent/patent-tools/tests/figure-graphviz-real-render.spec.ts` runs the pipeline against the real WASM and CLI engines.
- The three-block fixture was rasterized with `rsvg-convert` on both sides of the change: before, the annotated output was byte-identical to the unannotated render; after, each numeral sits outside its component with a leader line reaching the outline, and no leader touches an edge line.

## Related

- [Leader-line numerals specification](../../../../openspec/changes/archive/2026-08-31-patent-figure-enhancement/specs/patent-figure/leader-line-numerals/spec.md)
- [Drawing-wording warnings](../feature/2026-09-16-drawing-wording-warnings.md)
