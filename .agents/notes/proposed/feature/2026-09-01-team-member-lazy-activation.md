# Agent Note: Activate team members lazily along the dependency graph

Status: proposed

English | [中文](2026-09-01-team-member-lazy-activation.zh.md)

## Problem

In `dsh-session-b300a460` a five-member patent team started with a dependency DAG `t1→t2→t3→t4→(t5‖t6)→t7→t8`. All five members were created at the same time (+10.6 min into the 48-min session) and each session then lived 33–40 min, but their active work was much smaller: drafter lived 40.3 min but worked 18.2 min (22 min idle), tech-expert lived 33.3 min but worked 6.3 min, applicant-counsel lived 37.6 min but worked 11.9 min, adversarial lived 34.8 min but worked 10.5 min. Only researcher (38.1 min active) was busy throughout.

Each idle member kept a live session carrying a 92–168K-token context. Because the graph is essentially a chain, spawning every member in parallel does not shorten the critical path — it only funds agents that wait. Team tasks are therefore "slow" not from missing parallelism but from pre-activating members whose work is blocked on an unfinished upstream task.

## Proposal

The team runtime activates a member only when its first assigned task becomes runnable (all dependencies complete and the task is assigned). A member holds an active session only while it has runnable or in-flight work; once all its work completes it is released. Re-activation for a later correction task reopens or reuses that member's session. The captain may still create task records and assignments up front so the plan is visible, but member execution starts on demand and follows the DAG rather than the roster.

## Alternatives considered

- **Pre-activate all members.** The current behavior; builds the full roster but funds idle sessions and their context.
- **Spawn a fresh session per task.** Loses the member's memory across dependent tasks (for example the drafter holding v1 to produce v2).
- **Serialize everything in one worker.** Keeps memory but throws away the genuine parallelism of the t5‖t6 layer.
- **Keep members alive but compact their context.** Reduces prefill cost but still leaves idle live sessions.

## Acceptance criteria

- A member whose first task depends on an unfinished upstream task holds no live session until that dependency completes.
- The set of concurrently live members is exactly the set with runnable or in-flight work.
- A member that completes all its tasks is released, and a member assigned a later correction task is reactivated with its prior history.
- The critical path of a serial chain is not extended by idle members, and the visible plan does not imply live agents.
- Tests pin the activation condition, concurrency bound, release, and re-activation-with-history cases.

## Risks

The dependency graph must be queryable before activation, and a member's history must survive release so a correction task does not restart from scratch. A cyclic or under-specified graph must fail loud rather than deadlock. Capturing the contract of upstream output (what a downstream member consumes) must stay accurate, or a released member cannot be used by an earlier task that now depends on it.
