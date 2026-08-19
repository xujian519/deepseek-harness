# Agent Note: Sati patent domain as dsh plugins

Status: implemented

English | [中文](2026-08-17-sati-patent-domain-dsh-plugins.zh.md)

## Problem

Sati shipped a complete patent domain (search, case-law/wiki/knowledge-graph queries, claim-chart, drafting, specification validation, evidence judgment, rule gate, figure analysis, PDF download, workflow/plan state machines) as one process with its own model plumbing and tool registry. The harness had no patent capability, and bridging the Sati process via MCP duplicated state and model routes. The port needed to keep every model-visible surface (tool schemas, results, session events) native to dsh while preserving Sati's behavior so spec-ported tests prove equivalence.

## Decision

**Port the Sati patent domain as workspace packages (Route A: native port, zero Sati process, no MCP bridge)**, executing docs/sati-as-dsh-plugins-plan.md P0–P4. Nine packages land under packages/patent/ (patent-data, patent-knowledge, patent-core, patent-workflow, patent-tools, patent-rule, patent-document, tool-literature, methodology; patent-core is a pure library) plus vendor/nuo-patent (prebuilt Sati patent search engine, MIT) and an agent preset at apps/cli/config/agent-presets/patent/. Engines are ported verbatim and adapted only where dsh strictness or seams require; the knowledge.db (~3.5 GB) is never committed — patent-knowledge:install trims a local source copy. System knowledge reads dsh-patent-knowledge while 99-知识库/ stays project-level accumulation (plan P4.4 over patent-mode-design.md §9).

## Alternatives considered

**MCP bridge keeping the Sati process.** Rejected by the plan's §1.1 decision revision: a second process duplicates approval, model routing, and session logging, and the patent tools must work inside dsh's own tool guard and post-execute seams (EVI-011, output gate).

**Hand-rewriting engines instead of porting.** Rejected: Sati's engines (graph, atoms, checkers, rule pack, evidence rules) carry tested behavior; the plan's equivalence tests demand identical outputs on identical fixtures, so engines are ported verbatim with explicit adaptation points (strict-flag fixes, ctx.subprocess, defineTool render split, md-wrap description normalization).

## Consequences

- 855 unit tests / 111 files (10 Sati spec ports + service/composition/HMR-safety tests); all 9 patent packages pass tsc -b; every gate attributable to this work is green (verify-md-links, verify-md-wrap, verify-package-paths, verify-translation-pairing tool-catalog pair, verify-type-equiv 385, verify-dsh-package-licenses, verify-package-invariants, verify-persistence-catalog after the patent session events joined the generated vocabulary).
- Review fixes (2026-08-18): `registerBuiltinAtoms()` runs in the patent-tools apply and the patent-workflow service constructor, so atom-bearing manifests execute instead of fail-fast; the 6 built-in manifests' approval stages declare `atom: 'approval-gate'` (real HITL), and the workflow tools drive atom-less stages through a real LLM chain executor instead of echoing the input; the approval-grant marker stays on a per-handler state copy and cannot leak to later ungranted gates; the LLM route falls back to the deployment default (`agentDefaultModel`) when Config omits provider/model; `runPlantask` cleans up its pending entry when approval throws; graph nodes enforce a hard timeout deadline and thread the cancellation signal and per-call temperature/schema into the model port; the message-level output gate, `setup_required` error codes, and EVI-011 overseas translation scope were aligned with the wiring.
- Known deviations: the tool-catalog generator cannot run while packages/self-evolve is unregistered (foreign concurrent work) — patent rows/sections were patched by hand to the generator's render format, and the patent-document manifest entry mounts LocalSubprocessRuntime (without it the boot harvests zero tools and assertToolsHarvested throws); RuleOutputGate/RuleOutputGateResult live in patent-core/src/rule/types.ts (single home, patent-workflow re-exports); §7 live keyed runs and a keyless patent snapshot are not exercised in this environment (no DEEPSEEK_API_KEY) — unit coverage plus Sati-spec ports stand in, documented in the plan record.
- Remaining repo reds are all foreign self-evolve incompleteness (missing READMEs, self-evolve-loop/* JSDoc violations, cordis.patch.yml refs, broken tsconfig.host.json refs) and are owned by another window.
