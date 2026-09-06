# Agent Note: Session migration drops ignorable unknown events

Status: implemented

English | [中文](2026-09-06-session-migration-drops-ignorable-unknown-events.zh.md)

## Problem

A released v0 Session written by a repository-external plugin carries informational events the first-party inventory never declares. The real user session `session-1c2e1634-...` stops at seq 217 with `checkpoint/snapshot`, produced by `dsh-checkpoint-rewind@0.4.0` and carrying the envelope marker `ignorable: true`. The alpha historical-event policy refuses every unknown historical type across the v0->v1 edge, ignorable or not ([alpha refusal](2026-08-31-alpha-historical-unknown-event-refusal.md)); the desktop app reports 「历史加载失败」 and the stored history record cannot be opened at all.

The equal-version reader already re-opens such an event when its envelope carries the marker. The gap is only the format edge that the persistence seam must cross to reach the current v2 generation.

## Decision

The migration chain now drops explicitly ignorable unknown events as it steps `v0 -> v1 -> v2`, with the refusal narrowed to unknown required events.

- **v0->v1 preserves them.** This edge is an identity promotion: it keeps each original `seq`, so discarding here would break the dense-sequence invariant and force a renumbering the identity contract does not own. Validation now admits an unknown type whose envelope marks `ignorable: true` through both source-coordinate and per-event payload checks; a non-ignorable unknown still refuses across this edge.
- **v1->v2 discards them.** v2 is pure first-party, and this edge already renumbers `seq` through its `oldToNew` remap. A pre-pass that drops `ignorable: true` unknown events leaves the existing remap machinery to close the gaps. A non-ignorable unknown is still refused by `assertReleasedV1Artifact` before any remapping.
- **The source generation never changes.** The v0 file, bytes, inode, and its suffixless path stay authoritative and unmodified; the drop happens only on migrated successors, so the exact retained v0 generation is untouched.
- **Refusal is narrowed, not lifted.** An unknown required event (absent marker, or `ignorable` not exactly `true`) still fails loudly across every edge, preserving the alpha safety rule for data that might carry opaque numeric references.

This supersedes the historical-migration portion of [Alpha Session migration refuses every unknown historical event](2026-08-31-alpha-historical-unknown-event-refusal.md). Equal-version append and reload keep following [Retain ignorable session events for external plugins](2026-08-30-retain-ignorable-external-session-events.md) unchanged.

## Consequences

Sessions written by external informational plugins (e.g. `dsh-checkpoint-rewind`) can now be migrated and opened, so stored history no longer fails to load. Only events whose producer explicitly marked the envelope ignorable are dropped; an external plugin that emits a required persistent event still fails migration loudly, which is the intended boundary.

The migration assigns the marker the meaning the equal-version reader already gives it — "safe to omit" — at the format edges too. The exact retained source generation is preserved byte-for-byte, so nothing durable is lost from disk; the informational event is lost from the *migrated successor* only.

## Alternatives considered

- **Copy unknown ignorable events through to v2 verbatim** — loses nothing visible, but cannot prove opaque numeric or lifecycle facts remain valid after the structural v1->v2 remap; this was the alpha refusal's own argument and remains the cost.
- **Keep strict refusal (the alpha status quo)** — leaves real external-plugin sessions unopenable; the reported bug is exactly this outcome.
- **Drop them at v0->v1 instead** — the identity edge preserves original `seq`, so discarding would violate the dense-seq invariant and require introducing renumbering logic that the edge does not own.
- **Ask mounted plugins dynamically whether an unknown event is safe** — makes migration availability depend on one deployment composition and fails before an absent producer can mount.
