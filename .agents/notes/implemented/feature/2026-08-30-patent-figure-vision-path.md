# Agent Note: analyze_patent_figure sends the drawing to the model

Status: implemented

English | [中文](2026-08-30-patent-figure-vision-path.zh.md)

## Problem

`analyze_patent_figure` shipped as a text-only minimal path: the ported wrapper kept the schema, the figure-description templates, and the numeral checks, but image bytes never reached a model — the prompt told the model to infer from the figure number and claim context, every result carried a "文本态最小路径" warning, and the P3.3 modality gate stayed unenforced because enforcing it would have denied the only usable path. Reading an uploaded drawing — the tool's headline purpose — did not actually work.

## Decision

Wire the image through seams that already existed instead of porting the Sati vision engine:

- `PatentModelMessage` gains `images?: readonly ImageAttachmentRef[]`; `createLlmModelPort` maps each ref into an image content block, so a tool-side sub-request rides the same provider path as session images (normalization, per-route policy, Files-API/base64 representation).
- The tool reads the drawing, admits the bytes through the harness attachment store (`ctx 'attachments'`), and sends the durable ref with the prompt on a dedicated figure-model port built on the gated route (`Config.imageModel` override → `provider`/`model` → deployment default). Gate verdict and wire route cannot diverge because both derive from `figureRoute()`.
- The P3.3 gate is now enforced before any file IO: a route whose declared modalities lack `image` is denied with `model_cannot_accept_image`; an unresolvable modality list counts as text-only; a missing gate resolver means un-gated (the deployment gave no capability source). A missing route, port, or attachment store fails loud with `setup_required` guidance. The text-inference path is gone — the README already documented the enforced-gate contract.
- `buildImageGateResolver` no longer returns a crashing closure when the llm service exposes no `resolveModelInfo`; it returns undefined (un-gated), which is what its contract already said.

Model-visible ⟺ logged holds without new session events: the logged tool arguments carry the image path, the bytes are durable in the attachment store, and the analysis result is in the tool result.

## Alternatives considered

**Port the two-step Sati PatentVision/PatentLMM engine.** The mode now exists behind the [FigureAnalysisEngine seam](2026-08-31-patent-figure-rendering-pipeline.md) (`Config.figureAnalysisMode`, default `single`); multi-figure consistency ships as multi-panel output plus family continuation in the same change; electrical netlists remain deferred.

**Inline base64 in the patent request vocabulary.** Rejected: it would fork a second image path beside the attachment pipeline and lose admission, normalization, and per-route policy.

## Verification

Unit coverage: gate denials (text-only / unknown / empty modalities) before any file IO, un-gated run without a resolver, `setup_required` for missing route/store, unsupported extension rejection, store-admission failure mapping, and the full vision path (saved ref travels on the request, prompt is image-grounded, `modelUsed` reports the gated route, index upsert). `createLlmModelPort` maps refs into image blocks. Plugin wiring test extended with an `attachments` service; 66 patent test files, 879 tests green.

The prompt and description changes are model-visible, but no recorded-session snapshot applies: `analyze_patent_figure` needs a live vision model and a real drawing, so it is covered by mock-port unit tests like the rest of the model-backed patent tools (the patent profile is not snapshot-registered).

## Consequences

Deployments must name a vision-capable figure route (`imageModel`, e.g. `deepseek-official`/`deepseek-v4-flash-vision-exp`) or the tool denies with guidance; text-only deployments lose the inference-only degrade by design. `recognize_chemical_structure`'s image mode remains a wrapper until the chemistry engine lands.
