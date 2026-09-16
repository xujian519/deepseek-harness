# Agent Note: Creating a workspace title derives it from the directory

Status: implemented

English | [中文](2026-09-16-workspace-create-derived-title.zh.md)

## Problem

`WorkspaceRegistry.create(path, title?)` took a display title and wrote it into the new record. Its last production caller disappeared when the gateway's create-by-name branch was deleted ([the one-route-to-add-a-workspace decision](../../archived/simplification/2026-07-31-one-route-to-add-a-workspace.md) removed that route), leaving the package's own tests as the only callers that passed one — and they passed titles to observe the idempotent-reuse rule, not because a title is part of creating a project from a directory.

The parameter was a second, write-once route into a field that `Workspace.setTitle` already owns, so what a project is called depended on which caller happened to create it. The bootstrap path that groups historical sessions never used it, deriving each record's title from the directory instead, and a code TODO proposed dropping it.

## Decision

`create(path)` takes the directory alone. `createCanonical` writes `defaultWorkspaceTitle(canonical)`: a new record's title is the path's final segment, or the root spelling when that segment is empty. `Workspace.setTitle` remains the only rename path.

Every consumer moved with the signature: the package's tests, its README pair, the `docs/subsystems/workspace` pair, and the Cordis catalog generated from the source.

## Alternatives considered

**Keep the parameter as a documented test hook.** Rejected: a parameter whose only callers are tests is surface area every consumer keeps paying for, and the tests that used it reach the same assertions by naming directories — idempotent reuse still returns the existing entity, and two paths whose final segments match still share a display title.

**Derive the title in the gateway, which supplies the path.** Rejected: the gateway has no title to derive from beyond the path, and derivation belongs where the record is written — the same place the bootstrap path already derives it.

**Make titles immutable and drop `Workspace.setTitle` as well.** Rejected: renaming is a shipped capability with its own persisted write and its own tests; only the create-time channel was redundant.

**Keep `title?` and let it win only when the path has no final segment.** Rejected: no caller wants that precedence, and keeping it leaves the ambiguity this change removes.

## Consequences

A project's title at creation has one source, the directory, so two callers creating the same directory can no longer disagree about its name.

A caller that does want to name a project writes twice: `create(path)` then `setTitle(name)`. That is the price of one title channel, and the second write was already needed to rename an existing project.

Lowercased and root spellings stay unvalidated at this seam: `defaultWorkspaceTitle` derives whatever the canonical path's final segment says, and callers that need a specific spelling must rename.

## Testing

`packages/workspace/workspace/tests/workspace.spec.ts` pins the derived title, the unchanged-title rule on idempotent reuse, two canonical paths sharing a display title, and concurrent same-path creates collapsing to one entity. `pnpm run verify-cordis-catalog` re-derives the generated signature block from the source, so the documented `create(path)` cannot drift from the shipped one.

## Related

- [one route to add a workspace](../../archived/simplification/2026-07-31-one-route-to-add-a-workspace.md) — the removal that left `title` without a production caller.
- [Workspace registration deletion](../feature/2026-07-27-workspace-registration-deletion.md) — the removal path that keeps owning the directory and its sessions.
