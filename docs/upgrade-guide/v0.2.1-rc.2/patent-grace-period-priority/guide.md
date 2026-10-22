---
kind: upgrade-guide
description: "prior-art-filter measures the A24 grace period from the earliest priority date, requires a matching disclosure source, and reports unverifiable claims instead of falling back to the filing date."
---

# A24 grace period uses the priority date and disclosure source

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-patent-core`'s `prior-art-filter` now determines the A24 grace period from `state.priority_date` when a priority is claimed:

- The baseline is the earliest valid priority date, supplied as one date string or an array of date strings; the filing date is the baseline only when no priority is claimed.
- A priority date that is month-only or unparseable makes the baseline unverifiable. The stage no longer falls back to the filing date, which could otherwise widen or shift the grace period.
- Each A24-annotated entry must carry `a24DisclosureSource`: `applicant` or `derived-from-applicant` for A24.1–A24.3, and `unauthorized-disclosure` for A24.4. A missing, `unknown`, or mismatched source leaves the claim unverified; an unrecognized value degrades the stage.
- Unverifiable claims keep the entry in `prior_art` and are listed in the report, instead of excluding it as a grace-period disclosure.
- `a24_grace` reports the resolved baseline or why it is unverifiable, and `prior_art_grace` reports one assessment per A24-annotated entry. A24 exclusions also carry `disclosureSource`.
- Stage params `priority_date_key` and `a24_disclosure_source_key` select alternative state and entry field names.

## Migration

1. Supply `priority_date` as a full date (`yyyy-MM-dd` or another parseable form), or an array of full dates for multiple priorities. Remove month-only priority dates.
2. Add `a24DisclosureSource` to every prior-art entry that carries `a24Exception`; omit `a24Exception` when the disclosure source is unknown and the claim should not be evaluated.
3. Read `a24_grace` and `prior_art_grace` when downstream logic needs the baseline or per-entry status; the report text is no longer the only carrier of that information.
4. Confirm: `pnpm exec vitest run packages/patent/patent-core` passes, and a workflow run with priority-dated A24 entries either excludes the disclosure or reports it as unverifiable, never silently as prior art or prior-art-exempt.
