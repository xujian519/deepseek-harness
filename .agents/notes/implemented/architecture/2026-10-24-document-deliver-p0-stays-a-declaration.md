# Agent Note: The document P0 gate stays a declaration, not an execution point

Status: implemented

English | [中文](2026-10-24-document-deliver-p0-stays-a-declaration.zh.md)

## Problem

`document_deliver` accepts `gate.p0`, a list of the quality-gate skill's stable ids (`P0-1` … `P0-6`) that the model claims it checked. Three separate statements about that list disagreed: the parameter schema called it "已通过并核验的 P0 自检项" and told the model "P0 全过才允许登记", the tool description said the findings are written beside "P0/P1 自检项", and the implementation recorded the list without verifying it. A model reading the schema would conclude the tool checks the claim; a reviewer reading the same text would conclude the same. Neither is true, and the delivery studio renders both columns side by side, so the wrong reading is the one an operator carries into a delivery review.

The same disagreement invited a specific design proposal: refuse a registration whose `p0` does not name all six ids. That proposal reads as a tightening — a delivery that cannot state its checklist cannot be registered — and it is the reason this note exists. It fails on what the ids can prove.

## Decision

**`document_deliver` records the P0/P1 claim and never verifies it.** The parameter description states that the ids are the model's self-report, that the tool records them beside its own deterministic findings, and that an id the call left out or wrote unrecognizably comes back as a registration warning rather than a refusal. The tool description and the README state the same: the machine-decidable checks alone decide whether the call is refused, and they cover placeholders, undeclared anchors, empty sections, the style's forbidden words, and the declared character budget. Whether the P0 claim is true is a reviewer's question, not the tool's.

**The listing is not a gate, and refusing on an incomplete list would not create one.** Requiring all six ids proves that the model typed six strings. It says nothing about the six subjects those ids stand for: whether names follow the convention, whether the file is self-contained, whether sources are cited. The ids are a vocabulary for a claim, and a claim with all six entries is exactly as trustworthy as one with two. The check that could refuse a delivery already runs, on the content, and refuses on a blocking finding. Adding an id-completeness refusal would put a second, weaker refusal in front of it and invite a model to satisfy the list instead of the document.

**Gating the declaration on itself decides nothing.** A gate binds a prerequisite to a later call. In `patent` mode both parts exist: the prerequisite is an intermediate act (the round's rule, citation, and archive runs), and the gated call — `render_patent_document` — is the domain's one sanctioned production path, so refusing it stops a deliverable from shipping by any route. Document mode has neither part. The bytes are written first, by whichever route the work needs: hand-written Markdown and HTML, `render_doc_template`, the user-level `officecli` skill for `.docx` and `.pptx`. Registration is a terminal declaration — no tool is called after it — so refusing it changes no file and blocks no delivery; the deliverable already exists and the session ends either way. A refusal there removes the log entry that the delivery studio and any later review read, which is strictly worse than recording a claim that is visibly a claim.

**The unknown-id path names every missing check.** A call naming only unrecognizable words previously reported just the wording that missed, so a receipt showing one line read as one unstated check while six were unstated. `p0ChecklistWarnings` now emits the full missing list whenever any id is absent, whatever the other entries were. The receipt keeps the unknown-id line — the wording that missed — and adds the line naming all six. "One of six" and "six of six" are the same count in a transcript and different claims about the delivery, which is why the count alone cannot carry it.

The three surfaces now state one rule: the tool description, the `gate` and `p0` parameter descriptions, and the README all say the claim is recorded rather than verified, and the preset persona says the model checks P0 itself.

## Alternatives considered

**Refuse a registration whose `p0` omits an id or names an unknown one.** The proposal this note answers. It measures the spelling of a claim, not the document, and it would train the model to produce six strings — the cheapest way to pass — while the content checks that actually refuse a delivery stay unchanged. It also has a replay cost: the recorded `document-deliver` scenario registers `gate.p0: ["命名规范"]`, an unknown wording, precisely so that a model which guessed a wording learns the ids without losing its registration.

**Verify the P0 items inside the tool.** Each item is a judgement about the document's purpose — is this name conventional for its audience, is this the intended source — and the tool reads bytes, not intent. The parts that can be decided mechanically are already separate checks with their own findings, so verifying the rest would mean inventing a second, weaker opinion and reporting it beside the real one.

**Gate the registration on the checks having been run in-session.** This is the shape that works in `patent` mode, where a ledger fed from `tools/post-execute` records which prerequisite runs succeeded. It does not transfer: the document checks are internal to `document_deliver` itself and run on every call, so there is no separate prerequisite whose absence could be detected, and the tool that would be gated is the one that owns the checks.

**Keep the schema wording and clarify only the README.** Rejected: the schema is what the model reads at call time and what a reviewer reads in the recorded header. Prose elsewhere cannot correct a description that says the tool verifies the list.

## Consequences

- A delivery receipt reports the claimed P0/P1 counts and the tool's own findings as separate columns. Neither column implies the other, and the studio shows both.
- A model that names an unknown id, or omits ids, is told what the vocabulary is and what is unstated, and the registration still succeeds. The transcript keeps the claim, so a later review can see that the claim was incomplete.
- Nothing about this mode stops a session from ending with an unregistered or unverified deliverable. That gap is recorded where the design was chosen rather than closed here: the mode's README states that the reported checks are not a review and that a gate would need a delivery-finalization call, not a condition on this one.
- The wording is model-visible text pinned by two keyless snapshots: `snapshots/session/document-deliver/` (its `document_deliver` schema sidecar and the receipt the recorded turn produces) and `snapshots/web/legal-preset/`, whose preset mounts the same plugin and therefore pins the same schema. A change to any of these descriptions fails both replays until the sidecars are refreshed.
