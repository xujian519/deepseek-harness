# Patent agent preset

English | [中文](README.zh.md)

The `patent` agent preset composes a Chinese-patent-engineering agent on the DeepSeek Harness. It builds on the `standard` preset and adds the patent domain plugins, fifteen preset skills, and a patent-specific persona and plan-mode discipline, assembled per docs/patent-mode-design.md §4–§9 and plan P4.4 of docs/sati-as-dsh-plugins-plan.md. Law text, examination guidelines, and case decisions are verified preferentially against the local cnlaw REST legal base (semantica-cnlaw, see Prerequisites) with the returned source_path recorded, falling back to patent_case_search / patent_kg_query when it is unavailable.

## What it mounts

Beyond the standard coding rows a patent workflow needs (shell, filesystem, jobs, skills, goals, plan mode, compaction, delegation, web), the preset mounts eleven further plugins — the patent-domain services and tools plus the literature and methodology rows the patent skills call:

- `@deepseek-ai/dsh-patent-data` — the data seam (ctx.patentData: nuo search provider factory + the ego-browser session runner). patent_pdf_download runs its ego-browser download adapter through this service.
- `@deepseek-ai/dsh-patent-knowledge` — the knowledge.db query service (ctx.patentKnowledge: caseLawSearch / legalSearch / wikiCards / kgSearch / kgGetNode / kgListByType / ipcClassify).
- `@deepseek-ai/dsh-patent-workflow` — the execution-pipeline service (ctx.patentWorkflow: runWorkflow / runPlantask / approve / reject).
- `@deepseek-ai/dsh-patent-tools` — 29 model-facing tools: search, metadata, legal status, case/wiki/kg queries, claim-chart, office-action parsing, drafting, analysis reports, evidence judgment, rule checking, figure generation, PDF download, knowledge notes, and the workflow/plan state machines.
- `@deepseek-ai/dsh-patent-teams` — the durable multi-agent team service (ctx.patentTeams) surfacing the eleven `patent_teams_*` tools; with `qualityGate: true` it runs the composite completion gate.
- `@deepseek-ai/dsh-patent-rule` — the rule engine, the output gate on tools/post-execute, and the EVI-011 evidence guards.
- `@deepseek-ai/dsh-patent-document` — render_patent_document.
- `@deepseek-ai/dsh-patent-deadline` — patent_deadlines: the statutory and designated deadlines of a case, with the 专利法实施细则 period and delivery rules and a shipped holiday calendar for rest-day roll-forward.
- `@deepseek-ai/dsh-writing-patterns` — query_writing_patterns over the packaged drafting/office-action pattern corpus, plus the system-prompt section carrying the compiled `<writing_skills>` block.
- `@deepseek-ai/dsh-tool-literature` — paper_search / paper_list_sources.
- `@deepseek-ai/dsh-methodology` — the triz tool.

The patent services sit behind an isolate realm (patentData / patentKnowledge / patentWorkflow / patentTeams) shared with patent-tools, so its ctx.get('patentData') / ctx.get('patentKnowledge') resolve this preset's instances rather than the host's. tool-ralph is omitted (a patent case uses goal / todo / workflow, not fresh-agent iteration), and tool-web enables fetch because every shipped composition mounts the http fetch provider (`dsh-base` composes `dsh-web-fetch-http` with `fetchProvider: http`, and no bundle disables it), which lets the verify-before-cite rule open a source page instead of trusting a summary.

The preset also mounts `@deepseek-ai/dsh-self-evolve-benchmark` behind its own isolate realm (selfEvolveBenchmark): the benchmark-driven self-evolve provider, programmatic only — no model-facing tool. Its `agentStateDir` points at the seeded `patent-state` work copy under the data root (examples/patent-oas in the package), never the caller's working directory, so a real docket or knowledge base can never be snapshotted or rewritten by an optimize loop.

## Skills

Fifteen skills ship in skills/:

- patent-disclosure-understanding
- patent-prior-art-search
- patent-novelty-inventiveness
- patent-infringement
- patent-invalidity
- patent-oa-response
- patent-reexamination
- patent-quality-gate
- patent-workspace-layout
- patent-team-composition
- inventive-step-analysis
- patent-matter
- patent-fact-check
- patent-compliance-review
- patent-document-polish

`patent-team-composition` is the durable-team template: this session mounts the `dsh-patent-teams` plugin (`patent_teams_*` tools), so cases pick one of seven scenario role packs covering the full patent lifecycle — case intake (case-manager / researcher / technical-expert / drafter / document-specialist), drafting (researcher / drafter / adversarial-reviewer / technical-expert / applicant-counsel / document-specialist), office-action response (same six), correction (drafter / formal-examiner / document-specialist), reexamination (researcher / drafter / adversarial-reviewer / applicant-counsel / adjudicator / document-specialist), invalidation (researcher / drafter / technical-expert / invalidity-petitioner / patentee-defender / adjudicator / document-specialist), and infringement litigation (researcher / drafter / technical-expert / patentee-defender / defendant-counsel / adjudicator / document-specialist, plus optional tech-investigator) — led by the current session as captain; the document-specialist (`document-specialist`) owns the scenario-mapped deliverable before closure (correction and beautification only, never substantive conclusions); only when the plugin is disabled does it fall back to single-session `subagent_fork` expert review. The reexamination, invalidation, and litigation packs use the adversarial structure of paired positions plus a neutral adjudicator.

`patent-document-polish` is the deliverable-output discipline: pick the scenario template (patentability opinion / search report / OA response / claims-spec / rectification response / re-examination request / invalidation opinion / infringement opinion / litigation pleading), correct (terminology consistency, law-citation format that records the source, numbers/dates/deadlines, numbering levels, legal salutations), and beautify (template rendering, brand injection, A4 layout, md draft → html/pdf or docx), with the delivery release merged into one quality-gate confirmation.

