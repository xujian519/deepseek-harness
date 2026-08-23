# Document agent preset

English | [中文](README.zh.md)

The `document` agent preset composes a document-delivery agent on the DeepSeek Harness. It builds on the `standard` preset and replaces the persona and plan-mode section with document-delivery ones, adds six delivery skills, and mounts an isolated OpenDesign skill provider that gives the agent the full render-template and design-skill library when an OpenDesign checkout is present.

## What it mounts

Beyond the standard coding rows a document workflow needs (shell, filesystem, jobs, skills, goals, plan mode, compaction, delegation, ask-user, todo, web), the preset contributes:

- Six delivery skills in `skills/`: `document-brief` (requirement → delivery spec), `document-html` (single-file HTML artifacts), `document-report` (long reports: Markdown → HTML → PDF-ready), `document-deck` (HTML decks + optional PPTX), `document-word` (`.docx` via the officecli skill), and `document-quality-gate` (P0/P1 pre-delivery checklist).
- An **OpenDesign skill provider**: a second `skill-filesystem` instance named `open-design` that mounts the checkout's `skills/` and `design-templates/` directories when `OPEN_DESIGN_DIR` is set — the same wiring as `examples/opendesign`, built in. Without the variable it registers with no roots (an explicit empty catalog), so the preset works standalone.
- A document-delivery persona (identity, six work disciplines, the standard workflow, and the output discipline) and a document-flavored plan-mode section: delivery specs, outlines, template choices, and export lists are "plans" — no deliverable files are produced before approval.

## Skills

Six skills ship in `skills/`, forming one pipeline: `document-brief` → outline → `document-html` / `document-report` / `document-deck` / `document-word` → `document-quality-gate` → delivery.

- `document-brief` — captures goal, audience, format, design system, success criteria, and constraints into `brief.md`; the input contract for every other skill.
- `document-html` — single-file `index.html` pipeline; prefers OpenDesign render templates (web-prototype / saas-landing / dashboard), falls back to a built-in baseline.
- `document-report` — `report.md` source + `report.html` render with TOC, anchors, and footer.
- `document-deck` — `deck.html` horizontal-slide deck with magazine layout; optional `.pptx` via officecli.
- `document-word` — `.docx` via the officecli skill; falls back to Markdown delivery when officecli is unavailable.
- `document-quality-gate` — P0 (no delivery without passing) and P1 checklist: naming, self-containment, no placeholders, no broken links, sourced facts, accessibility, mobile reflow, budget.

## Prerequisites

None. The preset is fully functional standalone. For the OpenDesign enhancement, clone OpenDesign and export its root:

```sh
git clone https://github.com/nexu-io/open-design.git
export OPEN_DESIGN_DIR="$PWD/open-design"
```

The `open-design` skill provider then catalogs the checkout's 276 skill/template directories (verified against main 0.20.3). `document-word` additionally benefits from the user-level `officecli` skill when present; without it the agent delivers Markdown and says so.

## Model Experience

The model sees the Chinese document-delivery persona (professional identity, six work disciplines, the standard workflow, and the output discipline: deliverables are files, unsourced facts are withdrawn, no invented brands, self-contained output, mandatory HITL confirmation points, mandatory quality gate), the document plan-mode section, the six preset skills plus any OpenDesign skills (when mounted), and the standard coding tools.

## Known Limitations and Deferred Work

- **PDF is export guidance, not a renderer** — `document-report` / `document-html` deliver self-contained HTML; PDF export happens through the delivery studio's print action (desktop print-to-PDF or browser print), not inside the preset.
- **`document-word` depends on the user-level `officecli` skill** — the preset cannot bundle it; without it the agent falls back to Markdown.
- **OpenDesign skills are optional** — without `OPEN_DESIGN_DIR` the agent uses the built-in baseline templates; template variety is reduced but delivery is not blocked.
