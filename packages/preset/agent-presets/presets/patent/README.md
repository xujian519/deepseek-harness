# Patent agent preset

English | [中文](README.zh.md)

The `patent` agent preset composes a Chinese-patent-engineering agent on the DeepSeek Harness. It builds on the `standard` preset and adds the patent domain plugins, twelve preset skills, and a patent-specific persona and plan-mode discipline, assembled per docs/patent-mode-design.md §4–§9 and plan P4.4 of docs/sati-as-dsh-plugins-plan.md. Law text, examination guidelines, and case decisions are verified preferentially against the local cnlaw REST legal base (semantica-cnlaw, see Prerequisites) with source_path provenance, falling back to patent_case_search / patent_kg_query when it is unavailable.

## What it mounts

Beyond the standard coding rows a patent workflow needs (shell, filesystem, jobs, skills, goals, plan mode, compaction, delegation, web), the preset mounts nine patent-domain plugins:

- `@deepseek-ai/dsh-patent-data` — the data seam (ctx.patentData: nuo search provider factory + the ego-browser session runner). patent_pdf_download runs its ego-browser download adapter through this service.
- `@deepseek-ai/dsh-patent-knowledge` — the knowledge.db query service (ctx.patentKnowledge: caseLawSearch / legalSearch / wikiCards / kgSearch / kgGetNode / kgListByType / ipcClassify).
- `@deepseek-ai/dsh-patent-workflow` — the execution-pipeline service (ctx.patentWorkflow: runWorkflow / runPlantask / approve / reject).
- `@deepseek-ai/dsh-patent-tools` — 23 model-facing tools: search, metadata, legal status, case/wiki/kg queries, drafting, claim chart, workflow recap, figure analysis, PDF download, knowledge notes.
- `@deepseek-ai/dsh-patent-teams` — the durable multi-agent team service (ctx.patentTeams) surfacing the eleven `patent_teams_*` tools; with `qualityGate: true` it runs the composite completion gate.
- `@deepseek-ai/dsh-patent-rule` — the rule engine, the output gate on tools/post-execute, and the EVI-011 evidence guards.
- `@deepseek-ai/dsh-patent-document` — render_patent_document.
- `@deepseek-ai/dsh-tool-literature` — paper_search / paper_list_sources.
- `@deepseek-ai/dsh-methodology` — the triz tool.

The patent services sit behind an isolate realm (patentData / patentKnowledge / patentWorkflow / patentTeams) shared with patent-tools, so its ctx.get('patentData') / ctx.get('patentKnowledge') resolve this preset's instances rather than the host's. tool-ralph is omitted (a patent case uses goal / todo / workflow, not fresh-agent iteration), and tool-web keeps fetch disabled because shipped profiles mount no fetch provider (see the base layer comment); a deployment that needs web_fetch adds a provider itself, e.g. `dsh plugin --profile patent add @deepseek-ai/dsh-web-fetch-http`.

The preset also mounts `@deepseek-ai/dsh-self-evolve-benchmark` behind its own isolate realm (selfEvolveBenchmark): the benchmark-driven self-evolve provider, programmatic only — no model-facing tool. Its `agentStateDir` points at the seeded `patent-state` work copy under the data root (examples/patent-oas in the package), never the caller's working directory, so a real docket or knowledge base can never be snapshotted or rewritten by an optimize loop.

## Skills

Twelve skills ship in skills/:

- patent-disclosure-understanding
- patent-prior-art-search
- patent-novelty-inventiveness
- patent-infringement
- patent-invalidity
- patent-quality-gate
- patent-workspace-layout
- patent-team-composition
- inventive-step-analysis
- patent-matter
- patent-fact-check
- patent-compliance-review

