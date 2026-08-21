# Agent Note: self-evolve workspace verifier (P1.9b)

Status: implemented

English | [中文](2026-08-21-self-evolve-workspace-verifier.zh.md)

## Problem

The held-in dual verifier had no working second eye. `BasicSelfEvolveEngine.collectWorkspaceSignal` was a stub returning `null`, so `requireDualVerification` (default true) always took the weak rate 0.3, `minAcceptConfidence` (0.5) was unreachable, and the base bundle could mine patterns and propose edits but never commit one. The earlier hardening note ([commit duplication](../bug-fix/2026-08-18-self-evolve-commit-and-lint-hardening.md)) deliberately documented this state instead of implementing the verifier, deferring it behind the P1.10 evaluation evidence. Two contract defects also sat in the stub path: the `{ dirtyLines, noDirtyFallback }` shape had no channel to express a failed build (the old `buildPassed = noDirtyFallback || dirtyLines ≤ tolerance` formula passed on `noDirtyFallback` regardless of build health, and no test ever set it true), and `validateProposal` collected replay and workspace signals in `Promise.all`, so the workspace check never saw the state the replay left behind.

## Decision

Implement the workspace verifier (P1.9b) in the base provider behind an explicit config policy, and fix the two contract defects:

- **Contract**: `WorkspaceSignal = { dirtyLines, noDirtyFallback, buildHealthy: boolean | null }`; `_verifyHeldInCase` requires replay, build health, and dirty tolerance together and distinguishes `build-failed` from `workspace-dirty` in its diagnostic. `captureWorkspaceBaseline` records the pre-replay git state; `collectWorkspaceSignal(agent, proposal, signal, baseline)` measures the replay's net dirty delta.
- **Dirty measure**: `git diff HEAD --numstat --relative` (machine-parseable form of the design's `git diff --stat`) plus untracked-file line counts, excluding harness-owned `.dsh/` paths so the result is deterministic whether or not the project gitignores `.dsh/`. The delta is floored at 0, so pre-existing in-progress user changes never fail the gate and the replay cannot hide its own footprint behind them.
- **Build health**: the configured `workspaceVerifier.buildCommand` runs in the session's cwd through `ctx.shell` (which owns shell semantics, timeouts, and the executor's sandbox policy); nonzero exit or timeout = unhealthy.
- **Degradation matrix**: the signal is `null` (weak path) when the verifier is disabled, the shell service is absent, the workspace is not a git work tree without a build fallback, or no `buildCommand` is configured. `noDirtyFallback: true` is the build-only fallback for non-git workspaces.
- **Wiring**: `validateProposal` now captures the baseline, runs the replay, then collects the workspace signal — sequential, so the signal reflects post-replay state.

## Alternatives considered

**Ship the verifier as a separate provider package.** Rejected: the hook already lives on the base class, and a new package would carry the full scaffold (manifest, invariant, bilingual READMEs, tsdown, catalog) for ~50 lines of logic. The base provider remains dependency-light via optional `ctx.get('shell')`.

**Keep the old contract and encode build failure as an inflated dirty count.** Rejected: a lying signal corrupts the negative-results knowledge base with a fabricated regression reason.

**Default `workspaceVerifier.enabled: false`.** Rejected in favor of `true` with the safe degradation matrix: without a `buildCommand` the signal is still unavailable and the loop behavior is byte-identical to the pre-landing state, so no deployment silently changes behavior; the flag exists for explicit opt-out.

## Consequences

- The held-in gate can now pass when a profile configures `workspaceVerifier.buildCommand` and the project is a git work tree; the default composition still commits nothing.
- `parseDirtyDelta` is exported and unit-tested; real-git integration tests cover baseline/delta, non-git fallback, build failure, build timeout, untracked-line counting with `.dsh/` exclusion, and the `enabled: false` / missing-`buildCommand` weak paths (provider spec: 143 tests).
- `self-evolve-basic` gains the `workspaceVerifier` config field; `validateProposal` runs replay before the workspace check.
- The tool prompt section and README pairs now state the workspace check is active only when the profile configures a build command.
- Still deferred: P1.10 evaluation, L3/L4 proposal generation, P4.3 similarity dedup, keyed end-to-end verification.
