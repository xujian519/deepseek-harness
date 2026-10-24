# Agent Note: Seven-step legal generalization boundary

Status: proposed

English | [中文](2026-10-24-seven-step-legal-generalization.zh.md)

## Problem

The adversarial seven-step method was built for patent prosecution, where a written office action names the statute, the claims, and the prior art. Its steps are: dispute framing, coupled collection, rule lock, triadic binding, risk ranking, a bounded revision loop, and dual-track checks. R1 asks whether that structure transfers to legal work whose facts are narrative, whose procedure changes the applicable rule, and whose "opponent" may be a court rather than an examiner.

The answer decides the scope of M4 (the legal-mode mount). Shipping the patent pipeline into legal mode unchanged would import assumptions the legal tasks do not satisfy; shipping nothing would leave `rule_check` and the knowledge tools as isolated aids. This note records the mapping, three desk walkthroughs, and a scoped recommendation. It is design evidence: no legal benchmark was run, and every claim about model output is labelled as inference.

## Proposal

Treat the method as **conditionally generalizable** and scope M4 to the steps whose inputs and outputs survive the legal domain:

1. Keep **rule lock** as the shared first-class step. `rule_check` already decides article validity and effective dates from the shipped law index and lineage; legal citations need the same four-state answer.
2. Keep **triadic binding**, but bind legal elements rather than patent claim features: `element → supporting facts → evidence`, with the rule reference attached to each element. Do not reuse the claim-chart schema.
3. Keep **risk ranking** over unresolved issues, with severity, probability, impact, and a named mitigation. The ranking stays deterministic; the model supplies the items.
4. Keep **dual-track checks**: one track for formal compliance (citation form, quality-gate P0/P1), one for substantive support (does the cited rule carry the proposition). The existing `legal-citation-check` and `legal-quality-gate` are the two tracks.
5. Rewrite **coupled collection** for legal facts. Patent collection extracts PFIE features from a technical disclosure; legal collection starts from a narrative and an evidence list, and its output is a fact/evidence gap list, not a feature vector.
6. Keep the **bounded revision loop** only with explicit human decision points. The legal preset already forbids unapproved strategy, settlement, and external delivery; the loop must stop at those points rather than revise through them.
7. Do not port patent's **dispute framing** literally. Patent framing resolves rejection grounds against a statute list; legal framing resolves claims, causes of action, or contract clauses against a procedural stage. A legal-specific issue-framing atom is required, not a renamed patent atom.

M4 therefore continues with four adapted steps plus two legal-specific additions (issue framing and evidence mapping); it does not become a second patent workflow.

## Mapping matrix

Verdicts: **reuse** means the patent mechanism's inputs and outputs survive unchanged; **adapt** means the step survives but its schema or prompt must change; **not applicable** means the step's premise fails in that task family.

| Step | Litigation / arbitration | Contract review | Compliance / regulatory | Legal research | Transactional / corporate |
|---|---|---|---|---|---|
| ① Dispute framing | Adapt: issues come from pleadings and procedural stage, not rejection grounds | Adapt: clauses and risk allocation replace causes of action | Adapt: obligations and triggers replace disputes | Not applicable: a research question has no opponent | Adapt: deal terms and closing conditions |
| ② Coupled collection | Adapt: narrative facts, evidence list, burden of proof | Adapt: contract text, annexes, prior amendments | Adapt: licences, filings, regulator guidance | Adapt: official sources and version history | Adapt: diligence documents and schedules |
| ③ Rule lock | Reuse: statute, judicial interpretation, effective version | Reuse: Civil Code and contract-specific rules | Reuse: regulation and guidance versions | Reuse: the core of the task | Reuse: company law and filing rules |
| ④ Triadic binding | Adapt: element → fact → evidence, with burden | Adapt: clause → risk → consequence | Adapt: obligation → control → evidence | Adapt: proposition → authority → quotation | Adapt: condition → document → closing step |
| ⑤ Risk ranking | Reuse: rank issues by severity and probability | Reuse: rank clauses by exposure | Reuse: rank gaps by enforcement likelihood | Adapt: rank open questions by decisiveness | Reuse: rank closing risks |
| ⑥ Bounded revision loop | Adapt: stop at strategy and settlement approvals | Adapt: stop at external-send approval | Adapt: stop at filing and submission | Adapt: stop before reliance on an unverified authority | Adapt: stop at signature and closing |
| ⑦ Dual-track checks | Reuse: citation track + quality gate | Reuse: citation track + quality gate | Reuse: citation track + quality gate | Reuse: citation track + authority check | Reuse: citation track + quality gate |

## Desk walkthroughs

These are design walkthroughs: the inputs are representative, the intermediate artifacts are the schemas proposed below, and no model was called. They test whether each step has a concrete output a reviewer can inspect; they do not measure accuracy or cost.

### Walkthrough 1 — Litigation issue analysis

Input: a sale-contract dispute narrative, a document list, and the procedural stage (first instance).

