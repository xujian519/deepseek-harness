# Agent Note: dsh-agent-teams ported as the dsh-patent-teams workspace package

Status: implemented

English | [中文](2026-08-19-patent-teams-workspace-package.zh.md)

## Problem

The patent preset relied on the upstream `@nanmicoder/dsh-agent-teams` plugin (installed per-profile, source surveyed under `~/.sati/调研/DeepSeek-Harness/源码素材-dsh-agent-teams`) for durable multi-agent teams. patent-workbench-tasks.md phase-4 decision recorded "install the original plugin, adapt at preset layer, do not fork"; the user then directed a formal workspace-package port (`dsh-patent-teams`), which requires the repository plugin discipline: Service Definition / Consumer separation, unit tests at the 100% coverage gate, bilingual README, package invariant, and manifest registration.

## Decision

Land `packages/patent/patent-teams` (`@deepseek-ai/dsh-patent-teams`) as a host-plane plugin:

- **Service Definition**: `ctx.patentTeams` (`PatentTeamsService`) owns team CRUD, the task state machine with `attempt_id` revocation and handoff quiescence, member lifecycle (spawn/interrupt/retire), mailbox persistence, archive-on-delete, and scheduler kicks.
- **Consumer**: ten `patent_teams_*` tools (renamed from `agent_teams_*`) register through `ctx.patentTeams`; the tools file is a thin schema/render layer.
- **Domain scoping**: state directory defaults to `.patent-teams/`, session events are `patent-teams/*` (invariant-validated), member label prefix `patent-teams:`.
- **Deliberately not ported**: the upstream Web activity-panel/artwork routes and the `client/` bundle (v1 is tool- and service-only; documented under Known Limitations).
- **Source hygiene**: the port starts from the simplified upstream copy (deduped `isEnoent`/`scanTeams`/scope helpers, lock-table cleanup, shared `stateRootOf`/`teamLockKey`) and adapts it to the repo's strict mode (`exactOptionalPropertyTypes` fixes use conditional spreads / `delete`).
- Registration: `tsconfig.host.json` references entry, `packages/patent/README.md` row, pnpm lockfile via `--no-frozen-lockfile`.

## Alternatives considered

**Keep installing the upstream npm plugin.** Rejected by the user's directive; the formal package also removes the per-profile install step and gives the harness a reviewed, domain-scoped implementation.

**Port with a full capability trio split into separate Definition/Provider/Consumer packages.** Rejected: the tools are the only consumer and the member provider is a config value over the existing `ctx.subagents` seam; one package matches "a single-purpose plugin stays one package".

**Keep the `agent_teams_*` names for compatibility.** Rejected under the pre-release stance: the patent domain owns `patent_teams_*` naming; existing archived team data under `.agent-teams/` is runtime data, not a wire format.

## Consequences

- `tsc -b packages/patent/patent-teams` and the host aggregate pass.
- `pnpm run verify-translation-pairing`: patent-group README and the new package README pairs recorded.
- Unit tests (per-file 100% coverage) land in `tests/` via a dedicated subagent pass; `pnpm run test:coverage` for the package is the CI gate.
- The `patent` preset still mounts the upstream plugin today; switching the preset row to `@deepseek-ai/dsh-patent-teams` (and updating the `patent-team-composition` skill's tool names) is the follow-up, owned by the deployment window.
