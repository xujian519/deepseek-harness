# Agent Note: Shared subprocess bootplate and output schemas for the figure tools

Status: implemented

English | [中文](2026-09-17-figure-tools-shared-bootplate.zh.md)

## Problem

`generate_structure_figure` (FreeCAD/TechDraw) was built as the structural twin of `generate_patent_figure` (Graphviz): `figure/freecad-renderer.ts` mirrors `figure/graphviz-renderer.ts`, and `tool/generate-structure-figure.ts` repeats the component and numeral-map output schema already written in `tool/generate-patent-figure.ts` and `tool/analyze-patent-figure.ts`. The copies are semantic rather than cosmetic. Both renderers must classify one failure the same way (an internal timeout outranks caller cancellation, which outranks a terminating signal, which outranks an exit code) and must agree on the spawn grace period; the three tools must describe one component structure to the model, or a figure produced by one tool stops being readable by the others. Four clone pairs — three between the renderer files, one between the tool files — failed `pnpm run duplication` (jscpd) on master.

## Decision

The shared bootplate moves into two modules, and each renderer and tool keeps only what differs:

- `figure/subprocess-render.ts` owns the collected-stream stdio configuration, the version probe (`spawnVersionProbe`, which returns the exit facts plus the merged stdout/stderr text), the render deadline (`startRenderDeadline`: internal timeout and caller cancellation abort one signal; `dispose()` clears both), the stderr excerpt (`renderStderr`), and the failure-cause wording (`describeRenderFailure`). `SPAWN_GRACE_MS` is the one grace period both renderers pass to spawn.
- `tool/internal/figure-schemas.ts` owns `FIGURE_COMPONENT_KINDS`, `NUMERAL_MAP_SCHEMA`, and `COMPONENT_SCHEMA`. `analyze_patent_figure` re-exports the component-kind vocabulary it used to declare, so its exports are unchanged; `generate_patent_figure` and `generate_structure_figure` import both schemas.

Everything that genuinely differs stays per file: candidate executable lists, install guidance, argv and cwd, FreeCAD's `HOME`/`XDG_*` isolation environment and its `manifest.json` existence check, Graphviz's output-file validation and DOT stdin mapping.

## Alternatives considered

**Mark the clone pairs with `jscpd:ignore` blocks.** Rejected: the duplicated code carries shared contracts — one failure-cause order, one component structure — so suppressing the detector would hide exactly the drift it exists to catch.

**Collapse both renderers into one module parameterized by renderer kind.** Rejected: the two differ in argv, stdin, output artifact, environment isolation, and success criteria; one module would carry two sets of conditionals where two small modules each read plainly.

**Keep the copied schemas and align their content by hand.** Rejected: nothing would fail when one tool's `kind` enum changed without the others, which is the drift the copies make likely.

## Consequences

A change to the probe, the deadline, or the failure wording now lands once for both renderers, and a change to the component or numeral-map schema lands once for the three figure tools.

The shared renderer module also fixes the wording of render failures, so a renderer that needs a different cause order now has to say so explicitly instead of diverging in a copy.

## Verification

`pnpm run duplication` reports zero clones. `packages/patent/patent-tools` runs 610 tests green, including the suites that pin version-probe outcomes and the timeout, caller-cancellation, terminating-signal, non-zero-exit, and pre-aborted-signal render outcomes for both renderers. `pnpm run typecheck` and `pnpm run lint` pass.
