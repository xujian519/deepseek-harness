# Agent Note: Fork CI runs the hygiene and coverage aggregates

Status: implemented

English | [中文](2026-09-19-fork-ci-hygiene-and-coverage-gates.zh.md)

## Problem

The fork's `.github/workflows/ci-fork.yml` ran lint, typecheck, duplication, the unit suites, the documentation checks, and the keyless Python suite. Two repository gates had no CI signal there.

The first is the coverage gate. `check:ci:coverage` measures every file under `packages/*/*/src` against a per-file 100% threshold and had run only by hand, so the fork's coverage state was defended nowhere between manual runs.

The second is the `hygiene` aggregate. `pnpm run hygiene` is the local developer aggregate: it is the only aggregate that carries the whole constraints / publint / node-next-types / built-package-invariants set without a build of its own, and no workflow invoked it. Upstream runs those same leaves inside build-owning aggregates (`check-all`, `ci-artifacts`, `ci-consumers`), where each declares `build` as a need. A manifest `files` field that drifts from the constraints table therefore reached `master` unobserved: `apps/desktop-host/package.json` listed `config/desktop.cordis.patch.yml` — the overlay its built `lib/index.js` resolves beside itself at runtime — while `appPackageFiles` in `scripts/check-workspace-constraints.ts` still declared only `lib/index.js`.

## Decision

`ci-fork.yml` gains `node-hygiene` and `node-coverage`, and the constraints declaration gains the missing entry.

### `node-hygiene` owns its build

The job installs, runs `pnpm run build`, then `pnpm run hygiene`, bounded at 45 minutes and triggered on every push to `master` and every pull request. `pnpm run build` already builds the native system addon (`scripts/build.ts`), so the job needs no second build step.

The build is not optional. The hygiene aggregate's publint, built-package-invariants, and node-next-types gates read emitted `lib/` artifacts; on an unbuilt tree they inspect an empty publication view and pass without checking anything. This job owning its own build is also what keeps the unit lane's precondition intact: the lib-consuming suites (`webworker-packer` image-loadable, client `ui-trajectory` client-bundle) self-skip on an unbuilt checkout, so building inside `node-checks` would start them under a different precondition than the one they were written for.

### `node-coverage` is PR-only and build-free

The job installs, prepares bubblewrap, then runs `pnpm run check:ci:coverage` under `DSH_COVERAGE_PARTITIONS=4`, `DSH_COVERAGE_MAX_WORKERS=4`, `DSH_COVERAGE_TEST_TIMEOUT_MS=90000`, and `DSH_GATE_FAIL_FAST=1`, bounded at 180 minutes and restricted to `pull_request`. The worker budget splits into three instrumented workers and one exempt-heavy worker, which matches the fork's 4-core runner. The per-test budget is the one the unit lane grants for the same reason. No build step: workspace imports resolve to `src` through the tsconfig paths map, and the aggregate builds the native system addon it needs before the instrumented run.

The `PRIMARY_NODE_VERSION` pin matters here beyond consistency. Under Node 22 the gate is red before it measures anything: the `ModuleLoaderV2` branch in `packages/boot/app-boot/src/profile-resolution/resolver.ts` does not execute before the v2 module-job API arrives in Node 24.12 ([vendor sync notes](../../../../vendor/README.md)), so those lines stay uncovered.

### The constraints declaration

`appPackageFiles['@deepseek-ai/dsh-desktop-host']` now lists `config/desktop.cordis.patch.yml` beside `lib/index.js`. The manifest was right and the declaration was stale; the desktop host resolves that overlay from its own directory at runtime, so the file belongs to the package's publication payload.

## Alternatives considered

**Run both aggregates inside `node-checks`.** Rejected: the coverage aggregate takes far longer than the rest of that lane and would put the fast signal behind it, and adding a build there changes what the unit suites run against.

**Run the hygiene aggregate without a build.** Rejected: three of its gates would then inspect an empty publication view, which is a green that checks nothing.

**Give the coverage job a build.** Rejected: nothing in the aggregate reads `lib/`, the anchor suites self-skip on an unbuilt checkout, and upstream's coverage lanes are build-free for the same reason.

**Keep the coverage gate out of CI.** Rejected: the fork's coverage state then rests on whoever remembers to run it, which is how the packages registered by the [post-sync debt sweep](../bug-fix/2026-08-28-post-sync-debt-sweep.md) sat outside the measurement until that sweep.

**Run coverage on `master` pushes too.** Rejected: a pull request already gates its own merge, and upstream restricts its coverage job to `pull_request` for the same reason.

## Consequences

- A constraints drift of the `apps/desktop-host` kind fails `node-hygiene` on the pull request that introduces it.
- Coverage regressions in the measured `packages/*/*/src` set fail `node-coverage`. The fork-local families registered in `vitest.config.ts` (`packages/patent/*`, `packages/web/synapse`, `packages/self-evolve/*`, `packages/client/ui-agent-preset`, and the document studio) stay outside the measurement.
- The gate's first run found the fork's only below-threshold file, `packages/client/better-sidebar/src/pty-manager.ts`, a gap no upstream lane can see because the package is fork-local.
- The fork's CI wall-clock grows by the coverage aggregate, which is the longest job in the workflow: its first run measured 20 minutes on the 4-core runner, and it runs only on pull requests.
- Both new jobs duplicate the install step that `node-checks` already pays for. GitHub Actions jobs do not share a workspace, so this is the cost of keeping the unit lane's precondition untouched.

## Testing

- `pnpm run build && pnpm run hygiene` on this change's tree: `run-gates: 16 passed, 0 failed, 0 skipped`. The same sequence was red on `constraints` before the declaration change.
- A full `DSH_COVERAGE_PARTITIONS=4 pnpm run test:coverage:partitioned` run under Node 24 on macOS reported 100% for every measured file, `packages/client/better-sidebar/src/pty-manager.ts` included, and its only failing test was `packages/util/http-proxy/tests/install.spec.ts` — "connects directly when the bypass list covers the target", a 5000 ms timeout that also fails in isolation on that host and belongs to no package this fork changes. That result did not establish the gate's Linux behavior: `pty-manager.ts` restores node-pty's spawn-helper executable bit only where that macOS-only artifact exists, so the Linux runner reports two uncovered locations at `pty-manager.ts:38` and misses the file's statement and branch thresholds. `packages/client/better-sidebar/tests/cov-host-platform-edges.spec.ts` now pins that path by injecting `linux` under its existing `node:fs` mock, so the branch no longer depends on the host's file layout. `better-sidebar` is fork-local, absent from upstream, which is why no earlier lane measured the file.
- The workflow parses and `scripts/ci-workflow.spec.ts` (43 tests) passes; that spec reads the archived upstream workflows, so it constrains the new jobs only indirectly.
- The first CI run is the only verification of the jobs themselves; nothing on a developer machine executes a GitHub Actions job.

## Related

- [CI Node compile cache](2026-08-28-ci-node-compile-cache-data-disk.md) — the lane-scoped environment injection upstream lanes carry and these two do not.
- [Post-sync debt sweep](../bug-fix/2026-08-28-post-sync-debt-sweep.md) — the coverage exclude registrations this gate now runs against.
