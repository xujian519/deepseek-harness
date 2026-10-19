# Agent Note: Patent delivery gates require result evidence

Status: implemented

English | [中文](2026-10-19-patent-delivery-gate-result-evidence.zh.md)

## Problem

The delivery gate recorded only that a prerequisite tool returned successfully in the session. `rule_check` and `law_verify` accepted blank text, returned `blocked: false`, and left that record; `patent_workflow_run` returned a successful result for any manifest id. A model could therefore satisfy `render_patent_document(template=oa-response)` without reading the draft, checking a citation, or running `patent_oa_response_v1`, so the persona's delivery discipline still rested on the prompt for exactly the calls it was meant to force.

Measured on the shipped tools before the change, `createRuleCheckTool().execute({ text: '' })` returned `{ blocked: false, scope: 'patent', violations: 0 }`, `createLawVerifyTool(...).execute({ text: '' })` returned `{ blocked: false, findings: 0, unrecognized: 0 }`, and the preset's closure entry accepted any successful `patent_workflow_run`.

## Decision

`rule_check` rejects blank `text` with `invalid_tool_input`; `law_verify` rejects blank `text` when no references are supplied with `no_input`. Both messages state that the call cannot stand in for a delivery prerequisite.

A `deliveryGate` entry may declare `evidence`, keyed by required tool: each condition names a top-level field on that tool's canonical result and an accepted exact value (`equals`) or a minimum array length (`minItems`). `tools/post-execute` extracts only the declared fields and stores them with the ledger record; `deliveryGateMissing` consults them per entry. A record that lacks a declared field or carries a different value leaves the prerequisite missing, and the denial names the field and the expected value. Evidence declared for a tool the entry does not require fails at load, because that condition could never be read.

The `patent` preset declares evidence on both delivery tools: `rule_check.evaluated` must be non-empty. Citation-bearing templates additionally require `law_verify.findings` to be non-empty. Each closure entry names its template's manifest (`patent_patentability_v1`, `patent_novelty_v1`, `patent_oa_response_v1`, `patent_invalidation_v1`, `patent_reexamination_v1`, `patent_infringement_v1`, `patent_disclosure_v1`) and requires `ok: true`; `search-report` and `search-report-form` accept either the patentability or novelty manifest. Application documents, forms, rectification, and right-evaluation stay outside the citation and manifest conditions where no law citation or manifest route exists.

## Alternatives considered

- **Reject only blank input at the tools.** It closes the zero-byte hole but leaves `patent_workflow_run` accepting any manifest and `law_verify` with no findings counting as a citation check.
- **Judge each tool's verdict in `patent-rule`.** Rejected: the gate would need to know three tools' result semantics, inverting the capability seam and turning a normal finding into a permanent block.
- **Compare the `rule_check` digest with the render draft.** Rejected for this change: the draft is structured JSON while `rule_check` receives prose, and a legitimate run may check a part of the deliverable. The gate records the identity now; matching it to the artifact needs a declared comparison the render arguments do not provide.
- **Hardcode the preset's manifest mapping in the plugin.** Rejected: which template owes which manifest is deployment policy, so the evidence declaration keeps it in the preset with the rest of the gate.

## Consequences

- Empty `rule_check` / `law_verify` calls no longer produce prerequisite records, and `render_patent_document(template=oa-response)` accepts only a successful `patent_oa_response_v1` closure.
- A deployment that adds a template route must declare the manifest in the preset; without such an entry the template keeps the prerequisite-only behavior.
- `patent_workflow_run` paused at its review gate still returns `ok: true`, so approval-gate semantics are unchanged; an unknown manifest or validation failure returns `ok: false` and no longer satisfies a closure entry.
- The ledger keeps the declared result fields for the session, not the full result; a field added to an evidence declaration after calls were recorded is absent from those records, so the prerequisite must run again.
