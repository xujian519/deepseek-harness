# Agent Note: coverage exemptions name the file's own reason

Status: implemented

English | [中文](2026-09-13-coverage-exemption-reasons.zh.md)

## Problem

`vitest.config.ts` excludes ~98 source globs from the per-file 100% gate, each introduced with a comment naming why the file is outside it. Issue #91 recorded seven entries whose comment did not describe them. `client/modules/src/client/system.ts` and `client/hmr/src/client/index.ts` sat between the Inspector list and the "Web config-tree boot round" comment, so neither was attributed to a reason. `ui-input-trigger/src/core/menu.ts`, `ui-input-trigger/src/core/detect.ts`, and `test-support/client-runtime/src/translate.ts` were parked under a client-lane TODO that claims a browser-grade harness. `packages/extensions/*/src/**/*.ts` and `*.tsx` carried no reason at all.

Measuring the seven files with v8 per-file coverage showed that the reasons mattered: `client/hmr/src/client/index.ts` is at 35.18% statements and 11.76% branches and needs the harness the comment named, while the others were ordinary unit-test gaps — `system.ts` 98.34% lines / 91.66% branches, `menu.ts` 98.83% statements, `detect.ts` 96.77% branches, `translate.ts` 80% lines. A reader trusting the comment would look for a browser lane instead of the missing cases.

## Decision

- **Four exemptions are deleted; the files now sit under the per-file gate at 100%.**
  - `client/modules/src/client/system.ts`: five cases in `tests/loader.client.spec.ts` cover the rev-less bundle URL, a declared dynamic request the graph does not carry, a registered factory with no graph row, `invalidate` on the bootstrap id, and `invalidate` on an id outside the graph. Two constructs left with them. The constructor's duplicate-`id` check is deleted: `parseBootManifest` already rejects a repeat with the same diagnostic (`manifest.ts:239`), the class is constructed only through `createClientModuleSystem`, which parses first, and the spec case that appeared to cover it was exercising the parser — it moved into the boot-manifest describe under a name that says so. `BootManifest.modules` now documents the uniqueness the parser guarantees.
  - `client/ui-input-trigger/src/core/detect.ts`: `boundaryOk` took a `char: TriggerChar` argument whose only caller passes `'/'` — the backward scan skips every other character, and `@` resolves through the shared file-reference grammar. The parameter and its never-taken `char === '/'` branch are gone.
  - `client/ui-input-trigger/src/core/menu.ts`: the `next === undefined` guard is a `noUncheckedIndexedAccess` backstop that the preceding `pos.length > 0` makes unreachable; it keeps a `/* v8 ignore next -- … */` reason rather than a file exemption.
  - `test-support/client-runtime/src/translate.ts`: two cases in `tests/helpers.client.spec.tsx` cover dictionary order, the key fallback, and `{name}` interpolation with an unknown placeholder.
- **`client/hmr/src/client/index.ts` keeps an exemption with its own reason**: its browser half drives the system SSE channel and the Loader's entry swap, which the jsdom lane cannot open.
- **The extensions wildcard collapses to one entry**, `packages/extensions/*/src/**/*.{ts,tsx}` (the two prior globs selected the same 42 files), with a reason naming what is actually true: the tree has never been under the per-file gate, `tool-cordis`'s own src is reached by the real-composition round (`apps/web/tests/cordis-tool-round.e2e.ts`) and the recorded sessions rather than by its unit suite, and the two generated API catalogs belong to `verify-cordis-api` / `verify-cordis-inspect-catalog`.
- **No gate enforces "every exemption carries a reason".** The failure mode here is attribution — a reason that belongs to a neighbouring group — which a presence check cannot see, and the category entries (`packages/*/*/src/types.ts`, `bin.ts`, `worker.ts`) legitimately carry a reason-less glob.

## Alternatives considered

- **Narrow the extensions wildcard to its uncovered files.** Rejected: the tree measures 53% statements overall, `tool-cordis/src` is at 0% under its own suite, and the uncovered set is most of the 42 files — a concrete list would restate the wildcard with more maintenance surface.
- **Cover `client/hmr/src/client/index.ts` and delete its exemption too.** Rejected: 35.18% statements and 11.76% branches; the file needs a live `EventSource`, a Loader entry tree, and a rebuild frame, which is the browser lane the client packages are waiting on, not a unit case.
- **Add a check that each entry has a preceding comment.** Rejected for the reason above: the entries that motivated Issue #91 all had a preceding comment, so the check would pass on exactly the roster that drifted.
- **Leave `system.ts` exempt and record its nine uncovered sites as debt.** Rejected: they are five unit cases over the client module table's own error paths, and the constructor's duplicate check turned out to be a second validator for an invariant the manifest parser owns.

## Consequences

Four files that could regress silently are now gated, and two redundant constructs are gone. Deleting an exemption moves its cost: a new branch in those files now needs a test rather than a comment. The remaining exemptions keep whatever reason they had, and the other ~90 entries were not re-audited entry by entry — a stale reason elsewhere would still read as current, which the tech-debt ledger records.

## Testing

The four files measure 100% statements/branches/functions/lines under `v8` with their exemption removed (`npx vitest run … --coverage --coverage.include=<file>`), and `npx vitest run` over the affected suites passes: 29 files, 556 tests, 1 expected fail. `pnpm run typecheck`, `pnpm run lint`, and `pnpm run verify-module-graph` pass; the extensions glob change is byte-equivalent to the two globs it replaced (`node:fs` `globSync` over both selections, 42 files each).

## Related

- [Tech-debt tracking in same-repository Issues](../process/2026-09-11-tech-debt-issue-tracking.md) — the scan that produced this finding, which Issue #91 records.
- [The `src/types.ts` runtime-companion boundary](../architecture/2026-09-13-types-ts-runtime-companion-boundary.md) — the same change's other half, which fixes the claim the `types.ts` exemption rested on.
