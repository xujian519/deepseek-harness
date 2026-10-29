# Agent Note: fork brand assets

Status: implemented

English | [中文](2026-10-29-fork-brand-assets.zh.md)

## Problem

This fork presents itself as `DSH Patent`. `BRAND_GUIDELINES.md` permits the `DSH` abbreviation in a project name but asks projects not to use official artwork in a way that reads as DeepSeek endorsement. Until this change the fork did both at once: it named itself `DSH Patent` while shipping the official whale as its favicon, its desktop icon, and its sidebar mark.

No upstream component was ever going to supply a fork mark. `ui-brand-official` registers the official marks only when `process.env.DSH_CLIENT_BUILD_PROFILE === 'official'`, which a `local` build never is. The whale a user sees in a fork build is the fallback in `ui-sidebar`, not a registered brand. Replacing it therefore fills slots that already exist for third-party products, and needs no change to `ui-sidebar` itself.

## Decision

The fork owns a mark and the asset sources that produce every branded icon.

`brand/assets/` holds the recorded SVG sources; `scripts/generate-brand-icons.ts` derives every binary from them. `scripts/verify-brand-assets.ts` runs as the `brand-assets` gate and enforces two things: no product-identity asset may carry the official whale, and each recorded mark source must keep its own variant's geometry.

The mark is a pair of interlocking hooks — `harness` in its literal sense, a coupling — whose left half reads as handing work in and whose right half reads as acceptance coming back. The 4-unit gap where the hooks meet says the halves are engaged but separable, which is the product rule that an agent cannot close a task; only the user's acceptance does.

Three variants exist because one geometry does not survive the whole size range. The standard 6-unit stroke serves 32 px and above. A redrawn 8-unit variant serves 16–31 px, where the standard stroke thins until the hook tips vanish. The 22 px tray template drops the tips entirely, because a monochrome tip at that size collapses into the stroke and reads as a smudge.

Colour extends the existing brand gradient rather than inventing a palette. `--dsp-*` tokens carry the fork's own semantics; upstream `--dsw-*` aliases are untouched, so a rebase cannot collide with them.

## Alternatives considered

**Keep the official whale and accept the ambiguity.** Cheapest, and it matches what a fork looks like before anyone thinks about identity. Rejected: it is the specific arrangement `BRAND_GUIDELINES.md` asks projects to avoid, and a third-party product wearing the official mark claims an endorsement it does not have.

**Recolour the whale instead of drawing a mark.** Would keep some visual lineage at near-zero design cost. Rejected: recoloured official artwork is still official artwork, so it resolves nothing the guideline objects to.

**Ship one mark and scale it everywhere.** Simplest generator, one source of truth. Rejected by inspection: scaling the 6-unit source to 16 px leaves the hook tips below a readable stroke, and the mark degenerates into a generic `<>` that programmers read as a closing tag.

**Use the shared-spine variant that stays legible small.** It tested better at small sizes than several alternatives. Rejected on semantics: at 16 px it resolves to `</>`, so the mark reads as markup punctuation rather than as a coupling, which is the one reading the mark exists to avoid.

**Gate the official whale by pinning `ui-primitives/FishLogo.tsx`.** Would catch a rebase that reinstates the whale inside the shared library. Rejected: that file is upstream source which a sync must remain free to change, so pinning it converts every upstream sync into a conflict. The gate protects the fork's outward identity — the icons a user installs — not upstream internals.

## Consequences

A fork build now shows its own mark in the sidebar, the favicon, the installed application icon, and the tray, and the `brand-assets` gate fails a rebase that reinstates the official whale or drifts the recorded geometry.

The cost is a mark the fork must now maintain. Every future size need is another variant, because the geometry does not scale — the small and tray variants already exist only to keep two diameters readable. The generator also makes `rsvg-convert`, `magick`, and `iconutil` build-time requirements for regenerating icons; it fails loudly when one is missing rather than emitting a partial set.

Upstream's own brand packages continue to gate on `DSH_CLIENT_BUILD_PROFILE === 'official'` and are untouched, so an official build keeps its own marks and a fork build keeps these.

## Testing

`scripts/verify-brand-assets.spec.ts` covers the detection logic: whale signatures match artwork a rebase would reintroduce, including a recoloured copy; path-spacing differences do not read as geometry drift; a lost hook tip and a lost interlock are both rejected with the role named; and each pinned variant is judged against its own geometry, so the small and tray variants are not failed for differing from the standard mark. An unpinned source passes untouched, leaving room to develop a new variant before pinning it.
