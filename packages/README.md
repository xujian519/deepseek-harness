---
description: "The DeepSeek Harness package workspace: how the npm packages under packages/ are grouped, what each group owns, and the conventions that bind them."
kind: "package-group"
---

# Packages

English | [中文](README.zh.md)

## Summary

The harness is assembled from npm packages under `packages/`, grouped by capability family: sessions and the agent loop, model-facing tools, shell and filesystem execution, web access, and subagents. Use this page as the top-level map: find the owning group, then open its README for the package list. Every package is scoped `@deepseek-ai/dsh-*` and lives in exactly one group; each group README owns its family's package list.

## Table of Contents

- [Package groups](#package-groups)
- [Release expectations](#release-expectations)
- [Dependencies](#dependencies)
- [Package README contracts](#package-readme-contracts)
- [Dev Note](#dev-note)

-----

<a id="package-groups"></a>
## Package groups

Every package lives in exactly one group; new packages join existing groups, and a new group updates its own README and this table.

| Group | Role |
|---|---|
| [`core/`](core/README.md) | Product API spine: sessions, prompts, tools, agent services, and the concrete loop |
| [`api/`](api/README.md) | Remote BFF assembly and Typert RPC gateway |
| [`typert/`](typert/README.md) | Type graph generation, artifact loading, and runtime registry |
| [`goal/`](goal/README.md) | Same-session goal persistence and lifecycle |
| [`schedule/`](schedule/README.md) | Session-local scheduled follow-ups |
| [`feedback/`](feedback/README.md) | Human feedback capture and command |
| [`identity/`](identity/README.md) | Shared anonymous identity |
| [`llm/`](llm/README.md) | LLM capability family: abstract service + provider adapters |
| [`e2b/`](e2b/README.md) | E2B remote-runtime providers |
| [`subprocess/`](subprocess/README.md) | Subprocess capability family: Service Definition + local process-tree provider |
| [`shell/`](shell/README.md) | Bash capability family: executor seam, local impl, model-facing tools |
| [`terminal/`](terminal/README.md) | Persistent PTY capability family: owner-scoped sessions, local implementation, model-facing tools |
| [`code-runtime/`](code-runtime/README.md) | Code-execution capability family: Service Definition + worker-thread provider + PTC mode Consumer |
| [`sandbox/`](sandbox/README.md) | Process-confinement seam; bwrap/Landlock/Seatbelt backends |
| [`fs/`](fs/README.md) | Filesystem capability family: seam, local impl, model-facing file tools, discovery tools |
| [`lsp/`](lsp/README.md) | LSP capability family: seam, generic stdio provider, and the `lsp` tool |
| [`skill/`](skill/README.md) | Skill capability family: provider registry, local provider, model-facing catalog/loader |
| [`compaction/`](compaction/README.md) | Compaction capability family: Service Definition + basic provider + command Consumer |
| [`context/`](context/README.md) | Model-visible request context: workspace instructions, time context, references |
| [`memory/`](memory/README.md) | External memory and context-database integrations (OpenViking) |
| [`subagent/`](subagent/README.md) | Subagent capability family: provider-registry contract and model-facing delegation tools |
| [`jobs/`](jobs/README.md) | Generic background-job runtime and model-facing job control tools |
| [`experimental/`](experimental/README.md) | Private prototypes and internal-only plugins |
| [`workflow/`](workflow/README.md) | Workflow seam, worker-thread engine, and model-facing `workflow`/`ralph` tools |
| [`webhook/`](webhook/README.md) | Verified external events, trusted rules, and fire-and-forget Workspace Sessions |
| [`web/`](web/README.md) | Web capability family: seam, search/fetch providers, model-facing web tools |
| [`attachment/`](attachment/README.md) | Durable attachment identity, validation, local content-addressed storage |
| [`spill/`](spill/README.md) | Spill capability family: storage seam, local impl, tool-result spill policy |
| [`todo/`](todo/README.md) | The model-facing `todo_write` tool |
| [`plan/`](plan/README.md) | Plan collaboration state with a direct entry command and reviewed exit |
| [`preset/`](preset/README.md) | Per-session agent composition from preset `cordis.yml` files |
| [`document/`](document/README.md) | Document-delivery preset, its six delivery skills, and the delivery studio |
| [`guard/`](guard/README.md) | Loop-hygiene guards: advisory repeat-call reminders + the `tools/execute` deadline enforcer |
| [`bundle/`](bundle/README.md) | Installable `dsh --profile` patch layers |
| [`extensions/`](extensions/README.md) | Agent runtime self-modification and plugin discovery: live inspection, model-written mount/unmount, read-only catalog discovery tools |
| [`self-evolve/`](self-evolve/README.md) | Campaign-based self-evaluation and plugin evolution: durable service, agent-loop provider, benchmark runner, model-facing tools |
| [`hooks/`](hooks/README.md) | Hook bridges + the shared Claude Code / Codex wire-protocol library |
| [`mcp/`](mcp/README.md) | Attach external Model Context Protocol servers so their tools are callable as native tools |
| [`patent/`](patent/README.md) | Patent domain plugins ported from Sati: engines, tools, rule gates, and knowledge access as workspace packages |
| [`session/`](session/README.md) | Durable session data plane: persistence seam + backends, projection seam, log-backed titles, session reporting |
| [`session-query/`](session-query/README.md) | Session retrieval family: logical corpus, bounded reads, lineage, semantic filtering, SQLite full-text search |
| [`settings/`](settings/README.md) | User-settings seam + file-backed provider |
| [`credentials/`](credentials/README.md) | Credential-reference and credential-record seam + env-over-`.env` provider + authorization flows that ask a human |
| [`storage/`](storage/README.md) | Non-session storage hub + backends + domain form |
| [`workspace/`](workspace/README.md) | Workspace entity |
| [`sdk/`](sdk/README.md) | Out-of-process SDK: JSON-RPC protocol and TypeScript client/server |
| [`acp/`](acp/README.md) | Automation-only Agent Client Protocol server |
| [`interaction/`](interaction/README.md) | Human-collaboration plane: approval/interaction seams, permission preset, commands, ask-user tool |
| [`boot/`](boot/README.md) | Shared app-bin boot glue |
| [`browser/`](browser/README.md) | Browser automation backend family: capability probing, cascade routing, link extraction |
| [`host/`](host/README.md) | Web-GUI host half: API gateway + HTTP route server |
| [`client/`](client/README.md) | Web-GUI browser half: shell, wire, object services, slots, `ui-*` plugins |
| [`desktop/`](desktop/README.md) | Desktop OS integration: Service Definition + Electron shell provider + sandboxed directory-picker bridge |
| [`test-support/`](test-support/README.md) | Support infrastructure (testkits, invariants, replay, Loader smokes) |
| [`runtime-diagnostics/`](runtime-diagnostics/README.md) | Runtime diagnostics: package-owned invariant checks and reports |
| [`util/`](util/README.md) | Low-level shared utilities (`Branded<B>`, home/path helpers, timeout, retention); no runtime dependencies, invariant-companion peer only |

-----

<a id="release-expectations"></a>
## Release expectations

Most groups are product — stable API. The exceptions: `e2b/` is a POC, `experimental/` is unreleased, and `test-support/`, `runtime-diagnostics/`, and `util/` are support with lower compatibility expectations.

-----

<a id="dependencies"></a>
## Dependencies

The dependency graph is generated: [docs/module-graph.md](../docs/module-graph.md) (`pnpm run gen-module-graph`, freshness-gated in CI).

**Extension plugins depend on Service Definitions, never concrete providers.** `dsh-agent-loop` is swappable; UI, hook, and tool plugins use `dsh-agent`. Composition bundles may depend on spine plugins. Capabilities separate Service Definition / Service Provider / Consumer roles when they evolve independently; see [capability seams](../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md).

-----

<a id="package-readme-contracts"></a>
## Package README contracts

Every package README covers purpose, configuration, extension points, and [Model Experience](../docs/cookbook/adding-a-package.md#4-write-the-package-readme) unless the model-agnostic [omission allowlist](../scripts/verify-package-readme-model-experience.ts) exempts it. It also carries `## Known Limitations and Deferred Work` or uses its [allowlist](../scripts/verify-package-readme-limitations.ts). Package conventions — exports, service access, invariants, tests — live in [packages/AGENTS.md](AGENTS.md).

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
