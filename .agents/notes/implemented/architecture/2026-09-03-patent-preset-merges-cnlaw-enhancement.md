# Agent Note: patent preset merges the local cnlaw enhancement

Status: implemented

English | [中文](2026-09-03-patent-preset-merges-cnlaw-enhancement.zh.md)

## Problem

Two presets composed nearly the same patent agent: the shipped `patent` preset and a locally authored `patent-cnlaw` preset (user root, `~/.dsh/.agent-presets/patent-cnlaw`). Both mounted the same nine patent-domain plugins but differed in persona discipline and skills, so the picker showed two entries that read as a duplicate. The local copy was a snapshot taken from the then-current preset on 2026-08-26 and drifted behind the shipped preset, which kept receiving fixes after that date (patent-teams tool updates, the self-evolve benchmark, the figure vision route). `discoverPresets` scans roots in shipped → configured → user order with first-root-wins per id, so a user-root preset can never replace or hide a shipped preset of the same id: convergence to one entry had to happen in the shipped preset itself.

## Decision

The shipped `patent` preset is now the single patent mode and absorbs the local enhancement's full value, on a superset basis:

- Persona discipline 3 (citation verification) and the retrieval row now prefer the local cnlaw REST base — `:8100 /search`, `/search/decisions`, `/search/judgments` with `source_path` provenance and the authority ordering law/regulation > examination guidelines > decisions/judgments > books — with the explicit fallback to `patent_case_search` / `patent_kg_query` when cnlaw is unavailable. The output discipline adds an evidence-appendix line (full_name + article/case number + source_path, withdrawal per discipline 7 when the source_path is missing); the existing deliverable-convention line (md → docx tracked changes) stays.
- The tools section adds four cnlaw usage paragraphs: law-text/guideline verification, decision search by rationale (`ground` / `ipc` / `result` / `case_type`), graph navigation (`:8001/api/cnlaw/graph/ground` with optional `ipc`, `/graph/patent`, Neo4j-backed), and the per-case decision chain (`POST /api/cnlaw/case/<id>/decision`, read-by-steps and `/chain`).
- Skills gain `inventive-step-analysis` (the creative-step evidence pack), and `patent-prior-art-search` becomes the cnlaw channel-strategy version (CNIPR → CN publication search/PDF, CNIPA → official status verification, Google Patents → foreign/global, `web_search` → literature, `patent_search` → local fallback, dual-source cross-checking). The other eleven skills keep their shipped content, including the case-governance triad (`patent-matter` / `patent-fact-check` / `patent-compliance-review`).
- Bilingual README documents the cnlaw base as an optional enhancement under Prerequisites and updates the knowledge-base strategy and the first Known Limitation accordingly.
- The user-root `patent-cnlaw` preset is deleted from the owning machine after the merge; that deletion is an environment action and is not part of this repository change.

The cnlaw base remains optional, not a hard dependency: the persona and the README both state the fallback, so a deployment without the local REST services still runs the preset, verifying through the built-in patent tools instead.

## Alternatives considered

- **A user-root preset named `patent` to shadow the shipped one.** Rejected by the discovery contract: roots scan shipped-first and a duplicate id is dropped, so the shipped preset would keep winning and the local directory would silently occupy its id with nothing selecting it.
- **Keeping both entries with renamed display metadata ("base" vs "enhanced").** Rejected: it preserves the duplication the change removes — two prompt bodies and two skill sets to maintain, with the shipped preset continuing to drift.
- **Making the local preset the only mode and removing the shipped one.** Rejected: the shipped preset is part of the app build source and of other deployments; the direction would also drop shipped-side updates (self-evolve benchmark, latest patent-teams toolset).

## Consequences

- The preset now advertises the cnlaw endpoints in its model-facing discipline; a deployment that never runs semantica-cnlaw pays only the fallback path (no hard boot dependency — the REST calls are made at use time and fall back per the discipline text).
- The persona discipline grows by roughly 1.2 KB of prompt text (the four cnlaw paragraphs plus the evidence-appendix line), inside the 64 KB `agent-instructions` ceiling.
- The enhancement now follows repository releases instead of a local snapshot: after rebuilding the desktop app, the picker shows one `patent` entry with the merged superset; the user environment keeps `default: patent` unchanged.
