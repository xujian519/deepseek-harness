---
description: "Native port of the Sati patent domain into harness plugins per [docs/sati-as-dsh-plugins-plan.md](../../docs/sati-as-dsh-plugins-plan.md): no Sati process and no MCP bridge — the patent engines, tools, rule gates, and knowledge access run as `@deepseek-ai/dsh-patent-*` workspace packages."
kind: "package-group"
---

# patent/ — Sati patent-domain capability family

English | [中文](README.zh.md)

## Summary

The patent group is the native port of the Sati patent domain into harness plugins per `docs/sati-as-dsh-plugins-plan.md`: no Sati process and no MCP bridge — the patent engines, tools, rule gates, and knowledge access run as `@deepseek-ai/dsh-patent-*` workspace packages. The table below maps each package's half, and child READMEs own each package contract.

## Packages

Native port of the Sati patent domain into harness plugins per [docs/sati-as-dsh-plugins-plan.md](../../docs/sati-as-dsh-plugins-plan.md): no Sati process and no MCP bridge — the patent engines, tools, rule gates, and knowledge access run as `@deepseek-ai/dsh-patent-*` workspace packages.

| Package | Role | ctx key |
|---|---|---|
| [`patent-data/`](patent-data/README.md) | Patent data access: nuo-patent mapping/search provider + ego-browser subprocess provider. | `patentData` |
| [`patent-knowledge/`](patent-knowledge/README.md) | knowledge.db queries: case-law FTS, legal, wiki cards, knowledge graph + install command. | `patentKnowledge` |
| [`patent-core/`](patent-core/README.md) | Pure patent-domain library: ModelPort, atoms, checker, claim-chart, problem, evidence, reasoning, graph. | — |
| [`patent-workflow/`](patent-workflow/README.md) | Execution pipeline: workflow/flexible-plan/plantask state machines + HITL approval. | `patentWorkflow` |
| [`patent-tools/`](patent-tools/README.md) | Model-facing patent tool set (search/metadata/legal-status/case-search/draft/render/rule-check). | (registers on `ctx.tools`) |
| [`patent-teams/`](patent-teams/README.md) | Durable multi-agent teams: captain-led members, dependency-aware tasks, mailbox messaging, shared-task scheduler. | `patentTeams` |
| [`patent-rule/`](patent-rule/README.md) | Rule engine, compliance assets, output gates on `tools/post-execute`. | (policy plugin) |
| [`patent-document/`](patent-document/README.md) | Patent document rendering: templates, brand injection, PDF. | (registers on `ctx.tools`) |
| [`patent-deadline/`](patent-deadline/README.md) | Patent deadlines: period arithmetic, delivery dates, holiday roll-forward. | (registers on `ctx.tools`) |
| [`patent-index-asset/`](patent-index-asset/README.md) | Shipped-index asset format shared by the law and fee indexes: YAML mapping step, strict field readers, recorded source fields. | (pure library) |
| [`patent-law/`](patent-law/README.md) | Law index and citation checking: reference parsing, the source recorded per entry, the law_verify tool. | (registers on `ctx.tools`) |
| [`patent-fees/`](patent-fees/README.md) | Fee index and pricing: the items a case owes, fee reduction, annual-fee tiers and the surcharge rule, the patent_fees tool. | (registers on `ctx.tools`) |
| [`writing-patterns/`](writing-patterns/README.md) | Writing-pattern corpus, lexical selection, `<writing_skills>` compilation, quality scoring. | (registers on `ctx.tools` + section) |
| [`tool-literature/`](tool-literature/README.md) | Literature connectors: arXiv/OpenAlex/Semantic Scholar/Crossref. | (registers on `ctx.tools`) |
| [`methodology/`](methodology/README.md) | TRIZ 40 principles + 39x39 contradiction matrix. | (section + tool) |

Child READMEs own each package contract.

## Related documentation

- [Patent domain subsystem](../../docs/subsystems/patent.md) — domain model, evidence, and workflow contracts across the family.
