# Agent Note: Map patent team roles to worker contracts (soft mapping)

Status: implemented

English | [中文](2026-08-23-role-worker-contract-mapping.zh.md)

## Problem

A patent team member's `role` is a free-form string on `TeamMember` and has two consumers only: one sentence in the member persona (`with the role: X`) and one column in `patent_teams_status`. The preset skill gives each role a stance and a responsibility list, but the captain conveys it as a hand-written "role briefing" message. Nothing constrains or verifies the role. Separately, `patent-workflow` ships a declarative `WorkerContract` catalog (`defaultPatentWorkers`, `allowedTools` / `outputs.requiredFields` / `triggersHITL` / `canInvoke`) whose only consumer is the standalone `patent_worker_validate` tool — the contract never constrains team members, task dispatch, or task acceptance. So a team role carries a described duty with no contract, and the existing contract has no team-side consumer.

## Decision

Build a soft role→contract mapping (contract guidance + task acceptance), leaving tool whitelists and scheduler dispatch unchanged:

- **Contract data lives in `patent-workflow`** (it is already the contract home). Add `src/role-contracts.ts` defining `RoleStance`, `RoleContract` (role / name / stance / description / workers / forbiddenActions / triggersHITL), `defaultRoleContracts()` (all 12 preset roles), `roleContract()`, `roleWorkers()`, `workerDeliverables()` (the flat required-deliverable string the persona/status render), and `workerContract()`. `roleWorkers` fails loud when a role references an unknown worker. Extend `defaultPatentWorkers()` with 7 new role-facing workers (case-manager, applicant-counsel, formal-examiner, invalidity-petitioner, patentee-defender, defendant-counsel, adjudicator, tech-investigator); 4 existing workers are reused by role (`patent-search-commander`, `patent-technical-analyzer`, `patent-oa-writer`, and the novelty/inventiveness analyzers). `role-contracts.ts` re-exports through the package index.
- **`patent-teams` consumes the contracts.** Add a `@deepseek-ai/dsh-patent-workflow` peer+dev dependency and a `tsconfig` project reference. On `addMember(role)` resolve `roleContract` and fold it into the member persona as a "Role contract" section (stance, flat required-deliverable fields, forbidden actions, HITL flag); an unknown or empty role keeps the current persona shape. `createTask` accepts an optional `worker` and rejects an unknown worker name loudly. On `updateTask` completion with a `worker` and an output, run `validateWorkerOutput` and record the verdict on the task (`contractValidation`) plus a `patent-teams/task-validated` event — soft only, never blocking `completed`. `patent_teams_status` carries each member's role-contract summary and each task's worker/validation row.
- **Documentation**: the preset skill's role table gains a "role contract" column and step 4 drops the full role-briefing message in favor of case context (the persona now carries the contract).

## Alternatives considered

**White-list shrink (`toolFilter.allow` per role).** Left as a separate effort: it would materially change member capability edges and require composing a per-role union of required tools plus the team-lifecycle tools a member must keep; `tools.restrict()` filters the inherited surface and never a scope's own layer, so the whitelist must name everything a member answers through. The soft mapping delivers the role boundary guidance now without that blast radius.

**Worker as an executable unit (tasks carry a worker contract; members run input→process→output→approval).** Left for its own effort: it rewrites the team task model and threads `patent-workflow`'s manifest/handler pipeline into member execution, which is the largest change of the three.

## Consequences

- `patent-teams` now depends on `patent-workflow` (peer+dev); the dependency is one-directional and the `tsconfig` reference is the source-plane link.
- Members that carry a known role get an explicit, non-silent role contract instead of a single adjective; `patent_teams_add_member` documents the role ids. Unknown roles still spawn with the generic persona (backward compatible).
- `TeamTask` gains optional `worker` / `contractValidation`; `patent-teams/task-validated` is a new event type whose payload stays within the existing `patent-teams/*` convention. `patent_teams_status` surfaces role deliverables and the acceptance verdict for captains.
- The soft boundary is a known limit: members still inherit the full patent tool set (only the captain-only management tools are denied), so role overreach remains model-driven — the mapping raises the boundary from "implicit" to "stated and checkable" but does not enforce it.
- `workerDeliverables(role)` is the single renderer for the persona/status deliverables column (both `members.roleSection` and the service's `contractSummary` consume it), replacing the duplicated inline `flatMap` and its non-null assertions; an unknown role returns an empty string.
- Re-run `gen-tool-catalog` if the `patent_worker_validate` description or `availableWorkers` changes (the catalog now lists the extended workers through `defaultPatentWorkers()`).

## Non-attributable failures (waiting on the concurrent window)

These repository-wide gates are red on this worktree but are **not attributable to this change**; their failing entries name the concurrently in-progress `self-evolve` window's packages (`docs/sati-as-dsh-plugins-plan.md` §13.2 recorded those as the other window's uncommitted shared-file changes). This change touches none of them; the patent packages appear in no failure list. They should be re-validated after the `self-evolve` window lands; do not treat them as a regression of the mapping here:

- `verify-cordis-config` — only `packages/bundle/web-app/cordis.patch.yml` `@deepseek-ai/dsh-host-synapse` / `@deepseek-ai/dsh-client-synapse` fail to resolve through `tsconfig.base.json` paths.
- `verify-config-catalog` — stale `docs/config-catalog.md` (new rows for `dsh-host-synapse` / `dsh-client-synapse` / `dsh-self-evolve-eval`).
- `verify-doc-graphs` — stale `docs/event-producer-consumer.md` (rows for `synapse` / `self-evolve` / `self-evolve-basic`).
- `verify-package-readme-model-experience` — `packages/client/synapse`, `packages/test-support/self-evolve-eval`, `packages/web/synapse` lack complete model-context entries.

All attributable checks for this change pass (`tsc -b packages/patent/patent-workflow packages/patent/patent-teams`, both package suites, patent-workflow coverage, the translation pairs, `verify-export-jsdoc`, `verify-tool-catalog`, and the agent-note gates).
