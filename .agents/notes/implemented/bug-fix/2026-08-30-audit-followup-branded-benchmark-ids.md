# Agent Note: Audit follow-up batch — branded benchmark ids and honest coverage exemptions

Status: implemented

English | [中文](2026-08-30-audit-followup-branded-benchmark-ids.zh.md)

## Problem

The 2026-08-30 full-scan report left four ranked findings unlanded after the first cleanup batch. `BenchmarkId` and `CaseId` in `dsh-self-evolve-benchmark` were documented as opaque identifiers but declared as bare `string` aliases, while the store, scoreboard, and engine functions accepted untyped strings for the same values. The vitest coverage exclusion for `packages/host/webserver/src/*` sat under the TODO(gui) browser-harness umbrella although webserver is host-side Node code with its own passing suite — the only rationale-inconsistent entry in the list. The `sandbox-windows-acl` runner spec's ambient-writable escape regression silently skipped itself when its `C:\Users\Public` probe directory could not be created, and the job covering it is advisory, so a changed CI runner image could retire a security regression test without a witness. The app-boot user-patches HMR test failed under full machine load with a bare assertion message that carried no evidence for the load hypothesis.

## Decision

- `BenchmarkId` and `CaseId` are now branded (`src/brand.ts`, following the `dsh-llm` brand module pattern), and the store, scoreboard, engine, and provider signatures carry them. The store mints `CaseId` where directory entries become ids. The ids key durable on-disk state and every seam request, so the brand moves with them from the first consumer rather than after one exists.
- The webserver exclusion keeps its place in the list but moves out of the TODO(gui) cluster with its own TODO(cov) reason. A per-package probe run of the coverage gate measured index.ts at 88%, injections.ts at 93%, and invariant.ts at 94% — no file qualifies for removal, so the entry now states what is actually uncovered (request-failure and WebSocket-upgrade error branches).
- The escape-regression skip now warns loudly: on CI it emits a `::warning::` line, which GitHub renders as a run annotation; locally it is a plain stderr warning. No workflow change is needed.
- The user-patches `eventually` helper reports waited milliseconds and the load average in its timeout error, so a load-starved runner is distinguishable from a regression in the failure itself. The flake stays unregistered as load-sensitive until the diagnostic produces evidence.

## Consequences

Passing a benchmark id where a case id is expected is now a compile error inside the package, and ids minted from directory names flow branded through scoreboard paths and seam requests; runtime behavior is unchanged (brands are erased casts). The coverage exclusion list no longer cites a GUI-harness rationale for host-side Node code, and the webserver entry documents its real gap. A silent security-test skip on a CI runner now surfaces as an annotation on the run. HMR timeout failures carry their own load evidence, ending the guesswork in the two observed flake reports.

## Alternatives considered

**Reword the JSDoc instead of branding.** Rejected: the JSDoc was the honest part — these ids cross the durable filesystem boundary and the execute/evaluate/propose/apply seam requests; the defect was the bare `string` declaration, not the opaque claim.

**Write the missing webserver branch tests now.** Deferred: it is a focused coverage PR of its own; until then the entry stays, but attributed to its actual gap instead of an umbrella that does not apply.

**Detect the skipped security test from the workflow by grepping logs.** Rejected: `::warning::` lines become run annotations without log parsing, and the signal lives next to the code that knows why the skip happened.
