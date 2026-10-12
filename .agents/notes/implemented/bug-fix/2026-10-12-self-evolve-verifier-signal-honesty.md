# Agent Note: self-evolve verifier-signal honesty

Status: implemented

English | [中文](2026-10-12-self-evolve-verifier-signal-honesty.zh.md)

## Problem

The base provider's aggregate gate multiplies three rates — `min(judge dimension scores) × heldInRate × heldOutRate` — and compares the product to `minAcceptConfidence` (0.5). Three defects made that gate disagree with what the package documented and with what the code appeared to measure.

**A missing judge scored 1.0.** `_judge` returns `null` when `validatorTarget` is unset or the llm service is absent, and the call site substituted `SMOKE_SCORES` — all four dimensions at 1. That is the opposite of the contract every other dimension follows, where a missing signal substitutes the weak rate 0.3. A deployment without `validatorTarget` therefore accepted any proposal whose other two dimensions passed, at `confidence` 1.0 and with no LLM review at all, while `self-evolve-basic/README.md` promised that "missing signals degrade to the weak rate 0.3 instead of faking acceptance". The substitution dated from the P0 bracket-smoke stage ([failure-event sources and validation gates](../architecture/2026-08-17-self-evolve-event-sources-and-validation-gates.md)); only the held-in and held-out paths were tightened later.

**The weak path was unreachable and silent.** With `heldInRate = heldOutRate = 0.3`, no combination of judge scores reaches 0.5 — the gate would need `min(scores) ≥ 5.56`. The loop mined patterns, produced proposals, wrote negative-results rows, and rejected every one of them as `low-confidence`. Nothing distinguished "the verifiers never judged this" from "the verifiers judged it badly", so a deployment whose verifiers were simply unconfigured emitted evidence that read like a stream of bad proposals — and the template proposer summarized those rows back into its own context as repair hints.

**The byte budget counted UTF-16 code units.** `maxPromptInflationBytesPerWeek` and `L2-context.estimatedBytes` are named in bytes, but `pruneInflatedSections` and the template proposer measured `String.length`, understating non-ASCII text by up to 3×.

A fourth, narrower defect sat in the same branch: the held-out path tested `heldOutRate === WEAK_VERIFIER_RATE` to decide whether the dimension had been measured, so a genuine pass rate of exactly 0.3 (3/10) read as "no signal", and a collector returning `cases: 0` produced both a measured row and an unavailable row.

**Replay counted completion as repair.** `replayCase` derived its exit code from `result.stopReason === 'completed'`, so a fork child that reported completion without executing anything scored the same as one that re-ran the failing command. The objective half of that verdict — re-folding the child's own events to see whether the pattern re-triggered — was already there, but on its own it could not reject an empty run.

**Held-out read the proposing session's own history.** `collectHeldOutSignal` searched `sessionId: session.id`, so the pattern's origin, the proposal, and the held-out verdict all came from one log. That is self-confirmation rather than an independent probe, and it is also why a fresh session with a concentrated failure pattern commonly finds no hit at all.

## Decision

Treat a dimension with no signal as missing, never as favourable, and make the resulting rejection say so.

