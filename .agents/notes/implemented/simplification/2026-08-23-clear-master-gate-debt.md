# Agent Note: Clear the five pre-existing master gate debts

Status: implemented

English | [中文](2026-08-23-clear-master-gate-debt.zh.md)

## Problem

Master carried five failing repository gates left by the #23 (synapse), #24
(ui-document-studio), and #26 (self-evolve-eval) merges:

- `constraints`: `packages/self-evolve/evaluation/` was a nested non-package
  directory holding an unreferenced draft launch checklist.
- `verify-cordis-config`: the web-app bundle mounts `dsh-host-synapse` and
  `dsh-client-synapse`, but neither name resolves through `tsconfig.base.json`
  paths, so a source launch falls back to built `lib/`.
- `verify-export-jsdoc`: `createFixtureApi` in the connection fixture had no
  JSDoc (its block had drifted above `fixtureFiles`).
- `knip`: `campaign.e2e.ts` (a keyed e2e test) was not declared as a test
  entry, and `dsh-client-test-runtime` was an unused devDependency of
  `dsh-client-synapse`.
- `duplication`: five jscpd clones — the turn-node skeleton shared by
  `ui-deliverables`/`ui-document-studio`, the legacy thread projection in
  `migration.ts`, and the tool-process fold in `projection.ts`/`store.ts`.

## Decision

- Moved the launch checklist to `packages/self-evolve/` next to `spec.md` (its
  links now point at `spec.md` and `test-support/self-evolve-eval`), so the
  `packages/<group>/<pkg>` hierarchy holds.
- Added the four `tsconfig.base.json` exact-path entries for the synapse
  packages (their names carry the host/client prefix, so the group wildcard
  cannot map them).
- Restored the `createFixtureApi` JSDoc block to its function.
- Declared `tests/**/*.e2e.ts` in the `self-evolve-eval` knip workspace entry
  (same shape as the `api/remotes` precedent) and dropped the unused synapse
  devDependency.
- Extracted the duplicated code where the packages may share a module:
  `projectThreadBase` in `migration.ts` and `foldToolProcessInto` in
  `projection.ts` (reused by `store.ts`). The `ui-deliverables` /
  `ui-document-studio` skeleton is intentionally duplicated — the studio owns
  its turn key to compose without `ui-deliverables`, and cross-package value
  imports are forbidden for client packages — so it is wrapped in the
  config-sanctioned `jscpd:ignore` markers with a comment.

## Alternatives considered

- **Rename the synapse packages** so the group wildcard maps them. Rejected:
  a package rename is a wide blast radius for a paths-table debt.
- **Delete the launch checklist.** Rejected: it records the P1.10 evidence
  path and stays a future execution guide; moving it next to `spec.md`
  preserves it.
- **Extract the ui turn-node skeleton into a shared factory.** Rejected:
  client packages forbid cross-package value imports, and the studio owns its
  turn key to compose without `ui-deliverables`; the config-sanctioned
  `jscpd:ignore` markers keep the intentional duplication explicit.
- **Delete `campaign.e2e.ts`.** Rejected: it is a real keyed e2e test; the
  knip workspace entry declares it instead.

## Consequences

All thirteen `hygiene` gates pass on master (previously seven), with the full
typecheck, CI oxlint, focused package suites, and the coverage gate green.
The `self-evolve-eval` e2e entry realizes the deferred "e2e entry folding"
item of the [knip-config-cleanup note](2026-08-19-knip-config-cleanup.md).
