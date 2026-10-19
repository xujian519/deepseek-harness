---
kind: upgrade-guide
description: "`SelfEvolveEngine` gains `requestEvolve`, `self_evolve_now` returns a queue receipt, self-evolve types become branded, `BenchmarkEvolveConfig.agentStateDir` becomes required, and a shipped `self-evolve` profile exists."
---

# Self-evolve triggers, queue, and configuration

English | [中文](guide.zh.md)

## Change

`SelfEvolveEngine` gains the abstract `requestEvolve(agent, levels?)`, returning an `EvolveRequestReceipt` (`{ requestId, status: 'queued' | 'coalesced', queuePosition }`). `@deepseek-ai/dsh-self-evolve-basic` implements it as a per-session in-memory queue drained at the idle boundary and after each finished loop, because a tool cannot start maintenance inside its own turn. `self_evolve_now` returns that receipt instead of a run result. Explicit requests are never evicted or rate-limited; a full queue (`maxPendingEvolveRequests`, default `8`) drops the oldest autonomous request, and identical level sets coalesce. A queued request that outlives the process is lost.

Triggers are `agent/status` idle for a non-subagent session, an automatic compaction (`compaction/start` with a non-null `turn`), an explicit `user-command`, and one `validation-retry` after a `low-confidence` rejection when `proposerTarget` is set. `verifier-unavailable` never retries. `allowUnverifiedAutonomousRuns` (default `false`) skips autonomous loops on a deployment with no `workspaceVerifier.buildCommand` or no `validatorTarget`; explicit requests still run and still report `verifier-unavailable`.

`registerL1Skill` and `registerL2Section` dispose the previous self-evolve contribution before registering, an L1 commit rejects a name this provider does not own as `apply-failed`, and rollback restores the champion or, for a first commit, writes a tombstone the skill filesystem ignores.

`FailurePattern.patternId`, `EvolveProposal.proposalId`, the `readPatterns` session id, and `SelfEvolveAgentContext.sessionId` are branded. `BenchmarkEvolveConfig.agentStateDir` is required and validated against relative paths, non-directories, `baseDir`, `cwd`, home, and filesystem roots, with a `.self-evolve-benchmark` marker on non-empty directories. `PROFILE_TEMPLATES` gains `self-evolve`.

## Migration

1. Implement `requestEvolve` on every subclass outside this repository, and never run a loop inside a tool call.
2. Read a `self_evolve_now` result as a receipt; take the outcome from the `self-evolve/*` events or the follow-up message.
3. Pass `agentStateDir` explicitly, pointing at a dedicated state directory rather than a workspace.
4. Mint branded ids with `FailurePatternId`, `EvolveProposalId`, and `SelfEvolveRunId`.
5. Review `allowUnverifiedAutonomousRuns` per deployment, since the default stops periodic no-op loops.
6. Expect one skill-scan warning after rolling back a first commit.
7. Confirm: `pnpm exec vitest run packages/self-evolve` passes, `pnpm dsh --profile self-evolve --help` resolves, and a turn whose `self_evolve_now` returns `status: "queued"` is followed by `self-evolve/start` and `self-evolve/end`.
