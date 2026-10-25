# Agent Note: Carrying the OA answer's search strategy through the manifest

Status: implemented

English | [中文](2026-10-26-patent-oa-search-strategy-stage.zh.md)

## Problem

`patent_oa_response_v1` ended at the answer text. The office-action work the product performs — parse the notice, chart the claims against the cited document, plan the response, test the plan from the opposing examiner's seat, write, check — never asked what would be searched next. `patent-oas` measured that manifest under `--execution workflow` and found the gap in the readings: dimension 5 of `oa-answer` ("检索策略与答复格式") scored 45.0 and both nodes it feeds, `prior-art-search` and `deliverable-format`, were below the node floor, so the surface was accepted with those nodes exempted. See [measuring the OA workflow surface through the product executor](../process/2026-10-25-patent-oas-workflow-surface-measurement.md); it recorded the removal condition — once the manifest produces search evidence, delete the exemption.

Closing the gap is constrained by two properties of the measurement.

The deliverable is the only thing the judge reads. The collector passes one rubric dimension plus the `draft` stage's saved file to each evaluator call; intermediate stage artifacts — the claim chart, the response plan, a keyword list — enter no prompt. A stage that produces evidence nobody sees changes no reading, so an exemption would survive a stage that was merely added.

`oa-answer` is captured under `retrieval: oracle`. The cited document D1 and the common-general-knowledge assertion are written into the case statement, and the gate treats `retrieval` as a comparability axis: an `oracle` reading and a `simulation` reading are not compared. The repository has no controlled retrieval corpus — `simulation` exists as a declared value with no fixtures — so any stage that actually retrieved would move this case onto an axis the benchmark cannot currently record.

## Decision

**`patent_oa_response_v1` gains `generate_keywords`, the shared keyword stage, and not a retrieval chain.** The manifest reuses `SEARCH_KEYWORDS_STAGE` from [packages/patent/patent-workflow/src/workflow/manifests.ts](../../../../packages/patent/patent-workflow/src/workflow/manifests.ts), the same stage the novelty, inventiveness, disclosure and patentability manifests place before their `search` atom. It sits between `adversary-model` and `draft`, and `draft` names it in `consumes`, which is how an atom-less stage receives upstream output. The `keywords` atom is model-backed and touches no network: it reads the run's material through its existing input chain (`pfe_triples` → `extraction_result` → `source_text`/`text`/`input`) and writes a `keywords` array. The manifest is now 13 stages with 4 model-backed ones, inside the shipped 24/12 budget.

**The strategy belongs in the deliverable, and an unexecuted search may not be reported as executed.** `draft`'s guidance requires the 证据与引用 section to state keyword groups covering hypernym, hyponym and synonym terms, the IPC/CPC classes to query, the databases to query, and what each query is meant to settle — whether a distinguishing feature is common general knowledge, or whether a combination has a motivation. The same line forbids writing an unperformed retrieval as completed and forbids invented document numbers and publication dates. `prior-art-search`'s observable is an executable strategy plus grounded conclusions, which a stated plan meets under the oracle case; the prohibition is what keeps a fabricated comparison document from scoring.

**The exemption is deleted, not narrowed, and the mechanism stays.** [examples/patent-oas/gate.yaml](../../../../packages/self-evolve/self-evolve-benchmark/examples/patent-oas/gate.yaml) declares no `surfaces`. Parsing, the `validateGateConfig` checks (real node ids, at least one bound node, at least one assessable node left) and the `[not-assessed]` verdict line remain, because "this manifest structurally cannot produce that node's evidence" is still worth expressing for another surface. The shipped policy being empty is itself pinned, and the scoping path is exercised against constructed configs.

**Dimension 5 keeps one observation for two nodes.** Splitting `deliverable-format` from `prior-art-search` needs a new rubric dimension in `cases/oa-answer/rubric`, which changes `goldDigest` and invalidates every committed record: both baselines would have to be re-captured, and the `headless` numbers would stop describing the measurement they were taken against — what #573 ruled out. The sharing is stated rather than hidden: `forEachNodeWeight` gives a dimension's score to every node mapped onto it, so a format-only defect is charged to the search node as well. If that coupling ever prevents a real judgement, the split is the next step and it arrives with re-recording both surfaces.

## Alternatives considered

**Add the live retrieval chain: `search`, then `prior_art_filter` with `time_baseline`.** Rejected. `search` calls the configured patent-search provider (`createNuoSearchProvider` over `@deepseek-ai/nuo-patent`), so which documents appear depends on an external index on the capture day; the deliverable would carry third-party text the benchmark cannot pin, and `oa-answer` would become a `simulation` case with no corpus behind it. The exemption removal exists to make the two surfaces comparable again; this made them comparable to nothing. It also needs filing and priority dates the case statement does not carry.

**Point the keyword stage at the distinguishing features instead of the notice.** Rejected: the atom already resolves its input through a documented chain, and the OA run seeds `source_text`/`text`/`input` with the notice, which contains both the cited document's disclosure and the claims under attack. A source selector for one consumer is a tunable without a second consumer.

**Keep the exemption and split the rubric dimension first.** Rejected: it leaves the evidence gap open while changing what the committed `headless` readings mean, and the split is only worth its re-capture cost once the deliverable contains a strategy to score.

**Score the keyword stage's own artifact instead of the deliverable.** Rejected: the graded object is the answer filed with the patent office. A side file that satisfies a node while the deliverable still omits the strategy would raise the score without improving the work product.

## Consequences

The re-captured keyed run (2026-10-25T17:54Z, one run of the two-round `oa-answer`, 13 stages per round) puts dimension 5 at 100.0, so `prior-art-search` and `deliverable-format` read 100.0 against the 70 node floor; the case scores 94.8 (rounds 92.3 → 94.8, claim versions 1 → 2) and the surface aggregate 94.76. The prompt surface measures 96.67 on that same dimension over three runs, so the cut the exemption declared absent is now read on both surfaces rather than one — what separated them was the missing stage, not a threshold, and no threshold moved. Both rounds' deliverables state keyword groups with hypernym, hyponym and synonym terms, named IPC/CPC classes, named databases, and what each query settles — and neither names a document number for a search nobody ran, which is the reading the guidance prohibition exists to protect.

The cost is one more model-backed stage per round — 26 stage executions and 14 agent calls for a two-round capture, 3,105,545 billed input and 21,739 output tokens — and the coupling the split was deferred on: `forEachNodeWeight` still hands dimension 5's single observation to both nodes, so a format-only defect reads as a search failure too. What is measured remains a stated plan, not retrieval yield; how well a query would actually hit stays unmeasured until a controlled `simulation` corpus exists, and adding the live `search` atom to this manifest would make that the recorded number instead of the strategy.

`prior-art-search` is now a node the workflow surface can fail: a later model, guidance or manifest change that drops the strategy section reads as a below-floor node rather than as an exempted cut, and the recorded session snapshots for `patent-oa-response` and `patent-oa-chain` carry the 13-stage shape. Related: [measuring the OA workflow surface through the product executor](../process/2026-10-25-patent-oas-workflow-surface-measurement.md), which this note satisfies the removal condition of, and [the patent evaluation measurement protocol](../process/2026-10-16-patent-eval-measurement-protocol.md).
