# Agent Note: A pre-registered measurement protocol for LLM-scored before/after comparisons

Status: implemented

English | [中文](2026-10-16-patent-eval-measurement-protocol.zh.md)

## Problem

The patent-oas benchmark compares an optimization against a baseline through LLM-scored runs, and the 2026-10-12 paper review (paper 08 §6.6, paper 10) recorded what happens without a protocol: on the same task family the same intervention scored +0.84 at N=10 and −0.12 at N=300 — a sign reversal that no small-sample comparison can detect, and none of the repository's gates can catch either. The runner defaulted to one run per case, its record carried no usage figures, and nothing required a comparison to state its sample size, its thresholds, or its budget before spending calls.

## Decision

**Every LLM-scored before/after comparison pre-registers four things before the first call**: the number of runs per case (at least 3 — the runner's default), the statistic and its decision thresholds (the gate's case/node floors and allowed drop), the expected effect the design must be able to detect, and the budget the comparison may spend. A comparison that did not pre-register them is a smoke run, not evidence, and must not be reported as one.

**Case-internal deltas are the unit of report.** The paper 08 measurements hold within a case only: absolute similarities and absolute scores are not comparable across cases, so a comparison reports per-case deltas and the node-attributed deltas the gate derives, never an isolated absolute number. The cross-case mean stays as a regression signal but is never reported alone.

**Random retrieval probes stay out of the delivery chain.** The paper's unlabeled-probe technique distinguishes grounded revision from prior injection, offline; wired into the workflow it would have the reply cite material no executed search covered, against the rule that a novelty conclusion requires a covered search. Retrieval probing is an offline evaluation instrument (it lands with the B4 batch), never a stage.

**Every recorded comparison carries its usage.** Run records may carry `cost` and `tokens`; the collector sums what the runner's call seam reports. Recorded comparisons fill them or state why they could not — a comparison without its cost cannot be scheduled or budgeted.

## Alternatives considered

**Trust the case mean alone.** Rejected by the same review: it moves with the rubric mix and cannot attribute a change, which is why the problem-space DAG gate ([2026-09-26](2026-09-26-patent-oas-problem-space-gate.md)) judges per node in the first place.

**Set the sample size after seeing the first batch.** Rejected: choosing N after peeking is how the reported sign flips; pre-registration means the number is fixed before the calls are spent.

**Build the full statistics (variance, power curves) into the runner now.** Rejected for now: the shipped upgrade is runs greater than one, per-run scores, and usage fields; the gate reports range and sample standard deviation from the retained scores, while power curves and interval estimates remain an offline-evaluation concern framed by this protocol.

## Consequences

The runner's default `--runs` is 3; records retain one score per run and can carry the usage the call seam reports — tokens from the headless `--json` stream, cost from the provider or converted at caller-supplied per-million prices. The gate accepts and validates those fields and prints per-case and per-node range and sample standard deviation without judging them. The oa-answer observation nodes and the retrieval-probe instruments remain with the B4 batch, as ruled on 2026-10-16 (issues 甲8 / 丙2); until they land, B4 comparisons are recorded as not-yet-run rather than run thin.