- **Delete the 1.0 fallback.** `_judge` returning `null` now substitutes `WEAK_VALIDATION_SCORES` (all four dimensions at 0.3), matching the held-in and held-out paths.
- **Record why.** `validateProposal` collects the names of the weak dimensions and, when that list is non-empty, returns `rejected` with the new reason `verifier-unavailable` *before* the threshold comparison; the diagnostic names the dimensions. The ordering is deliberate: lowering `minAcceptConfidence` must not convert missing evidence into an acceptance.
- **Separate the two rejection meanings.** `low-confidence` now means only "every dimension was measured and the product fell short". Because `persistNegativeResult` stores the reason verbatim and the proposer prefixes summarize it, this keeps verifier misconfiguration out of the loop's own few-shot repair context.
- **Measure bytes.** One `utf8Bytes` helper (`Buffer.byteLength(text, 'utf8')`) replaces `String.length` in the pruning budget and in the template proposer's `estimatedBytes`.
- **Make held-out measurement explicit.** A `heldOutMeasured` flag replaces the `=== WEAK_VERIFIER_RATE` comparison, so a genuine 0.3 pass rate is measured and `cases: 0` is unmeasured.
- **Require the replay to exercise the surface.** `replayCase` now folds each child once into both its re-triggered pattern ids and a tool-call count, and passes only when the child completed, called at least one tool, and re-triggered nothing. The replay prompt states that describing a result instead of executing it does not count. This proves the child attempted the work — not that the failure is repaired.
- **Let held-out read another session.** `heldOutSessionIds` names sessions whose history supplies held-out cases; the probe searches each in turn, merges the hits, and caps them at `maxHeldOutCases`. The supporting-seq filter applies only to the proposing session, because seq numbers are session-local. Empty is the default and keeps the previous same-session behaviour, now stated as such in the config docstring, the README, and `Known Limitations`.
- **Keep L4 honest.** The L4 acceptance path keeps its scores but names them `L4_APPROVAL_SCORES`, documented as "not evaluated": the aggregate gate does not evaluate L4, and the human approval flow is its only defense.

Because the shipped default configures none of the three dimensions, the base bundle still commits nothing — but it now reports `verifier-unavailable` with the dimension named, instead of a stream of `low-confidence` rejections.

## Alternatives considered

**Keep the 1.0 fallback as an explicit opt-in** (`judgeFallback: 'weak' | 'smoke'`). Rejected: no current consumer needs a smoke acceptance, the harness convention keeps opt-ins out of shipped defaults, and a configuration knob whose only effect is to accept unreviewed proposals is a liability rather than a capability. Deleting the constant also removes the possibility of a future caller reaching for it again.

**Raise `minAcceptConfidence` instead of adding a reason.** Rejected: the threshold is not the defect. The gate was already unreachable; what was missing was a truthful account of *why*, which is exactly what the negative-results log feeds back to the proposer.

**Make the weak path an error that closes the loop bracket.** Rejected as the default: an idle loop with no configured verifier is a legitimate, if inert, state rather than a harness failure, and closing the bracket would suppress the pattern mining and negative-results rows that a later configuration change benefits from. The rejection reason carries the signal instead.

## Consequences

- `verifier-unavailable` joins the `ProposalValidationOutcome` rejected-reason union in `@deepseek-ai/dsh-self-evolve/types`; `docs/persistence-catalog.md` regenerates because the `self-evolve/validated` payload type changed.
- Two existing tests that asserted `low-confidence` under a weak path now assert `verifier-unavailable`. Three new cases pin the fix: a missing judge rejects despite passing verifiers, `minAcceptConfidence: 0` still cannot accept a missing signal, and a multibyte section is pruned by a byte budget its `length` would have passed.
- The suite previously contained a case whose acceptance depended entirely on the 1.0 fallback ("both verifiers pass + held-out passes → accepted"). It now supplies explicit judge scores, so a regression to the fallback fails the suite.
- Three replay fixtures changed meaning under the stricter verdict: a "clean" held-out child now makes one tool call, while the no-local-agent case fails the gate instead of passing it. A new case covers a completed child that called no tool.
- Documentation matches the code again: `self-evolve-basic/README.md`/`.zh.md`, the `tool-self-evolve` prompt section and README, `spec.md`, `tasks.md`, and `check_list.md` state the three prerequisites and the `verifier-unavailable` outcome. The `Known Limitations` list records what this change did **not** fix: held-out is same-session, replay proves exercise rather than repair, and L4 is authorized by approval alone.
- Still deferred: an objective replay verdict (a failure pattern carries no replayable command, so "exercised" still stands in for "repaired"), a held-out source that is independent by default (`heldOutSessionIds` can supply one, but nothing discovers it automatically), and the P1.10 evaluation, which has not been run.
