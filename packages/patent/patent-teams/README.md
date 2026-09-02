---
description: "Durable multi-agent teams for patent workflow: one captain-led team of continuable subagents with dependency-aware tasks, mailbox messaging, and an event-driven shared-task scheduler. A formal workspace port of the upstream `@nanmicoder/dsh-agent-teams` plugin, re-scoped to the patent domain (`patent_teams_*` tools, `.patent-teams/` state directory, `patent-teams/*` session events) and shaped as a Service Definition (`ctx.patentTeams`) with the tools as its sole Consumer."
kind: "package-reference"
---

# dsh-patent-teams

English | [中文](README.zh.md)

## Summary

Durable multi-agent teams for patent workflow: one captain-led team of continuable subagents with dependency-aware tasks, mailbox messaging, and an event-driven shared-task scheduler. A formal workspace port of the upstream `@nanmicoder/dsh-agent-teams` plugin, re-scoped to the patent domain (`patent_teams_*` tools, `.patent-teams/` state directory, `patent-teams/*` session events) and shaped as a Service Definition (`ctx.patentTeams`) with the tools as its sole Consumer.

## Table of Contents

- [What it mounts](#what-it-mounts)
- [Configuration](#configuration)
- [State model](#state-model)
- [Session events](#session-events)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## What it mounts

- `ctx.patentTeams` — the `PatentTeamsService`: team CRUD, task state machine with attempt revocation, member lifecycle (spawn/interrupt/retire), mailbox persistence, archive-on-delete, and scheduler kicks.
- Eleven `patent_teams_*` tools: `create`, `add_member`, `remove_member`, `create_task`, `reassign_task`, `claim_task`, `update_task`, `send_message`, `status`, `archive`, `delete`.
- One system-prompt usage section (`patent-teams:usage`, default order 117) teaching the captain protocol.

## Configuration

```yaml
- id: patent-teams
  config:
    stateDir: .patent-teams      # team state root under the captain's workspace
    memberProvider: spawn        # ctx.subagents provider (continuable + persona + toolFilter)
    memberModel: deepseek-v4     # optional model override for every member
    memberMaxDepth: 1            # member delegation depth cap (0 forbids delegation)
    maxMembers: 8                # team size cap
    promptSectionOrder: 117      # usage-section order
```

## State model

Team state lives under `<workspace>/<stateDir>/<teamId>/`:

- `team.json` — the durable `TeamState` record (members, tasks, task sequence).
- `inbox/<agentKey>.jsonl` — one JSONL mailbox per agent (`captain` or a member name).

All mutations run inside an in-process per-team lock and persist atomically (same-directory temp + rename, with a direct-write fallback for Windows `EPERM`). Task status transitions are validated by `TASK_TRANSITIONS`; every claim carries an `attempt_id` capability that becomes stale after retry or reassignment, so late member updates are rejected. `patent_teams_delete` archives the team directory under `archive/` instead of deleting it, retaining tasks and mailboxes for later review; `patent_teams_archive` reads that archive back (workspace-wide listing plus one-team detail, read-only).

## Session events

Every state mutation appends one `patent-teams/*` event to the captain's session (types and payloads in `event-types.ts`): `team-created`, `member-added`, `member-removed`, `task-created`, `task-updated`, `message-sent`, `team-deleted`. The package's invariant companion validates each payload on load and on append.

## Model Experience

### Request context and condition

#### What the model sees

The usage section is a fixed system-prompt contribution whenever this plugin is mounted, plus the eleven tool schemas in the [generated tool catalog](../../../docs/tool-catalog.md).

##### Verbatim text for this field, when needed

```markdown
When the user asks to run something with PatentTeams (e.g. "use PatentTeams to do X"), you are the captain of a multi-agent team. Follow this protocol:
1. Call patent_teams_create with a team name and the goal as description. You become the captain and may lead one team at a time.
2. Call patent_teams_add_member once per role the goal needs (researcher, engineer, reviewer, ...). Members are durable subagents: they wait for your messages, then work a full turn. By default a member on your current provider/model snapshots your current reasoning effort; a member routed to a different provider or model automatically uses that target model's default effort. Never ask the user to choose these per member; only pass provider/model when the user explicitly requests a different route for that role, and reasoning_effort only when the user explicitly requests a particular effort ("default" explicitly selects the target model's default).
3. Break the goal into tasks with patent_teams_create_task and wire dependencies. Assign role-specific work when useful; unassigned ready work belongs to the shared pool. The scheduler automatically claims one ready task for each truly idle member and wakes it, including across later rounds.
4. Lead by delegation: monitor with patent_teams_status, send guidance with patent_teams_send_message, and let idle teammates execute ready work. Do not duplicate a teammate's work merely because its turn is slow.
5. If work is blocked, stale, or needs takeover, always call patent_teams_reassign_task first. Reassign to another idle member, or use assignee=captain before doing it yourself. Reassignment revokes the old attempt and waits for that member to quiesce, preventing late results from overwriting the new attempt.
6. Tasks carry attempt_id capabilities. Members must use the current attempt_id for updates; stale-attempt errors mean ownership changed. Poll status until every required task is terminal and every member is idle/ready.
7. Present the team's results to the user, then patent_teams_delete the team unless the user wants to keep working with it. Deleted teams stay reviewable read-only through patent_teams_archive.

Tools: patent_teams_create, patent_teams_add_member, patent_teams_remove_member, patent_teams_create_task, patent_teams_reassign_task, patent_teams_claim_task, patent_teams_update_task, patent_teams_send_message, patent_teams_status, patent_teams_archive, patent_teams_delete
```

#### Token effect

Fixed: one usage section (approximately 2.4 KB) plus the eleven tool schemas. Data-dependent parts (team status payloads, assignment prompts, member reports) are bounded: status renders up to 10 mailbox warnings, task output is truncated to 300 characters in status and archive renders, inbox previews to 200.

#### KV Cache effect

Prefix-stable: the usage section is constant for a given mount, so it does not invalidate the system-prompt prefix. Session events and team state never enter the prompt; only tool results do, on demand.

## Known Limitations and Deferred Work

- **Web UI is a separate projection** — the upstream plugin's activity-panel and artwork routes are not ported; `dsh-client-ui-patent-teams` folds the `patent-teams/*` session events into a chat card and the Teams view, and the on-disk files plus `patent_teams_status` remain the authoritative inspection paths.
- **Single-process serialization** — state is file-backed and serialized within one DSH process; concurrent processes editing the same team are not coordinated.
- **One active team per captain** — a captain must end its current team before creating another.
- **Live delivery is best-effort** — if the recipient agent is offline, messages stay durable in the mailbox and are retried at the next status boundary.

### Dev Note

None.
