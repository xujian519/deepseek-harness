# Agent Note: Restore the fork presets' persona row to the current field names

Status: implemented

English | [中文](2026-09-10-persona-config-field-in-fork-presets.zh.md)

## Problem

`dsh-persona` takes `prefix` (required) and `suffix` (optional) since the 2026-09-06 system-prompt change that split its single `text` field. Every shipped preset moved with that change except two: `patent`, this tree's own preset, and `document`.

Their persona rows still set `text`. The runtime schema ignores the unknown key, `prefix` stays missing, and the loader rejects the entry, so `dsh-agent-presets` cannot mount the preset: `agent-presets: preset "patent" failed to mount: failed to apply loader entry persona (@deepseek-ai/dsh-persona): invalid config: $.prefix missing required value`. With `agent-presets.default: patent`, that failure blocks every resume and every new session, and the desktop application surfaces it as a file-panel read failure rather than as a preset problem.

## Decision

Both persona rows set `prefix:`, with their prose unchanged. Neither sets `suffix:`. The configurations these presets layer over leave `personaPrefix` and `personaSuffix` empty, so the empty suffix template shadows nothing.

## Alternatives considered

**Accept `text` as a deprecated alias in `dsh-persona`.** Rejected: it restores the field the upstream change deleted and keeps two spellings of one setting alive indefinitely.

**Set `complete: true` on the two rows.** Rejected: `prefix` stays required, so the entry still fails to load, and `complete` additionally drops every other prompt section and the runtime-context snapshots.

## Consequences

Both presets mount again, and their agents render the same persona prose as before the rename.

Coverage gap: `mount.spec.ts` boots fixture presets only (`includeShippedRoot: false`), and `shipped-root.spec.ts` reads the shipped root's structure without validating an entry's config against the named plugin's schema. A shipped preset that carries a renamed or removed config field therefore fails in a running deployment instead of in CI.