`patent-team-composition` is the durable-team template: this session mounts the `dsh-patent-teams` plugin (`patent_teams_*` tools), so cases pick one of seven scenario role packs covering the full patent lifecycle — case intake (case-manager / researcher / technical-expert / drafter), drafting (researcher / drafter / adversarial-reviewer / technical-expert / applicant-counsel), office-action response (same five), correction (drafter / formal-examiner), reexamination (researcher / drafter / adversarial-reviewer / applicant-counsel / adjudicator), invalidation (researcher / drafter / technical-expert / invalidity-petitioner / patentee-defender / adjudicator), and infringement litigation (researcher / drafter / technical-expert / patentee-defender / defendant-counsel / adjudicator, plus optional tech-investigator) — led by the current session as captain; only when the plugin is disabled does it fall back to single-session `subagent_fork` expert review. The reexamination, invalidation, and litigation packs use the adversarial structure of paired positions plus a neutral adjudicator.

The novelty/inventiveness, infringement, and invalidity skills are rewritten from the Sati skills patent-novelty-analysis, patent-inventiveness-analysis, patent-infringement-checker, and patent-invalidity-checker. Sati tool references (patent_kg_query / patent_case_search / law_search) are replaced by the dsh patent tools, the <memory-context> auto-injection is replaced by explicit must-check lists, and Sati-internal file paths are replaced by workspace-relative paths.

## Knowledge-base strategy

Per plan P4.4, system knowledge reads dsh-patent-knowledge: case law, wiki cards, and the knowledge graph through patent_case_search / patent_wiki_search / patent_kg_query, with law text verified preferentially against the local cnlaw REST base (:8100 /search, source_path provenance) and, when cnlaw is unavailable, through patent_case_search plus web_fetch on authoritative sources when a fetch provider is mounted. The workspace `99-知识库/` directory stays project-level accumulation, recalled with fs-search / grep before going online.

This revises docs/patent-mode-design.md §9, which described a no-engine file library. `99-知识库/` remains project accumulation; the change is that system knowledge now has an engine.

## Prerequisites

The knowledge tools require a knowledge.db. Install one with the patent-knowledge-install bin, or point Config.sourceDbPath at an existing knowledge.db; see packages/patent/patent-knowledge/README.md. Without a database the knowledge tools fail loud at execute time.

The cnlaw legal base is an optional enhancement: when the local semantica-cnlaw REST services (:8100 search, :8001 graph/case API) and Neo4j (7687) run on the host, law text, examination guidelines, and case decisions are verified through cnlaw with source_path provenance; without them the discipline falls back to patent_case_search / patent_kg_query (see Known Limitations).

## Model Experience

The model sees the Chinese patent-agent persona (professional identity, seven work disciplines, the standard workflow, and the output discipline with its mandatory disclaimer), the patent plan-mode section, the seven preset skills, and the patent tools plus the standard coding tools. The persona requires verify-before-cite (web_fetch on every fact when mounted), separate comparison, per-feature comparison with citations, and a mandatory disclaimer on every analysis output.

## Known Limitations and Deferred Work

- Legal-text search (ctx.patentKnowledge.legalSearch) has no model-facing tool; law text is verified preferentially against the local cnlaw REST base (an optional deployment enhancement, see Prerequisites) and otherwise through patent_case_search plus web_fetch (when a fetch provider is mounted) and the `99-知识库/` baseline. Shipped profiles mount no fetch provider (SSRF protection is deferred), so web_fetch fails with WEB_PROVIDER_UNAVAILABLE until one is added.
- patent_pdf_download requires a working ego-browser (ego lite) on the host: the ego-browser CLI must be installed and on the PATH (macOS only), or the tool fails loud with setup guidance. knowledge_note_save writes files under the workspace `99-知识库/` directory (a native knowledge.db write API is deferred).
- The 4 rewritten analysis skills inherit Sati's methodology but have not yet been reviewed against current Chinese patent practice; cross-check their checklists against the user's patent-legal baseline before relying on them.
- The design doc's `~/.agents/skills/patent-legal/_shared/patent-law-baseline-2024.md` is a Sati user-level asset not shipped here; law text is verified at use time instead.
- The self-evolve benchmark is programmatic only: `ctx.selfEvolveBenchmark` mounts no model-facing tool; establish-baseline / optimize loops run from an operator or script that resolves the service for an agent. Its default seams fork children over the host subagents registry, so a child inherits this preset's approval setting (`'never'`) and plan-mode discipline — approval-gated operations are refused in children, and the executor prompt explicitly exits plan semantics so a deliverable can be produced directly.