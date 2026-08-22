# Agent Note: Wire dsh-patent-teams into the patent preset and unify the tool names

Status: implemented

English | [中文](2026-08-23-wire-patent-teams-into-preset.zh.md)

## Problem

`dsh-patent-teams` (`packages/patent/patent-teams`) was ported as a complete, tested workspace package but never mounted: it was absent from `apps/cli/package.json`, from the patent preset `agent.cordis.yml`, and from `docs/tool-catalog.md`. Meanwhile the patent preset's `persona` and the `patent-team-composition` skill referenced the upstream `@nanmicoder/dsh-agent-teams` plugin by its `agent_teams_*` tool names and "when the environment provides" caveat — but no such plugin is installed anywhere in the workspace, so the team workflow the preset advertises could never actually run. The durable multi-agent team capability was dead-on-arrival at the composition layer.

## Decision

Wire the ported package as the preset's team backend and rename every upstream tool reference to the patent-domain names it actually registers:

- **Dependency**: add `@deepseek-ai/dsh-patent-teams` to `apps/cli/package.json` (`workspace:^`); refresh `pnpm-lock.yaml` via `--no-frozen-lockfile`.
- **Mount**: add a `patent-teams` row to the `patent` group in `apps/cli/config/agent-presets/patent/agent.cordis.yml`, and add `patentTeams: true` to that group's `isolate`. The group already isolates the other patent services; a preset service must sit behind an `isolate` realm or `dsh-agent-presets` rejects it at mount (`packages/preset/agent-presets/src/mount.ts` `leakedServices`).
- **Tool names**: update the `persona` line, `patent-team-composition/SKILL.md`, and both preset READMEs to `patent_teams_*` and `@deepseek-ai/dsh-patent-teams`, replacing the "when the environment provides ..." caveat with "this session mounts dsh-patent-teams" (fallback to `subagent_fork` only when the plugin is disabled).
- **Catalog**: add `@deepseek-ai/dsh-patent-teams` to `scripts/gen-tool-catalog.ts` `TOOL_PACKAGES`, booting it over the same `SubagentRuntime`+mock-provider recipe the other subagent packages use, so all ten `patent_teams_*` tools land in `docs/tool-catalog.md` (EN + manually-maintained ZH) and the catalog generator's completeness guard stays satisfied.
- **Member tool access**: assert in `patent-teams/tests/members.spec.ts` that the member `toolFilter.deny` contains the captain-only `patent_teams_*` management tools but excludes a patent-capability tool like `patent_search` — a member executes real patent work through the shared tool registry.

The `patentTeams` service key, `patent-teams/*` event names, and `.patent-teams/` state directory are left unchanged (already registered in `gen-cordis-catalog.ts` / `gen-doc-graphs.ts`).

## Alternatives considered

**Register `patent-teams` only in apps/cli, not the preset.** Rejected: without the preset row, no patent session would mount it; the dependency alone is insufficient. The preset row plus isolate realm is what makes the capability reachable.

**Keep the `agent_teams_*` names and hand-edit the skill/persona to point at the absent plugin.** Rejected under the pre-release stance: the tool set is already re-scoped to `patent_teams_*` (recorded in the port Agent Note), so the preset and skill must name what actually registers.

**Boot the full patent preset in a mount-level test.** Rejected: the preset composes only over the full host stack (shell/fs/jobs/web/sandbox/...), so an isolated mount test cannot run; `verify-cordis-config` is the composition gate for the preset, and `patent-teams`' own Loader/HMR/coverage suites cover the plugin.

## Consequences

- `apps/cli` now depends on `dsh-patent-teams`; `pnpm-lock.yaml` records the link.
- The patent preset mounts `dsh-patent-teams` behind `isolate.patentTeams`, so `patent_teams_*` tools and `ctx.patentTeams` are available per patent session without leaking into the root realm.
- `docs/tool-catalog.md` (EN) is regenerated and lists all ten `patent_teams_*` tools; `docs/tool-catalog.zh.md` mirrors the new section with translated prose (JSON-schema `description` fields stay English per the catalog's pairing convention); `docs/tool-catalog.i18n.yaml` hashes re-recorded.
- `packages/core/tools/tests/gen-tool-catalog.spec.ts` expected-tool list updated for the newly harvested names; `patent-teams/tests/members.spec.ts` extended to pin member retention of patent-capability tools.
- Downstream wiring (role→worker-contract mapping, task→manifest handoff, member-output quality gates) remains deferred and each depends on this mount being live first.

## Non-attributable failures (waiting on the concurrent window)

These repository-wide gates are red on this worktree but are **not attributable to this change**; their failing entries all name the concurrently in-progress `self-evolve` window's packages (`docs/sati-as-dsh-plugins-plan.md` §13.2 recorded those as the other window's uncommitted shared-file changes). This change touches none of them; the patent preset is absent from every failure list. They should be re-validated after the `self-evolve` window lands; do not treat them as a regression of the wiring here:

- `verify-cordis-config` — only `packages/bundle/web-app/cordis.patch.yml` `@deepseek-ai/dsh-host-synapse` / `@deepseek-ai/dsh-client-synapse` fail to resolve through `tsconfig.base.json` paths.
- `verify-config-catalog` — stale `docs/config-catalog.md` (new rows for `dsh-host-synapse` / `dsh-client-synapse` / `dsh-self-evolve-eval`).
- `verify-doc-graphs` — stale `docs/event-producer-consumer.md` (rows for `synapse` / `self-evolve` / `self-evolve-basic`).
- `verify-package-readme-model-experience` — `packages/client/synapse`, `packages/test-support/self-evolve-eval`, `packages/web/synapse` lack complete model-context entries.

All attributable checks for this change pass (`tsc -b packages/patent/patent-teams`, the `patent-teams` suite, `gen-tool-catalog.spec.ts`, `verify-tool-catalog`, `verify-md-links`, `verify-md-wrap`, `verify-package-paths`, the agent-note gates, and the translation pairs).
