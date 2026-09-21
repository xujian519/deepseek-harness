# Agent Note: Make duplication detection see the clones it currently masks

Status: proposed

English | [中文](2026-09-21-duplication-detection-below-threshold.zh.md)

## Problem

`pnpm run duplication` reports zero clones across the whole repository, and that number is not a measurement of the repository. Two mechanisms in the current configuration make it false for any domain whose clones are small.

The first is the threshold. `.jscpd.json` sets `minTokens: 60` and `minLines: 6`. Running the shipped configuration over `packages/patent/patent-tools` alone reports `0 clones` for 54 files and 80521 tokens. Running the same tree with `--min-tokens 30 --min-lines 5` reports **113 clones and 866 duplicated lines (1.64%)** over 283 files, with the largest clone 55 tokens. Every clone below 60 tokens is invisible, and the largest one in the domain sits below that line.

The second is the ignore marker. `jscpd:ignore-start` / `jscpd:ignore-end` mask the region between them, and the repository uses these markers to log duplication it acknowledges but has not collapsed. When only one side of a cross-package pair carries the marker, masking that side removes the pair from the report entirely, so the marker changes from "logged exemption" to "silent suppression". `packages/patent/tool-literature/src/tool/paper-download.ts:106,123` and `packages/patent/patent-workflow/src/invariant.ts` carry markers whose counterparts (`packages/patent/patent-tools/src/tool/patent-pdf-download.ts`, `packages/patent/patent-teams/src/invariant.ts`) do not.

The consequence is not limited to the patent domain. A gate that reports zero cannot distinguish "no duplication" from "no duplication above the threshold", so it cannot fail on a new clone shorter than 60 tokens, and it cannot be used to argue that a domain is clean.

## Proposal

Adopt one of two policies, and make the choice explicit in `.jscpd.json` rather than leaving it to the configuration default.

**Lower the threshold with a recorded baseline.** Set `minTokens` to 30 and `minLines` to 5, record the resulting count as the baseline, and require the baseline not to grow. This makes every clone of the size the patent domain actually produces visible and reviewable.

**Or require symmetric markers.** Keep the current threshold, and require that a `jscpd:ignore` region added to one side of a cross-package pair be added to the other side in the same change, with the marker text naming the counterpart it is paired with. This removes the silent-suppression failure mode while leaving the threshold alone.

Either policy is paired with a negative test: a probe that plants a known duplication at the chosen threshold's floor must make the gate fail. Without it the threshold can be raised again by an unrelated edit and the gate returns to reporting zero.

The immediate prerequisite is collapsing the duplication the lowered threshold exposes, so the baseline starts from a reviewed number rather than from 113 unreviewed clones. The candidates are enumerated in `.agents/audits/2026-09-21-patent-domain-review.md`.

## Alternatives considered

**Leave the configuration and rely on reviewers spotting duplication.** Rejected: the gate exists precisely because review does not scale to cross-package duplication, and the measured count (113 clones at a 30-token floor, largest 55 tokens) shows the gate is not currently covering the size range where this repository's duplication actually lives.

**Lower the threshold without a baseline.** Rejected: the gate would fail on the existing 113 clones, so the change would either be reverted or would require collapsing everything at once — including clones whose lifetimes are unrelated to each other.

**Ban the `jscpd:ignore` marker.** Rejected: collapsing every acknowledged clone at once is not achievable, and the marker is the repository's only mechanism for recording a deliberate, reasoned exemption. The failure is the asymmetric application, not the marker.

## Acceptance criteria

- `.jscpd.json` states the chosen policy: a lowered threshold with a recorded baseline, or a symmetric-marker requirement.
- A negative test plants a duplication at the chosen floor and proves the gate fails on it.
- Whichever policy is chosen, `pnpm run duplication` still passes on the tree that lands it.
- A cross-package pair carrying a marker on one side only is either collapsed or marked on both sides.

## Risks

Lowering the threshold makes the repository's duplication visible for the first time, which means the first run after the change reports a number that has to be triaged rather than a clean result; the triage is the work, and the baseline is the record of it. Symmetric markers instead leave the threshold where it is, which keeps short-clone duplication invisible but removes the suppression failure mode. Both policies change a repository-wide gate, so both should land in their own change with the baseline recorded in `docs/TECH_DEBT.md`.
