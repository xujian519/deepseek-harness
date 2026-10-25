---
kind: upgrade-guide
description: "The office-action answer manifest gained a model-backed `generate_keywords` stage, so run records list 13 stages and recap callers must supply that stage's output."
---

# Office-action answers now carry a search strategy

English | [中文](guide.zh.md)

## Change

`patent_oa_response_v1` gains a `generate_keywords` stage between `adversary-model` and `draft`. It runs the existing `keywords` atom, which is model-backed and makes no network call, so the manifest is now 13 stages with 4 model stages (the shipped budget stays 24/12).

`draft` names that stage in `consumes`, so the generated keywords reach the write-up, and its guidance now requires the 证据与引用 section to state an executable retrieval plan — keyword groups covering hypernym, hyponym and synonym terms, the IPC/CPC classes to query, the databases, and what each query is meant to settle — while forbidding an unperformed retrieval reported as completed and invented document numbers or publication dates.

`WorkflowRunResult` records for this manifest therefore list the additional stage, and a summary reads `n/13`. `patent_workflow` recap mode assembles whatever the caller supplies: outputs keyed by stage id without a `generate_keywords` entry mark that stage degraded, which is how a missing stage reads today.

The `patent-oas` gate in `packages/self-evolve/self-evolve-benchmark/examples/patent-oas/gate.yaml` no longer exempts `prior-art-search` and `deliverable-format` on the workflow surface; the `surfaces` mechanism itself stays.

## Migration

1. Callers of `patent_workflow_run` for office-action answers need no argument change — stage definitions come from the manifest. Expect one additional model call per run. Confirm through the persisted record at `data/cases/<caseId>/workflow-runs/<caseKey>__patent_oa_response_v1.json`: `stages` includes `generate_keywords` and `degradedSteps` stays empty.
2. Recap callers that assemble the answer themselves (`patent_workflow`) must pass a `generate_keywords` entry in `outputs` alongside the stages they already supply, or accept that stage marked degraded.
3. Anything asserting on a persisted record for this manifest — stage id lists, the `n/12` summary text, per-round stage counts — moves to 13 stages. Recorded session snapshots under `snapshots/session/patent-oa-response/` and `snapshots/session/patent-oa-chain/` are re-recorded with `pnpm run test:snapshot:record`.
4. Answers you review after upgrading should carry the retrieval plan in 证据与引用. If a deliverable states document numbers for a search nobody ran, that is the failure the guidance forbids; report it rather than treating the section as filler.
