# Agent Note: The case log's supersede chain as a delivery prerequisite

Status: implemented

English | [中文](2026-10-12-matter-log-supersede-chain-gate.zh.md)

## Problem

The patent case audit trail (`_matter-log.md`) was append-only by convention alone. The model wrote it with the generic file tools, so its field set, the appended-only rule, and the revision chain all rested on compliance. A version number was a self-declared line in a file header, so nothing recorded which deliverable replaced which, or why; nothing stopped a round from overwriting the previous round's file or from shipping with no entry at all. The round's changes, their reason, and their effect on the protection scope were then unrecoverable from the case.

The 2026-09-30 benchmark (`2026-09-30-patent-domain-external-benchmark.md`, item P0-1) put both gaps in one item and asked for an execution point rather than a stricter convention, with the adaptation this repository requires: keep the log as the source and the files as projections, and do not copy the source project's "timestamped filename is the version history" scheme.

## Decision

- `@deepseek-ai/dsh-patent-tools` registers a 33rd model tool, `matter_log_append`, the single writer of a case's `_matter-log.md`. One call appends one entry — local time plus UTC, action, artifacts, the paths this round replaces, approver, and the round's change summary — and touches nothing else; the bytes already in the file are preserved as a prefix.
- The free-text field carries the round's archival content: what changed, why, and whether it touches the protection scope. That is what the borrowed rule wants stated in the delivery round; here it is a field of the durable record rather than reply prose.
- The revision chain is judged before the write, from the log itself. An artifact must exist on disk (the log records facts, not plans); a `撰写` / `修订` round may not reuse a path the log already carries, because that is an overwrite where the rule is a fresh file plus a `supersedes` entry; a `supersedes` path must already appear in the log, or it is a fabricated reference that breaks the chain it exists to carry; one version may not be superseded twice, because the chain is a line and not a fork. Every defect of a refused round comes back in one message with its stable rule id and its fix.
- The entry is the case's round record, so it precedes the render: `patent.patch.yml` adds `matter_log_append` to the `deliveryGate` prerequisites of `render_patent_document` and `build_patent_filing`. A round whose entry is missing cannot ship its deliverable — the call is denied, and the denial names the missing step with the rest.
- The enforcement point is the delivery gate, not the reply. A reply-level point does exist: `agent/turn-stopping` is a serial turn-boundary hook, and a listener that calls `agent.steer(...)` makes the machine re-read its inbox and run another step in the same turn (`hooks-claude-code` bounds its own forced continuations that way). It is deliberately not used here; see the first alternative.
- `scripts/verify-preset-tool-refs` now resolves the tool names a preset's own `deliveryGate` / `structuralGate` declarations carry against the mounted tool set, not only the backticked prose references. A prerequisite naming a tool no mounted package registers denies the guarded call in every session while the declaration still reads as valid YAML, which is the one gate defect that leaves every other check green.

## Alternatives considered

- **A reply-level check over the delivery turn's text (`agent/turn-stopping` + `agent.steer`).** This is the literal shape of the borrowed rule — a fixed heading whose absence marks the round incomplete — and it is implementable. It lost because enforcing it means judging free reply prose against a heading convention, scoped to the turns that produced a deliverable, and paying a further model step whenever the judge says no; the durable facts that rule protects are required by the gate instead, deterministically and once per session.
- **Extending `verify_deliverable` with the supersede relation** (the benchmark's other candidate). It already reconciles the case main path against the delivered copy. It cannot be the gate's prerequisite, because it reads the rendered deliverable, which does not exist until the gated call runs, so it would stay voluntary — and this preset's own comment records what voluntary delivery tools get: of 13 sessions that rendered a deliverable, 2 had run `rule_check` before the first render and `law_verify` had never run at all.
- **A rule asset over the delivery tool's result text.** The result text is the tool's own output; the log is a file the model writes, so no rule over result text can see whether the round was archived.
- **Documenting the existing convention more strictly.** That is what the log had. The benchmark item exists because the convention had no execution point.

## Consequences

- The log has one writer with a fixed field set. The model can no longer hand-format an entry, and an entry the tool will not accept fails at the call rather than landing in a form no later reader can parse.
- The gate's ledger records successfully returned tool names per agent for the session, so one entry clears every later gated delivery in that session. The floor is "the session archived its case before shipping", not "every render carries its own entry"; per-round counting would need the ledger to be turn-scoped, which would tighten the `rule_check` / `law_verify` prerequisites as well.
- Logs written before this change stay readable. Entries the tool did not write are not parsed as structured entries, and the chain checks still see the paths their lines carry, so a case started earlier can supersede a legacy artifact — and cannot silently reuse one as a new round's output.
- Cost of the added tool: the `patent-oa-response` schema sidecar grew by 59 lines, and each of the two delivery tools gained one prerequisite name.

## Testing

- Unit (`packages/patent/patent-tools/tests/matter-log-append.spec.ts`, 19 cases): rendering round-trips through the parser with a `|` and a `、` inside the free text; each detector fires on its own fixture (missing artifact, in-place overwrite, unknown supersede, forked chain, reused path) and a delivery round may re-reference an earlier round's path; the append leaves the prior bytes as a prefix; a refused round writes nothing; a path inside the case directory is stored case-relative however it was given.
- Gate mechanism (`packages/patent/patent-rule/tests/delivery-gate.spec.ts`): with the preset's prerequisite list, a render is denied while `matter_log_append` is missing even after the other two gates passed, the denial names it, and the render is allowed once it has succeeded. The preset's own declaration is asserted in `packages/bundle/web-app/tests/patent-preset.spec.ts`, and the four new `scripts/verify-preset-tool-refs.spec.ts` cases cover the gate-name resolution (unmounted prerequisite, mounted pair, disabled row).
- Recorded session: `pnpm run test:snapshot:refresh` rewrote exactly one sidecar (`snapshots/session/patent-oa-response/tool-schemas.expected.json`, the new tool's schema), and `pnpm run test:snapshot -t "patent"` replays 11 scenarios green.
