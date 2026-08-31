# Agent Note: Patent preset group and plugin rows must not share an entry id

Status: implemented

English | [中文](2026-08-31-patent-preset-duplicate-group-id-loader-livelock.zh.md)

## Problem

The `patent` preset's self-evolve section gave the `cordis:group` row and its child plugin row the same id (`self-evolve-benchmark`). When the roster mounted the preset, `cordis-plugin-loader`'s `create()` resolved the child row against the by-id entry map, found the group's own entry, and adopted it: the new entry's parent chain pointed back at itself. The `_disabled()` parent-chain walk (`while (entry) { ... entry = entry.parent.ctx.fiber.entry }`) has no cycle guard, so boot spun forever at 100% CPU inside `cordis.init` with the HTTP server listening but unable to answer — the desktop app's backend wedged on every launch. Every other group in every shipped preset names its group after the section (`planning`, `patent`), so this row was the lone id collision.

The wedge surfaced only after the renderer-side `@deepseek-ai/dsh-api-remotes` client bundle stopped failing on a missing `zod` module-table row: a broken BFF had kept the desktop renderer from mounting presets at all, so the collision was latent until the client-modules externals drift was fixed.

## Decision

The group row is renamed to `self-evolve`; the child keeps `self-evolve-benchmark`, matching the mount id convention where group ids are section names and child ids are plugin mounts. The preset-level rule this failure encodes: a `cordis:group` row's id must differ from every entry id inside its own `config` subtree — a collision makes the loader adopt an ancestor and livelock instead of failing loud.

## Alternatives considered

**Guard the loader.** A cycle check in `_disabled()` (or rejecting a child whose id resolves to an existing ancestor entry in `create()`) would turn any future collision into a loud failure. Rejected for this change: the loader is vendored (`vendor/`), so the guard needs the sync procedure, logged local modifications, and its own tests. It remains the right follow-up.

**Scan preset files at authoring time.** A validation over composition text duplicates parsing the vendored loader already owns. Revisit together with the loader guard.

## Consequences

Mounting the `patent` preset composes the self-evolve section without the self-adoption cycle. The defect was invisible while the desktop renderer could not mount presets and deterministic once it could, so preset-composition bugs of this class present as a wedged backend, not a preset error; diagnosing it required pausing the live process through the SIGUSR1 inspector and walking the fiber chain over CDP.