The novelty/inventiveness, infringement, and invalidity skills are rewritten from the Sati skills patent-novelty-analysis, patent-inventiveness-analysis, patent-infringement-checker, and patent-invalidity-checker. Sati tool references (patent_kg_query / patent_case_search / law_search) are replaced by the dsh patent tools, the <memory-context> auto-injection is replaced by explicit must-check lists, and Sati-internal file paths are replaced by workspace-relative paths. The infringement, invalidity, office-action-response, and reexamination skills now drive the real tool faces: claim_chart_build for the element-level chart, parse_office_action for the office-action parse, and patent_workflow_run with patent_infringement_v1 / patent_invalidation_v1 / patent_oa_response_v1 / patent_reexamination_v1 for the deterministic stages, the approval gate, and the run record. `patent-oa-response` and `patent-reexamination` are new here rather than ported.

## Knowledge-base strategy

Per plan P4.4, system knowledge reads dsh-patent-knowledge: case law, wiki cards, and the knowledge graph through patent_case_search / patent_wiki_search / patent_kg_query, with law text verified preferentially against the local cnlaw REST base (:8100 /search, with source_path recorded) and, when cnlaw is unavailable, through patent_case_search plus web_fetch on authoritative sources. The workspace `99-知识库/` directory stays project-level accumulation, recalled with fs-search / grep before going online.

This revises docs/patent-mode-design.md §9, which described a no-engine file library. `99-知识库/` remains project accumulation; the change is that system knowledge now has an engine.

## Prerequisites

The knowledge tools require a knowledge.db. Install one with the patent-knowledge-install bin, or point Config.sourceDbPath at an existing knowledge.db; see packages/patent/patent-knowledge/README.md. Without a database the knowledge tools fail loud at execute time.

The cnlaw legal base is an optional enhancement: when the local semantica-cnlaw services (:8100 search, :8001 graph/case API) and Neo4j (7687) run on the host, law text, examination guidelines, and case decisions are verified through cnlaw with source_path recorded; without them the discipline falls back to patent_case_search / patent_kg_query (see Known Limitations). A deployment that additionally mounts the cnlaw MCP bridge (`@deepseek-ai/dsh-mcp-client` over `cnlaw_mcp_launcher.py`) reaches the :8001 graph, case, and inventive-step endpoints as `mcp__cnlaw__*` tools, which the persona names first; the :8100 semantic-search and :8001 IPC endpoints have no tool and stay on REST through curl.

OpenViking long-term memory is a separate opt-in: the preset ships an `openviking` row with `disabled: true`. A deployment that runs an OpenViking service (see [`@deepseek-ai/dsh-openviking`](../../../../memory/openviking/README.md)) duplicates this preset, drops `disabled`, and sets the endpoint and identity headers through `dsh plugin --profile <name> config openviking.endpoint=…` plus `.account` / `.user` / `.agentId` / `.apiKey`; the shipped preset carries no credentials. Recalled text enters the prompt as untrusted background data, so the persona's verify-before-cite discipline still requires source_path from cnlaw or patent_case_search for every legal assertion — OpenViking never replaces the legal base.

## Model Experience

The model sees the Chinese patent-agent persona (professional identity, seven work disciplines, the standard workflow, the case-type routing table, and the output discipline with its mandatory disclaimer), the patent plan-mode section, the fifteen preset skills, and the patent tools plus the standard coding tools. The persona requires verify-before-cite (web_fetch on every fact), separate comparison, per-feature comparison with citations, and a mandatory disclaimer on every analysis output.

## Known Limitations and Deferred Work

- Legal-text search (ctx.patentKnowledge.legalSearch) has no model-facing tool; law text is verified preferentially against the local cnlaw base (an optional deployment enhancement, see Prerequisites) — its MCP tools where mounted, REST through curl otherwise — and otherwise through patent_case_search plus web_fetch and the `99-知识库/` baseline. Shipped compositions mount the http fetch provider (public HTTP(S) destinations only, each destination resolved, validated, and pinned), so web_fetch works without a deployment change.
- patent_pdf_download uses the ego-browser download intercept when the host has a usable ego-browser (ego lite, macOS, on the PATH); without one it falls back to scraping each page for its CDN PDF link and fetching it over HTTP, so a batch still downloads. A download that fails after both channels reports per-patent errors instead of aborting the batch. knowledge_note_save writes files under the workspace `99-知识库/` directory (a native knowledge.db write API is deferred).
- The 4 rewritten analysis skills inherit Sati's methodology but have not yet been reviewed against current Chinese patent practice; cross-check their checklists against the user's patent-legal baseline before relying on them.
- `patent-oa-response` and `patent-reexamination` are new here, not ported: their step order follows the patent_oa_response_v1 / patent_reexamination_v1 manifests and their deadlines come from patent_deadlines, but neither has been reviewed against the current 审查指南 in practice. The reexamination skill keeps a hit inventiveness ground for a utility model and reports the patent subject separately instead of dropping the ground; that handling is recorded in the workbench plan as still awaiting confirmation.
- The design doc's `~/.agents/skills/patent-legal/_shared/patent-law-baseline-2024.md` is a Sati user-level asset not shipped here; law text is verified at use time instead.
- The self-evolve benchmark is programmatic only: `ctx.selfEvolveBenchmark` mounts no model-facing tool; establish-baseline / optimize loops run from an operator or script that resolves the service for an agent. Its default seams fork children over the host subagents registry, so a child inherits this preset's approval setting (`'never'`) and plan-mode discipline — approval-gated operations are refused in children, and the executor prompt explicitly exits plan semantics so a deliverable can be produced directly.