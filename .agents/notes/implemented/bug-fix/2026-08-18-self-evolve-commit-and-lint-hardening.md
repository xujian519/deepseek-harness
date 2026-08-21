# Agent Note: self-evolve commit duplication, lint hardening, and honest claims

Status: implemented

English | [中文](2026-08-18-self-evolve-commit-and-lint-hardening.zh.md)

## Problem

A review of the self-evolve plugin surfaced one real defect and several debt items:

1. **Duplicate `self-evolve/commit` appends.** `applyCommit` appended the commit event (with a placeholder `commitSeq: 0` in the durable payload) and `executeLoop` appended a second commit event for the same proposal. The log carried two commit events per accepted proposal, the first with a false seq; the bracket invariant companion would reject the second append if ever mounted. No test covered the full-loop commit path, so the duplication went unnoticed.
2. **Type lies.** `validateL4Proposal` passed `sessionId: agent.sessionId as never` to `runner.define` although both sides already carried the same `SessionId` brand. The whole package subtree also had 42 type-aware oxlint violations under the repository's default config (unnecessary `as` assertions, `String()` conversions on strings, a non-exhaustive switch, dead defensive conditions) while master's same config is clean.
3. **Dead defensive reads of typed payloads.** The projection read `compaction/end`'s `error` as an object (`{ name }`) although the declared durable type is `error?: string`; producers append `errorChain(error)` strings. The object branch could never match a real event, and the colon-less error-name slicing in the `self-evolve/end` branch silently chopped the last character of names without a colon.
4. **Honesty gaps.** The base provider's workspace verifier is not implemented (P1.3b), so `minAcceptConfidence` is unreachable and no commit can ever occur in the base bundle; the tool prompt and READMEs still framed commits as "experimental" rather than "currently impossible". The held-out pass-rate threshold `0.6` was a hardcoded literal, and four near-identical read-file/parse routines (negative results, global patterns, champion archive ×2) were duplicated.

## Decision

Fix all four in one scoped change across the self-evolve packages:

- `EvolveCommit.commitSeq` becomes optional: an event cannot reference its own seq, so the `self-evolve/commit` payload omits it and the loop fills it into `SelfEvolveResult.commits` from the append result. `applyCommit` appends the single commit event and returns its seq; `executeLoop` no longer appends a second one.
- The `as never` cast and the other 42 type-aware lint violations are removed; the subtree is clean under both the default 89-rule config and the staged 48-rule gate.
- The projection's `compaction/end` branch reads the real `error?: string` payload, and both string-error branches share an `errorNamePrefix` helper that slices up to the first colon without chopping colon-less names.
- `minHeldOutPassRate` becomes a validated `Config` field (default `0.6`) instead of a literal; `readJsonlRows`/`readLatestJsonRow` in a new `src/jsonl.ts` replace the four duplicated read routines; `runLoop` rate-limit accounting moves inside the maintenance callback so a rejected start no longer consumes the daily cap.
- The tool prompt section, both README pairs, and the spec now state that base-bundle proposals are conservatively rejected and no commits occur until a subclass supplies the workspace signal (or an L3/L4 route produces proposals).
- Regression coverage: a full-loop test asserts exactly one commit event whose seq matches the result record; the rate-limit tests now run the real maintenance task under a stubbed DSH_HOME.

## Alternatives considered

**Keep the payload placeholder and dedupe downstream.** Rejected: a durable event carrying a false `commitSeq: 0` is a data lie no consumer should have to ignore.

**Implement a baseline workspace verifier (P1.3b) instead of documenting.** Rejected: making base commits possible is a behavior change that should wait for the P1.10 60-question evaluation evidence (the spec's own rollback condition); documenting the unreachable path is the honest intermediate state.

**Change the event payload to `{ runId, proposal, validation }`.** Rejected: the minimal `commitSeq?: number` change keeps the payload shape and the invariant's `commit.proposal.proposalId` read untouched.

## Consequences

- One `self-evolve/commit` event per accepted proposal; the bracket invariant companion (when mounted) no longer sees a duplicate commit.
- `pnpm run typecheck`, `pnpm exec vitest run packages/self-evolve/ packages/bundle/self-evolve-app/` (85 tests), oxlint under both configs, `verify-package-invariants`, and `gen-tool-catalog --check` pass.
- `compaction/end` failure patterns now carry the real error-name signature instead of a constant fallback; `self-evolve/end` colon-less error names are no longer truncated.
- Still deferred: P1.10 evaluation, keyless snapshots, and the `turnHasFailure` full-session scan. The workspace verifier later landed in [the P1.9b workspace-verifier note](../feature/2026-08-21-self-evolve-workspace-verifier.md) and supersedes the documented unreachable state.