| Step | Intermediate artifact | Failure point |
|---|---|---|
| ① | Issue list: payment claim, quality defence, limitation period, jurisdiction | The narrative does not name the cause of action; the model must ask or state an assumption |
| ② | Fact/evidence table with a gap column | Facts stated without a document; burden allocation left implicit |
| ③ | Locked rules: Civil Code contract and limitation provisions, with effective dates | A superseded judicial interpretation is easy to cite from memory |
| ④ | Element → fact → evidence rows for each issue | One fact supporting two elements must be flagged, not duplicated silently |
| ⑤ | Ranked issues with severity and probability | Ranking can look precise without a stated basis |
| ⑥ | One revision round after the opponent's strongest argument; stops before strategy approval | The model may treat a plausible counter-argument as a reason to change strategy |
| ⑦ | Citation check plus quality gate | A citation can be formally valid and still not carry the proposition |

### Walkthrough 2 — Contract risk review

Input: an NDA with a governing-law clause, a non-compete clause, and a liability cap.

| Step | Intermediate artifact | Failure point |
|---|---|---|
| ① | Clause-level review plan: scope, term, breach, remedies | Treating a business preference as a legal defect |
| ② | Clause inventory with missing annexes and undefined terms | The model fills an undefined term from general practice |
| ③ | Locked rules for contract formation, validity, and liability | Choosing a rule before the governing law is confirmed |
| ④ | Clause → risk → consequence → amendment rows | A risk stated without a consequence is not actionable |
| ⑤ | Ranked risks with a suggested owner | Severity inflation when every clause is "high" |
| ⑥ | One amendment round; stops before external send | The model rewrites commercial terms it was not asked to change |
| ⑦ | Citation check plus quality gate | A legally correct clause that contradicts the client's instructions |

### Walkthrough 3 — Statutory research memo

Input: a question about whether a type of conduct falls within a statutory prohibition.

| Step | Intermediate artifact | Failure point |
|---|---|---|
| ① | Question decomposition: conduct, actor, time, jurisdiction | The question hides a procedural premise |
| ② | Official-source list with retrieval dates | Search summaries substituted for the text |
| ③ | Locked provision with effective date and validity state | The current version is assumed from memory |
| ④ | Proposition → authority → quotation rows | A paraphrase presented as a quotation |
| ⑤ | Ranked open questions by decisiveness | The memo answers the easy sub-question and leaves the decisive one open |
| ⑥ | One revision round after an authority check; stops before reliance on an unverified source | The model treats a secondary source as authority |
| ⑦ | Citation check plus authority check | A valid citation that does not support the proposition |

## Required legal-domain schema and atoms

The legal domain needs these records; the first two are new, the rest have patent counterparts that must not be copied verbatim.

- `LegalIssue`: issue id, cause of action or defence, procedural stage, elements, burden of proof.
- `LegalElement`: element id, proposition, supporting fact ids, evidence ids, rule references.
- `EvidenceItem`: source, authenticity, legality, relevance, chain of custody, retrieval date.
- `RuleBinding`: statute, article, paragraph, effective date, validity state, holding.
- `RiskItem`: issue id, severity, probability, impact, mitigation, owner.
- `DecisionPoint`: human approval, options, consequences, approval state.
- `ReviewRecord`: round, changes, unresolved gaps, reviewer.

Atoms to add or adapt: `legal-issue-framing` (new), `legal-element-binding` (new), `legal-evidence-mapping` (adapts the existing evidence engine), `legal-risk-ranking` (adapts the patent ranking), `legal-adversary-review` (new prompt, same bounded-loop contract). `rule-lock`, `legal-citation-check`, and `legal-quality-gate` already exist and stay.

## Alternatives considered

**Port the patent pipeline wholesale.** It would ship a working engine on day one, but its dispute framing and claim-chart schema encode patent-specific premises (rejection grounds, claim features, prior-art documents). Legal walkthroughs fail at step ① before reaching the reusable steps.

**Keep prompt-only legal mode.** The current legal preset already has an eight-step prompt and more than a hundred skills; adding no structure costs nothing. It also leaves the two failures R1 found: narrative facts are not separated from evidence, and a citation can pass the formal check while failing the substantive one.

**Build a separate legal seven-step engine from scratch.** It would fit the domain, but it duplicates `rule_check`, the evidence engine, and the quality gate. The walkthroughs show the reusable steps are the majority; a from-scratch engine would re-earn the same contracts.

## Acceptance criteria

- The matrix covers at least five legal task families and every cell names reuse, adaptation, or non-applicability.
- At least two walkthroughs produce inspectable intermediate artifacts and name a failure point per step.
- The recommendation states whether M4 continues and which steps it includes.
- Counterexamples and failure points are recorded, not only successful cases.
- No product code changes are made by R1 itself.

## Risks

The evidence is design-level: no legal benchmark was run, so the claimed gains in citation accuracy and missed issues are unmeasured. Legal tasks vary by jurisdiction and procedure, and the matrix's five families are a coarse cut. Structured steps add cost; a legal team may prefer the prompt-only mode for low-stakes work. The proposed atoms could become a second vocabulary if they are not mapped onto the existing evidence and quality-gate services.

## Related

- Issue #558 (R1 research scope) and #551 (milestone tracker).
- `packages/bundle/web-app/presets/legal.patch.yml` (the current legal-mode composition).
- `packages/patent/patent-law/src/rule-lock.ts` (the reusable rule-lock contract).
