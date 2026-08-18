# @deepseek-ai/dsh-self-evolve-basic

English | [中文](README.zh.md)

The **`BasicSelfEvolveEngine`** is the default provider of `ctx.selfEvolve`. It wires the `failure-patterns` projection unit, triggers evolution loops on idle or explicit request, and commits narrow L1 (skill) and L2 (prompt-section) proposals through reversible Cordis effects.

## Role

| Package | Role |
|---|---|
| `@deepseek-ai/dsh-self-evolve` | Service Definition: abstract `SelfEvolveEngine` + durable events |
| `@deepseek-ai/dsh-self-evolve-basic` (this) | Service Provider: projection-driven idle-pressure policy + base proposer/validator |
| `@deepseek-ai/dsh-tool-self-evolve` | Consumer: model-facing tools and prompt section |

## Configuration

`BasicSelfEvolveConfig` controls trigger policy, rate limits, default edit surfaces, and validation tolerances:

| Field | Default | Semantics |
|---|---|---|
| `maxDailyLoopsPerSession` | `4` | Maximum autonomous loops started per session per 24-hour window; explicit `user-command` loops bypass it. |
| `triggers` | all enabled | Per-trigger `{ enabled, minIntervalMs }` policy for `idle-maintenance`, `pressure`, `user-command`, and `validation-retry`. |
| `defaultLevels` | `['L1-skill', 'L2-context']` | Edit surfaces proposals may target by default. |
| `minPatternOccurrences` | `2` | Minimum occurrence count before a pattern becomes a proposal target (`tool-runtime` patterns require one extra). |
| `maxProposalsPerLoop` | `2` | Maximum proposals generated per loop. |
| `requireDualVerification` | `true` | Held-in dual-verifier gate (翁荔 challenge 1): when both verifier signals are available, a proposal passes only if replay AND workspace checks pass; single-sided pass is rejected without counting a regression. Missing signals degrade to the weak rate 0.3 instead of faking acceptance. |
| `minAcceptConfidence` | `0.5` | Acceptance gate: `min(deconstructedScores) × heldInRate × heldOutRate` must reach this value. Unverifiable proposals (weak rates 0.3) are rejected as `low-confidence`. |
| `maxHeldOutCases` | `5` | Similar-history events searched and replayed as held-out cases per proposal (P1.3). |
| `minHeldOutPassRate` | `0.6` | Held-out pass-rate threshold (P1.3): similar-history replays passing at or above this ratio count as held-out-passed. |
| `proposerTarget` | none | Optional `{ provider, model }` routed for the proposer LLM call. |
| `validatorTarget` | none | Optional `{ provider, model }` routed for the validation LLM judge (P1.4). Must differ from `proposerTarget` or load fails. |
| `maxDirtyLinesAddedPerCommit` | `2` | Dirty-line tolerance for the held-in workspace verifier; unused until a subclass supplies workspace signals (P1.3). |
| `maxPromptInflationBytesPerWeek` | `2048` | Long-horizon prompt-inflation budget (翁荔 challenge 7): when live self-evolve L2 sections exceed it, the pruning job archives the oldest to `$DSH_HOME/self-evolve/l2-archive/` and disposes their effects (P1.9). |
| `l4ReapprovalHours` | `24` | L4 re-approval cadence (P2.3): a plugin this provider drove is forced through human approval again when the current proposal differs from the last approved one or the approval is older than this window — even over `approveFutureVersions` grants. |
| `maxStepReflectionsPerTurn` | `1` | Step-reflection throttle (P3.1): a low-budget LLM reflection on a failing step runs at most this many times per turn; `0` disables it. |
| `reflectionMinConfidence` | `0.85` | Minimum model-reported confidence for a step reflection to reinforce a pattern via a `self-evolve/reflection` event (P3.1). |
| `patternFreezeHours` | `24` | Per-pattern proposal freeze (P3.3): after two proposals, a pattern is skipped for this window (diversity-collapse guard). |
| `maxBudgetCharsPerLoop` | `32768` | Per-loop byte budget for LLM calls and searches (P3.4); exceeding it aborts the loop with `budget-exceeded` and closes the bracket with an error. |

L3 and L4 proposals are not implemented by this base provider; downstream providers can subclass `proposeForPatterns()` and `validateProposal()` safely.

## Validation pipeline (Phase 1)

`validateProposal` runs the Phase 1 pipeline: held-in dual verification (fork replay P1.2 + workspace signal), held-out similarity replay over `sessionQuery.searchEvents` hits (P1.3), the LLM judge over `validatorTarget` (P1.4), and the aggregate confidence gate. Missing dimensions degrade to the weak rate 0.3, so unverifiable proposals are rejected conservatively instead of committing on trust. Rejected proposals land in the negative-results log (P1.7b), and two consecutive same-pattern regressions roll the archived champion back (P1.8).

## Negative results (P1.7b)

Rejected proposals are appended as one JSON line per rejection to `$DSH_HOME/self-evolve/negative-results.jsonl` (`{ts, patternId, proposalId, reason, diagnostic, deconstructedScores?, nextRoundSuggestion}`). `readNegativeResults(patternId, limit)` loads the most recent rows for one pattern, the template proposer summarizes them into its generated prompt-section text so repeated failed approaches are not proposed again, and `readPatterns` enriches each pattern's `verifierMeta.failedProposals` (P1.6).

## Model Experience

### Stable self-evolve guidance

#### What the model sees

A stable prompt section registered by `@deepseek-ai/dsh-tool-self-evolve` tells the model when to call `self_evolve_inspect_patterns` and `self_evolve_now`. This provider additionally registers runtime skills and prompt sections for accepted L1/L2 proposals; those contributions are scoped to the provider fiber and unwind on validation failure or disposal.

#### Token effect

Accepted prompt-section proposals append text to the system prompt for subsequent turns. Accepted skill proposals add retrievable skill content that may be included when the skill registry matches the turn context.

#### KV Cache effect

The stable tool-self-evolve prompt section is present on every request while the consumer is loaded, so it participates in the request prefix. Proposal-driven prompt sections and skills are added to the prefix from the turn they commit onward.

## Known Limitations and Deferred Work

- **L1/L2 only** — the provider targets skill (L1) and prompt-section (L2) proposals; L3-workflow and L4-harness requests produce no proposals yet.
- **No commits in the base bundle** — the held-in dual verifier needs the workspace signal, which the base provider does not implement (P1.3); with the weak rate applied to every missing dimension, `minAcceptConfidence` is unreachable, so base proposals are always rejected and only a subclass-supplied workspace signal (or an L3/L4 route) makes commits possible. This is deliberate conservatism, not a bug: an unverifiable edit must not go live.
- **No keyed end-to-end verification** — proposal effects are reversible commits covered by unit tests; a live `dsh --profile` loop run requires a keyed environment.
