# Agent Note: self-evolve evaluation decision rule

Status: implemented

English | [中文](2026-10-12-self-evolve-eval-decision-rule.zh.md)

## Problem

The P1-10 gate decided `continue` when the percentile bootstrap interval of the paired win-rate delta lay strictly above zero ([eval scaffold](../feature/2026-08-21-self-evolve-p110-eval-scaffold.md)). Three things are wrong with that criterion at this scale.

**A bootstrap over paired binary outcomes has too little power here.** The campaign pairs the same task across two arms, so each task contributes one of three outcomes: win, loss, or tie. Resampling task differences discards the pairing structure instead of testing the discordant pairs directly, and Bowyer et al. ([arXiv:2503.01747](https://arxiv.org/abs/2503.01747)) show that interval methods lean on the central limit theorem most where it is least reliable — under a few hundred observations.

**"The interval excludes zero" admits immaterial effects.** At n = 60 an interval can clear zero on a five-task net win. A rule that turns the default on for a two-percentage-point gain is not a rule anyone can act on.

**One fixed subset cannot be consumed repeatedly for free.** Candidates are proposed from the subset's own feedback, so the search adaptively overfits the set that judges it. REUSE ([arXiv:2609.33180](https://arxiv.org/abs/2609.33180)) puts the false-promotion rate for this pattern as high as 20.7% and shows that limiting the feedback returned to the search is what removes it. The scaffold recorded a decision without recording which subset produced it, so repeated decisions against one digest were indistinguishable from first ones.

## Decision

**Gate on an exact test plus a pre-registered minimum effect.** `mcnemarExact(wins, losses)` computes the two-sided exact p-value over the discordant pairs (the smaller count is `Binomial(wins + losses, 0.5)`), accumulating terms in log space so a plausible subset size does not underflow `0.5^n`. `decide` recommends `continue` only when that p-value is below the significance level **and** `winRateDelta` reaches `--min-effect` (default 0.05). The bootstrap interval is still computed and recorded, now as description rather than as the criterion.

**Version the criterion.** `EvalDecision.criterionVersion` is bumped to 2, and `readDecision` refuses a record written under another version instead of letting the gate enforce a rule that no longer applies. Records from different versions are not comparable, and the fault must be loud: re-run the evaluation.

**Tighten the level per reuse.** `--prior-reuses N` divides the significance level by `N + 1`, mirroring the sequential-error argument in REUSE. The digest the decision covered is recorded via `--subset` (SHA-256 of the subset file), so "reuse" is a fact about a digest rather than a claim.

**Give the workflow somewhere to go next.** `selectSubsetWithReserve` returns a subset plus a disjoint reserve drawn from the same deterministic shuffle; the CLI writes both and prints the subset digest. `selectSubset` keeps its signature and delegates, so existing callers and the committed `subset.json` are unaffected.

## Alternatives considered

**Keep the bootstrap as the gate and add the minimum effect.** Rejected: the minimum effect fixes the second problem but leaves the first. The test that matches the design is the paired one.

**Gate on McNemar alone.** Rejected: at n = 60 a net win of 8 clears the 0.05 level while moving the resolution rate by 13 points — but so does a net win of 5 at n = 40, and the rule should be stated in the units the maintainers actually care about, which is the resolution delta, not the p-value.

**A Bayesian posterior instead of an exact test.** Rejected for now: it is a larger change to the record format and the gate, and the sequential-error control REUSE provides is stated in a frequentist frame. The reuse adjustment captures the same concern with less machinery.

**Auto-discover the reserve and rotate it.** Rejected: nothing in the repository tracks how many times a digest has been consumed, so an automatic rotation would be guessing. The reuse count is an explicit input until a decision ledger exists.

## Consequences

- `pnpm exec vitest run packages/test-support/self-evolve-eval` passes (155 tests, +13); the exact test is covered on both sides of the tail, including the `discordant === 0` and cap-at-1 branches.
- Two CLI surfaces change: `subset` gains `--reserve`/`--reserve-out` and prints `subsetDigest`, and `decide` gains `--subset`, `--alpha`, `--min-effect`, and `--prior-reuses`. The RUNBOOK and its Chinese pair document both.
- `spec.md` and `check_list.md` restate the rollback condition in the new terms: the gate fires when the exact test does not reject or the effect falls short of the pre-registered minimum, not when an interval crosses zero.
- A decision recorded under the old rule no longer loads. No such record is committed, so nothing breaks today; the refusal is deliberate rather than a silent reinterpretation.
- Still open: the evaluation itself has not been run, so the rule has no data. `verify-self-evolve-eval` keeps failing on a `rollback` record, which remains the mechanism that turns a negative result into a red CI.
