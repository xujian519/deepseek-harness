# Agent Note: A two-round OA evaluation with scripted review opinions

Status: implemented

English | [中文](2026-10-21-patent-oas-two-round-evaluation.zh.md)

## Problem

An Office-action reply is not a one-shot document. Practice is examination opinion → reply → re-examination → revised reply, and the costliest failure is a revision that does not overcome the cited defect, amends beyond the original disclosure, or introduces a new one. The `oa-answer` case measured a single first reply, so it could not distinguish an executor that answers well once from one that can revise under a second opinion — the behavior the benchmark is meant to compare.

A live second reviewer would add a varying model to the measurement: the score would mix the executor's revision ability with the reviewer's wording, and the same run would not reproduce. The evaluation needed a second turn that is fixed in the gold standard and replayable without another model.

## Decision

**A multi-round case is fixed at two rounds.** `cases/<case-id>/rounds/02/statement` holds the scripted review opinion that opens round 2. `loadGold` accepts exactly this one round directory; any other round number (`03`, non-contiguous), a stray file under `rounds/`, an extra file in the round directory, or an empty opinion is rejected instead of being silently reduced to a one-round run.

**Each round is scored with the same rubric.** The runner starts one executor and one evaluator per rubric dimension per round, so both rounds produce per-dimension observations. `RunCase.rounds` keeps those observations, the digest of the review opinion that opened the round (`statementDigest`; round 1 has none), and one deliverable digest per run. `RunCase.dimensions` keeps the final round only, so the gate's case, node, and aggregate judgments and its baseline delta compare like with like.

**The second round revises the first deliverable.** Its work directory is `run-N/round-2/`. The runner copies the round-1 agent state, keeps the round-1 deliverable as `previous-deliverable.md`, and removes the old `deliverable.md` and `agent.log`. The executor must therefore write a new deliverable rather than leaving a stale file that would be recorded as the round-2 result, and each round's log stays separate.

**The gold digest covers later rounds.** Adding a `rounds` entry changes `goldDigest`, so a case that gains a second round cannot be compared against an old baseline without an explicit digest and baseline re-record. A multi-round case must carry `rounds` in a run record, and a single-round case must not: the two score definitions are not comparable, and silently mixing them would let the gate compare a final-round score with a first-round score.

**The gate judges the final round only.** `caseRoundScores` derives each round's weighted total for the report, and `formatVerdict` prints `R1 … → R2 …`, but the verdict uses the terminal `RunCase.dimensions`. Whether a revision improved or regressed is visible without changing the pass rule.

## Alternatives considered

**Allow an arbitrary number of rounds.** Rejected for now: more rounds multiply calls, introduce an undefined stopping rule, and let the evaluation drift into measuring convergence rather than the revision behavior this issue scopes. Expanding the count needs its own pre-registered design.

**Use a live reviewer model for the second opinion.** Rejected: the reviewer's wording becomes an uncontrolled variable, the same capture does not reproduce, and the score no longer isolates the executor's ability to revise.

**Make each round an independent case.** Rejected: the round-2 case would not receive the round-1 deliverable, so the continuity being measured disappears, and the same work is paid for twice.

**Judge a mean over rounds.** Rejected: delivery quality is the final reply. A mean would reward a strong first answer followed by a regression that leaves the cited defect unresolved.

**Reuse the agent state without removing the old deliverable.** Rejected: an executor that does not rewrite `deliverable.md` would leave round 1's file in place, and the capture would record an unchanged document as the round-2 result.

## Consequences

A multi-round case costs `runsPerCase × rounds × (1 + rubric dimensions)` agent calls; `--dry-run` includes the rounds in its plan. Run records grow by one entry per round, but they retain enough to recompute round totals and identify which deliverable version each score judged.

The checked-in gold standard has no multi-round case yet: the layout, capture, record, and gate paths are covered by keyless specs, while the real scripted opinions and a matching baseline need a keyed capture. That capture must re-record `goldDigest` and the baseline in the same change.
