# Agent Note: PatentTeams captain waits on team changes instead of polling

Status: implemented

English | [中文](2026-10-15-patent-teams-wait.zh.md)

## Problem

Two real patent-team sessions, measured from their exported session logs, spent most of their wall clock waiting on themselves:

| | session A (utility model drafting) | session B (composting accelerator) |
|---|---|---|
| wall clock | 4h34m | 15h40m |
| pure wait in tool calls | 1h13m (27%) | 7h29m (48%) |
| of which `sleep` + `job_output` polling | 58m / 13 calls | 5h08m + 33m / 111 calls |
| of which `ask_user_question` | 15m | 1h48m (one call blocked 1h27m) |
| member utilization (active time in team) | 0–30% | 2–22% |

The captain had no primitive for "wait until a teammate does something", so it built one out of `bash`:

```
+44.6min  bash        sleep 150; cd .../.patent-teams && ls 01-检索/*.md
+45.7min  job_output  {"job_id":"bash-53","wait":true,"timeout_ms":180000}
+49.9min  bash        sleep 280; cd .../.patent-teams && ls ...
+49.9min  job_output  {"job_id":"bash-59","timeout_ms":300000,"wait":true}
```

Every `job_output` in session B ran to its full 5-minute timeout. Seven members were "in the team" for 7.7–10.4 hours each while their combined active time was 9.0 hours against a 15.7-hour wall clock — the parallelism bought nothing, because each hand-off waited on the captain's next poll. In session B, 14 of 82 poll snapshots were byte-identical to the previous one.

The wake-up path was never the problem: members report with `patent_teams_send_message`, which the service already steers into the captain's next model step. Session B's captain received 73 member messages across 258 `next-step` inbox events. It slept through them anyway.

Three artifacts taught it to. The `patent_teams_status` description ended with *"Poll this to watch progress."*; the plugin's system-prompt usage section said *"monitor with patent_teams_status"* and *"Poll status until every required task is terminal"*; and `patent-team-composition` had no section at all on how a captain should wait.

## Decision

`@deepseek-ai/dsh-patent-teams` gains `patent_teams_wait` (captain only), backed by a `TeamActivity` waiter registry, and every poll-shaped instruction is rewritten.

**The primitive** (`src/team-activity.ts`, mirroring `@deepseek-ai/dsh-experimental-agent-team`'s `TeamActivity`): one-shot waiters bucketed by team id, with `wait(teamId, timeoutMs, signal)`, `notify(teamId)`, and `close()` on disposal. `timeout_ms` is an integer from 10 000 through 3 600 000, defaulting to 30 000; the service validates the range and rejects callers without a captain team. The mirror is deliberate and carries a `jscpd:ignore` marker: [the experimental package rules](../../../../packages/experimental/AGENTS.md) bar a release package from depending on an experimental one, so this package cannot reuse the experimental copy, and sinking the primitive into `util/` stays deferred.

**The announcement points** are the committed mutations, each firing after its `writeTeam`/`appendMailbox` and event record — task create, claim, update (including a quality-gate bounce), reassign, member add/remove, mailbox delivery in either direction, and the member status edge the scheduler mirrors into the roster.

**The tool answers one question** — did anything change (`timed_out`) — and returns no snapshot. Durable team state stays the single authoritative source: the captain re-reads `patent_teams_status` after every wait. A wait never wakes a member, and it observes only changes announced after it registers.

**The instructions now match.** The status description reads *"Read it before dispatching and again after patent_teams_wait returns; it is a point-in-time snapshot, so never poll it in a loop."* The usage section's dispatch step says *"never sleep, poll, or loop on status to pass the time"* and a timeout is framed as a decision point (dispatch, take over, or ask the user), not a reason to wait again. `patent-team-composition` gains a 等待纪律 section stating the loop as 派活 → `patent_teams_wait` → re-read status.

## Alternatives considered

**Have the wait return a change summary (who finished what), saving the follow-up status read.** Rejected: a summary is a second projection of state that can drift from `patent_teams_status`, and the captain needs the whole board to decide the next dispatch regardless. `wait_agent` in `dsh-agent-team` reports the same way.

**Open the wait to members too.** Rejected: members are woken by the scheduler through `deliverToMember` and have nothing to wait for. Exposing it would invite a member to block its own turn — the exact anti-pattern this change removes.

**Return `noProgress` immediately when no member is running, as `wait_agent` does.** Rejected: this plugin's scheduler kicks members asynchronously after a task-graph mutation, so `memberActivity` reports `running` only after that window. A wait issued right after a dispatch would falsely report that nobody is working. A timeout already carries the signal, and the captain decides from the board.

**Skip the tool; change only the prompt to "end the step and let member messages wake you".** Partly adopted, not sufficient alone. Message-driven wake-up does work, but a captain waits for a whole batch of tasks to converge while messages arrive one at a time; without a blocking primitive it still invents a loop. The wait turns "wait for the next change" into one tool call. The prompt rewrite shipped alongside it.

**Add a `wait_ms` parameter to `patent_teams_status` instead of a new tool.** Rejected: reading a snapshot and blocking on change are different operations. Folding them together gives the read path blocking semantics, and existing call habits would keep taking the polling branch. Separate tools make the discipline legible in the tool names: `status` reads, `wait` waits.

## Consequences

- The pattern that produced 5h08m of `job_output` timeouts and 58m of `sleep` in the measured sessions no longer has a reason to exist: the captain dispatches, waits, and re-reads.
- A wait costs one tool call plus the moment the change lands, instead of a fixed polling interval. Session B's 5-minute perception lag per hand-off becomes sub-second.
- Waits are **in-process**. A team edited by another DSH process wakes the waiter only at its own timeout. Team state itself stays file-persisted, so this affects wake latency, not correctness; it is recorded under Known Limitations.
- A wait is not durable state. It ends with its process, which is the lifetime of the blocking call itself — nothing needs migrating.
- Model-visible cost: the usage section grows from about 2.4 KB to 2.7 KB and the catalog from 11 to 12 tool schemas.
- Verification: `pnpm run typecheck`, `pnpm run build`, and `pnpm run lint` pass. `pnpm run build:check` caught one test-only type error the package run could not, because vitest transpiles without type checking — worth running after any spec change here. The package suite is 269 tests, adding waiter wake/timeout/abort/disposal, the captain-only and range-checked service path, and the tool's default and rendered output. The added tool also touched two shared fixtures, both rerun: `gen-tool-catalog`'s shipped-name list and `patent-preset`. `pnpm run doc-sync` reports 50 of 51 gates passing; the one failure, `verify-repository-references`, is the full-history-clone artifact the previous sync's note already records, unchanged by this work.
