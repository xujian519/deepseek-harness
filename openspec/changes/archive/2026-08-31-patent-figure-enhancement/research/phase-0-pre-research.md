# Phase 0 pre-research (tasks 0.1 / 0.2)

Executed 2026-08-31 on macOS (arm64, Node 22.x). All numbers below are measured, not assumed.

## 0.1 `@viz-js/viz` format matrix and size

Package: `@viz-js/viz@3.29.0`, MIT, `dist.unpackedSize` 4.98 MB, zero runtime dependencies.
Installed dist entries: `viz.js` (ESM) 1.2 MB, `viz.cjs` 1.2 MB, `viz-global.js` 1.3 MB — each inlines the
Graphviz WASM binary; the module-level cost of one import is ~1.2 MB.

Format matrix via `viz.renderString(dot, { format, engine: 'dot' })` on Node:

| format | result |
| --- | --- |
| `svg` | OK, text output (`<svg` prefix verified) |
| `png` | **throws** `Format: "png" not recognized` — the WASM build has no raster/cairo plugin |
| `pdf` | **throws** `Format: "pdf" not recognized` |
| `json` | OK (`dot_json` shape) |
| `plain` | OK |

Full recognized list (from the throw message): `canon cmap cmapx cmapx_np dot dot_json eps fig gv imap
imap_np ismap json json0 pic plain plain-ext pov ps ps2 svg svgz` — text formats only.

Other observed behavior:

- `instance()` load: ~8 ms warm; 5 subsequent renders: ~1 ms total. Layout engines `dot`/`neato`/`circo` all work.
- Invalid DOT throws `Error: syntax error in line 1 near '}'` (Graphviz message text preserved).

**Conclusion (resolves O1):** the bundled engine covers SVG only. PNG and PDF must both route through the
CLI fallback; with no `dot` binary those two formats fail `setup_required` with install guidance, while
SVG (the tool's default format) needs no system dependency. Dynamic `import()` keeps the 1.2 MB module off
the initial load path.

## 0.2 Graphviz SVG node-group structure across engines

Same block-diagram DOT (3 nodes with ` (NN)` labels, 2 labeled edges) rendered by `dot` CLI
(Graphviz 15.1.1, `/opt/homebrew/bin/dot`) and by `@viz-js/viz` 3.29.0 WASM. Outputs: 2726 vs 2722 bytes.

Both engines emit the identical structure:

```xml
<g id="node1" class="node">
  <title>input</title>
  <polygon fill="none" stroke="black" points="…6 x,y pairs (node outline bbox)…"/>
  <text xml:space="preserve" text-anchor="middle" x="…" y="…" font-family="…" font-size="10.00">输入设备 (10)</text>
</g>
```

- Group ids: `graph0`, `node1..nodeN`, `edge1..edgeM` — identical ids and ordering in both outputs.
- `<title>` inside a node group carries the sanitized **DOT node id** — the natural match key for the
  numeral map (no label-text matching needed).
- Node outline: `<polygon points="…">` for box/invhouse/cylinder shapes (bbox = min/max of point pairs);
  flowchart ellipses use `<ellipse cx cy rx ry>` instead.
- Label: single `<text>` with `text-anchor="middle"` and `x`/`y` center coordinates.
- Only differences: sub-pixel layout coordinate deltas (different Graphviz build versions) and the
  generated-by comment. Structure and element counts (`polygon`/`path`/`text`/`title`) are equal.

**Conclusion (resolves O2):** one leader-line parser serves both renderers. Anchor recipe: node group
`<g id="nodeN">` → match component by `<title>` text → shape bbox from `<polygon points>` or
`<ellipse cx/cy/rx/ry>` → place the numeral outside the bbox, draw `<line>` from a bbox edge point to the
numeral. Parser stays tolerant: a group missing any anchor element is skipped with a warning.
