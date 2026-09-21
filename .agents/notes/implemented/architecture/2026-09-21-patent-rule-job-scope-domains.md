# Agent Note: Job scopes for the patent rule gate

Status: implemented

English | [中文](2026-09-21-patent-rule-job-scope-domains.zh.md)

## Problem

`rule_check` offered one rule set per scope: the fixed compliance file (`patent`), the electrical merge (`patent-electrical`), the merged full asset set (`patent-full`, 117 rules), and the project pack. The four job classes — office-action answer, invalidation, reexamination, infringement — had no scope of their own, so checking a job's deliverable meant either the four general compliance rules or every bundled rule, including the domains of unrelated jobs.

The ported upstream job table (`builtinPatentManifests[].checkDomains`) cannot serve as the mapping in this repository. It was written against the checker engine's own rule set, and three of its domains (`patent_invalidation`, `patent_reexamination`, `patent_amendment`) hold no rule in this package's assets, while the mirrored assets declare domains it never named (`patent_oa_response`, `patent_procedure`, `patent_general`, `patent_utility`).

## Decision

`PATENT_CASE_DOMAINS` (`packages/patent/patent-rule/src/runtime/patent-compliance.ts`) maps four job scopes to the rule `domain` lists they evaluate, and `rule_check` accepts those names as `scope` values. The rule set stays the merged full asset set with its activation overrides; the domain filter applies at evaluation time, so the scopes share one load and one cache entry each.

A scope evaluates the common domains (`patent`, `patent_general` — the compliance rules and the general-practice rules, which apply to every patent deliverable) plus its own document and procedure domains and the domains of the clauses it must answer or establish:

| Scope | Manifest | Rules |
| --- | --- | --- |
| `patent-oa-response` | `patent_oa_response_v1` | 105 |
| `patent-invalidation` | `patent_invalidation_v1` | 97 |
| `patent-reexamination` | `patent_reexamination_v1` | 105 |
| `patent-infringement` | `patent_infringement_v1` | 39 |

The domains of the substantive clauses come from the reason tables this repository owns: the rejection-type table in `packages/patent/patent-core/src/notice/office-action.ts` and the grounds tables in `.../notice/grounds.ts`. Both name the same clause set — novelty (22.2), inventiveness (22.3), utility (22.4), sufficient disclosure (26.3), claims (26.4), amendment (33) — which the assets carry as `patent_novelty`, `patent_inventiveness`, `patent_utility`, `patent_disclosure`, `patent_claims` and `patent_procedure`.

Office-action answers and reexamination requests evaluate the same domain set: the reexamination reason table is the invalidation table plus the utility-model subject-matter defect, and that defect is a common-domain rule, while a reexamination request is an answer-shaped brief. The two stay separate scope names because the model picks its entry point by job, not by domain vocabulary; a job whose assets later gain a domain of its own (`patent_invalidation` rules, for instance) splits the lists there without changing the names. Invalidation carries no answer-practice domain — those rules are worded for answering office actions (point-by-point response, reply deadlines) and fire on an invalidation request. Infringement carries only its own domain, since the drafting and examination domains hold completeness checks that fire on an infringement opinion.

`evaluateText`'s `domain` option accepts one domain or a list, with rules that declare no domain always evaluated; that matches `RuleEngine.evaluate` in `packages/patent/patent-core/src/checker/engine.ts`, which already takes `string | readonly string[]`.

## Alternatives considered

**Reuse the ported upstream job table unchanged.** Rejected: it points at three domains with no rules here, so a job scope built from it would silently evaluate fewer rules than its name implies, and it omits the answer-practice, procedure and utility domains the current assets carry.

**One scope per asset domain.** Rejected: the caller would have to know the asset's domain vocabulary to select a check, which is exactly what a job-named scope removes; `patent-full` already covers the union.

**Filter the rule set in a loader and hand the tool a narrower `RuleSet`.** Rejected: `evaluateText` already owns "declared domain not selected ⇒ skip, no domain ⇒ always run", and a second filter would be a second home for that rule. The tool passes the domain list and the engine keeps the semantics.

**Derive the scopes from the reason tables at runtime instead of listing domains.** Rejected: the reason tables recognize clauses by their wording and know nothing about rule domains, so the derivation would couple the notice module to rule-asset vocabulary for a static four-row table.

## Consequences

The full asset set is unchanged at 117 rules; the four scopes evaluate 105 / 97 / 105 / 39 of them, and their union covers every domain in the merged set, so no asset domain lacks a job entry point — a test fails when a new asset domain belongs to no scope.

The filter narrows the rule set; it does not classify the text. The assets' completeness checks (`structural_analysis`) report missing expected elements on any text, so a scope run over a document of another type still returns those hits — measured on one short four-sentence sample: 69 hits under `patent-oa-response` and `patent-reexamination`, 68 under `patent-invalidation`, 22 under `patent-infringement`, against 79 with no filter.

The four job skills do not reference their scopes yet: they gate delivery through `patent-quality-gate` and call `rule_check` with the default `patent` scope, and pointing them at the job scopes would re-record the system-prompt pins of the recorded job-chain scenarios.

## Testing

`packages/patent/patent-rule/tests/case-scopes.spec.ts` pins the four scope names, that every listed domain is declared by the bundled assets (a typo would otherwise narrow a scope silently), that the union covers the merged set's domains, that no scope reports a rule from a domain outside it, that domain-less rules run in every scope, and one in-scope hit plus one out-of-scope absence per class of scope. `tests/rule-engine.spec.ts` carries the `domain` option's single-value, list, empty-string and empty-list behaviour. `packages/patent/patent-tools/tests/drafting-engine.spec.ts` runs the same text through `patent-full` and `patent-infringement` to show the filter, and checks the unknown-scope error lists the job scopes.
