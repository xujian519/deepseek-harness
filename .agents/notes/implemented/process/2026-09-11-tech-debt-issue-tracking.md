# Agent Note: tech-debt tracking in same-repository Issues

Status: implemented

English | [中文](2026-09-11-tech-debt-issue-tracking.zh.md)

## Problem

`docs/TECH_DEBT.md` was the only home for known debt, and nothing tied a ledger entry to work a pull request could close. The ledger also drifted silently: its 2026-08-17 line counts, its "0 remaining" helper-convergence claims, and its hygiene-gate status no longer matched the tree, so later work proceeded from false premises. A debt item with no tracker identity is invisible to the per-pull-request rule that every non-mechanical change references a same-repository Issue.

## Decision

- **The ledger carries one tracking column, and Issues carry the work.** `docs/TECH_DEBT.md` keeps severity, evidence, and rationale; a same-repository Issue owns scope, priority, and closure. Each ledger entry that is still open names its Issue, and each converged entry is marked converged in place rather than left looking open.
- **A full-repository scan is the refresh mechanism, and its manifest is the evidence home.** The 2026-09-11 scan wrote `.agents/audits/2026-09-11-tech-debt-issue-manifest.md`, which holds the scan method, the gate baseline, one row per proposed Issue with its `file:line` evidence, the full Issue bodies, and a "not filed" list. The manifest stays in the repository as the historical record; the ledger stays the current-state authority.
- **Issues are topic-aggregated, not per-TODO.** One Issue covers one independently reviewable fix, so a single pull request can close it. Findings that share a root cause but span many call sites become one Issue with a call-site inventory, not many Issues with one line each.
- **Findings are filed only after the scanning agent's claims are re-read at the source.** Every candidate was verified against `file:line` by the session that filed it, and refuted candidates were recorded in the manifest's "not filed" section with the reason, so the same false positive is not re-proposed next scan.
- **The ledger records the tracker's own limits.** The fork cannot write Project Status or Priority (no `read:project` scope; the Project belongs to the upstream organization) and cannot assign a native Issue Type through the available API, so priority lives on the first line of each Issue body and classification lives in `area/*` labels. The manifest states both limits with the evidence.
- **Scan-only findings that no single pull request can close stay ledger-only.** The low-severity remainder carried in the ledger's L5 section keeps ledger registration without an Issue, because a roll-up Issue spanning unrelated fixes can never be closed by one pull request; the ledger says so explicitly instead of leaving the omission implicit.

## Alternatives considered

- **File one Issue per TODO or per lint suppression.** Rejected: the repository has 26 closed-union switches missing `assertNever` and 63 silent `.catch(() => {})` sites, and per-line Issues produce a tracker nobody can triage while obscuring the shared root cause.
- **Treat the ledger alone as the tracker.** Rejected: the ledger is not queryable, has no open/closed lifecycle, and cannot be closed by a pull request, so debt items silently outlive the work that resolves them.
- **File every candidate the scanning agents reported without re-reading the source.** Rejected: the scanning pass produced at least four false-positive classes, including never-produced union members that the code documents as deliberate and a "duplicate package" pair that is a documented duplicate-install-safe split.
- **Open the Project on the fork and mirror Status there, rather than recording the limit.** Rejected: it would create a second status authority that disagrees with the upstream Project, and the mirror cannot be kept current without the same scope the fork lacks.
- **Delete the ledger and let Issues carry all history.** Rejected: the ledger holds convergence records, deliberate trade-offs, and severity rationale that belong with the code's history rather than in a tracker that closes.

## Consequences

Debt is now queryable and closable per pull request, and the ledger can no longer claim convergence it does not have: the scan corrected the M1 convergence claim, the M6 line counts, and the M8 `settingsNamespace` description in place. The cost is a second artifact to keep current — the manifest is a dated snapshot that must not be edited to track progress, and the ledger line must move whenever an Issue opens or closes. Two governance fields stay unwritable on this fork, so priority and type are duplicated between the Issue body and labels until the Project becomes writable; a reader must not treat the missing Project status as "unprioritized".

## Testing

The scan's gate baseline was measured locally: typecheck, lint, duplication, and `test:docs` pass, `hygiene` fails only on `verify-package-dependencies`, and the unit suite reports 3 failures of which two are load-sensitive and one is a local DNS artifact. The documentation gates were re-run after the ledger and manifest edits with `pnpm run test:docs`.
