# Agent Note: Listing the boundary tests in the host face

Status: implemented

English | [中文](2026-09-15-host-face-boundary-tests.zh.md)

## Problem

`tsconfig.host.json` is the host aggregate: it names every standalone TypeScript file the package and app tsconfigs do not own — `apps/web/tests/*` one entry at a time, plus globs for `apps/cli/tests`, `apps/desktop/tests`, `benchmarks`, `packages/*/*/tests`, `scripts`, and `website`. Two directories with test files were missing from that list, `apps/desktop-host/tests/**` and `examples/*/tests/**`, so five files belonged to no TypeScript program: the type-aware Oxlint pass read their imports as `error`-typed values and reported 62 `no-unsafe-*` findings in them, and `tsc -b tsconfig.host.json` never read them at all.

The findings appeared in the run that first listed a new `apps/web/tests` e2e file, and every one of them names a file from those two directories; dropping that single entry silences them again while the five files stay outside every program. Which way the pass treats a file no project owns is not the point: no compiler face had ever read those five, so a type error in any of them was unreportable.

## Decision

`tsconfig.host.json` lists `apps/desktop-host/tests/**/*.ts` beside `apps/desktop/tests/**/*.ts`, and `examples/*/tests/**/*.ts` beside `benchmarks/**/*.ts`; the example glob is the one the e2e lane already uses for the same directory.

The aggregate is where such a file has to go: `apps/desktop-host/tsconfig.json` includes `src` only, `examples/` has no tsconfig at all, and a test that imports the host face's own modules cannot be claimed by the client aggregate.

Bringing the five files in surfaced two type errors that no gate had read, both in `apps/desktop-host/tests/portless-webserver.spec.ts`: a route handler whose `req` parameter is unused, and a host header recorded into an `Array<string | undefined>` although the request header map types one as `string | string[] | undefined`. Both are fixed in the same change, and every assertion still compares the same values.

## Verification

| Check | Result |
| --- | --- |
| `pnpm exec tsx scripts/run-oxlint.ts .` | 0 warnings, 0 errors over 4542 files; 62 `no-unsafe-*` errors before |
| `pnpm exec tsc -b tsconfig.host.json` | exit 0; 2 errors in `portless-webserver.spec.ts` before their fix |
| `pnpm exec tsc -b tsconfig.client.json` | exit 0 |
| `pnpm exec vitest run apps/desktop-host/tests` | 3 files / 14 passed |
| `pnpm exec vitest run --config vitest.e2e.config.ts examples/opendesign` | 1 file / 2 passed |

## Alternatives considered

- **Remove the newly listed e2e entry from the host face.** Measured to clear the same 62 findings, and rejected: that file is listed because it imports `scaffold.ts` and `support.ts`, which the host face owns, and removing it leaves the other five files exactly as unchecked as they were.
- **Add the two directories to the Oxlint ignore list.** Rejected: that list holds files deliberately outside a program, such as build configs. These are tests, and the 62 findings were the only signal that a directory full of them was unchecked.
- **Give `apps/desktop-host` an aggregate over both `src` and `tests`.** Rejected: every app contributes its tests to the host aggregate today, `apps/cli` and `apps/desktop` included; a second arrangement for one app would make "which program owns this test" depend on the app.

## Consequences

Five files are type-checked for the first time, which is what surfaced the two errors. The next type error in a desktop-host or example test fails the host typecheck and the lint pass instead of staying invisible, and a further directory under `apps/*/tests` or `examples/*/tests` joins the program without another tsconfig edit.

## Related

- [Activating conversation views by aligning slot ids with targets](../architecture/2026-09-15-conversation-view-slot-id-is-target.md) (the change whose new e2e entry surfaced the findings)
- `vitest.e2e.config.ts` (the lane that already globs `examples/*/tests`)
- `tsconfig.host.json`, `.oxlintrc.json`
