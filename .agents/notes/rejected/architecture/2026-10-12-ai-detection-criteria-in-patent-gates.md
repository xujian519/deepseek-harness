# Agent Note: Statistical AI-text detection in the patent gates

Status: rejected — statistical AI-text criteria (perplexity, burstiness, lexical richness) enter no patent gate; compliance rests on process traceability

English | [中文](2026-10-12-ai-detection-criteria-in-patent-gates.zh.md)

## Problem

Patent work carries a compliance dimension that patentability law does not cover: a filed application, an OA response, or a client opinion must be the work of a qualified practitioner, and a client may ask for evidence that a deliverable is not machine-generated text passed off as human work. The tempting instrument is a statistical detector — perplexity or log-likelihood under a reference model, sentence-length burstiness, type-token ratio, hapax rate — run over the delivered text, with a hit downgrading a score or blocking the delivery.

Measured on Chinese patent text, that instrument does not hold. Detectors tested at claim level show a false-positive rate of 61.3–80.5%, with an IPC-wide mean of 84.6%; the lexical-richness signals run backwards on patent prose (TTR |d| = 1.11, hapax |d| = 1.17, both in the direction opposite to the human/machine split they are used to detect); a detector restored from its published scoring head recovers TP = 0; 74% of the tested classifiers are reported as fit only for triage. A criterion that labels most human-drafted claims as machine-written is not a compliance gate; it is noise carrying legal consequence.

## Proposal

Add an AI-text detection criterion to the patent domain: a rule in the output gate (or a penalty in the writing quality score) that measures perplexity, burstiness, or lexical richness over a deliverable and warns, blocks, or downgrades it when the measurement lands in the machine-like band. The same criterion would back a statement in the drafting skills that a text "reads as AI-generated".

## Why it is rejected

The criterion cannot separate the two classes on the text this repository produces, and its error is asymmetric in the worst direction: a false positive accuses a practitioner's own drafting, while a false negative certifies machine text as human work and buys false assurance. Neither error is repairable by tuning a threshold, because the discriminating signal does not exist in the text (the lexical measures invert on patent prose). The harness also owns no model weights or training pipeline, so the only version of this criterion available here is the broken one.

The compliance question itself stays answered — by process, not by text statistics.

## Alternatives considered

### A. Process traceability (adopted)

Record the work rather than judge the prose: the session log already holds which agent produced each artifact, every tool call that shaped it, and where a human gate admitted it; the delivery gate already refuses a deliverable whose prerequisite gate runs are missing; `patent-workflow-run` manifests already name the stage and its closure. Compliance evidence is then a property of the recorded process, which a reviewer can replay, and it does not depend on a classifier that mislabels four out of five human claims.

### B. Statistical text criteria (rejected)

The measured false-positive rates above. Beyond the rates, the criterion is unenforceable in this repository: it would need a reference model at gate time, and a threshold whose calibration is neither citable nor stable across technical fields.

### C. A trained domain classifier (rejected)

The measured recovery experiment (TP = 0 from the published head) and the reported triage-only quality of most tested classifiers show the training route does not reach a gate-grade signal. It also requires a training and weight-distribution pipeline the harness does not have.

### D. Phrase the criterion in `stop-patent-slop` prose (rejected)

That skill's style guidance — predictable boilerplate, empty argumentation, thin vocabulary — describes writing quality, not who wrote the passage. Presenting thin vocabulary as evidence of machine authorship would turn a style note into a detector claim, and the lexical measures that would have to support it invert on this corpus. The style guidance stays what it is: a writing rule for patent prose.

## Acceptance criteria

If a future proposal reopens this decision, it must supply, for the intended artifact classes and technical fields: (1) per-class false-positive and false-negative rates measured on real filings, with the sample and the field distribution named; (2) a discriminating signal that does not invert on patent prose; (3) a standards or examination-guideline basis for the criterion, since a compliance rule states an obligation a practitioner can verify; (4) a named owner for the reference model or weights and their availability at gate time; and (5) replay evidence that every false positive it still produces is adjudicated rather than shipped as a warning to the model.

## Risks

The rejected criterion is attractive precisely because it appears to answer a compliance question cheaply, so the decision needs a stated failure mode to survive re-proposal: shipping it would inject warnings into the model's context and into delivery records for work that is human-authored, and the resulting false accusations would outnumber the true ones by roughly four to one on this corpus. The inverse risk — reading this note as a claim that the domain needs no authorship discipline — is covered by alternative A, which owns that requirement.
