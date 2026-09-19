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

The job installs, prepares bubblewrap, then runs `pnpm run check:ci:coverage` under `DSH_COVERAGE_PARTITIONS=4`, `DSH_COVERAGE_MAX_WORKERS=2`, `DSH_COVERAGE_TEST_TIMEOUT_MS=90000`, and `DSH_GATE_FAIL_FAST=1`, bounded at 180 minutes and restricted to `pull_request`. The two budgets do different work: with partitions configured, the coordinator runs four single-worker Vitest processes in parallel and ignores the instrumented share of `DSH_COVERAGE_MAX_WORKERS` completely, so that budget sizes only the exempt-heavy gate — `2` yields one worker there where upstream's `6` yields two — and the lane runs five Vitest processes on four cores. Four partitions stay because upstream uses four and because this lane's failures traced to fixture budgets rather than to that fifth process. The per-test budget is the one the unit lane grants for the same reason. No build step: workspace imports resolve to `src` through the tsconfig paths map, and the aggregate builds the native system addon it needs before the instrumented run. A test that reaches a workspace package through the Loader's own entry-module import instead is out of that map's reach, which the lane's failures below demonstrate.

The `PRIMARY_NODE_VERSION` pin matters here beyond consistency. Under Node 22 the gate is red before it measures anything: the `ModuleLoaderV2` branch in `packages/boot/app-boot/src/profile-resolution/resolver.ts` does not execute before the v2 module-job API arrives in Node 24.12 ([vendor sync notes](../../../../vendor/README.md)), so those lines stay uncovered.

### The constraints declaration

`appPackageFiles['@deepseek-ai/dsh-desktop-host']` now lists `config/desktop.cordis.patch.yml` beside `lib/index.js`. The manifest was right and the declaration was stale; the desktop host resolves that overlay from its own directory at runtime, so the file belongs to the package's publication payload.

## Alternatives considered

**Run both aggregates inside `node-checks`.** Rejected: the coverage aggregate takes far longer than the rest of that lane and would put the fast signal behind it, and adding a build there changes what the unit suites run against.

**Run the hygiene aggregate without a build.** Rejected: three of its gates would then inspect an empty publication view, which is a green that checks nothing.

**Give the coverage job a build.** Rejected: the aggregate reads no `lib/`, the anchor suites self-skip on an unbuilt checkout, and upstream's coverage lanes are build-free. Covering a test's need for a built artifact by building would also trade the source plane away for every suite in the lane, since a workspace import that resolves to `lib/` measures emitted output instead of `src`.

**Keep the coverage gate out of CI.** Rejected: the fork's coverage state then rests on whoever remembers to run it, which is how the packages registered by the [post-sync debt sweep](../bug-fix/2026-08-28-post-sync-debt-sweep.md) sat outside the measurement until that sweep.

**Run coverage on `master` pushes too.** Rejected: a pull request already gates its own merge, and upstream restricts its coverage job to `pull_request` for the same reason.

## Consequences

- A constraints drift of the `apps/desktop-host` kind fails `node-hygiene` on the pull request that introduces it.
- Coverage regressions in the measured `packages/*/*/src` set fail `node-coverage`. The fork-local families registered in `vitest.config.ts` (`packages/patent/*`, `packages/web/synapse`, `packages/self-evolve/*`, `packages/client/ui-agent-preset`, and the document studio) stay outside the measurement.
- The gate's first run found the fork's only below-threshold file, `packages/client/better-sidebar/src/pty-manager.ts`, a gap no upstream lane can see because the package is fork-local.
- The fork's CI wall-clock grows by the coverage aggregate, which is the longest job in the workflow: its first run measured 20 minutes on the 4-core runner with the original four-process budget, and it runs only on pull requests.
- The lane's four runs each failed on a fixture, never on a threshold. Run 1 stopped at the bubblewrap fetch, since re-pinned. Runs 2-4 reported zero threshold misses and tripped the same three cases, each against a budget rather than against its assertion: the two O(depth) memory cases in `packages/experimental/ptc-runtime-python/tests/runtime.spec.ts` at their own 60 s wall-clock ceilings (60.1 s and 43.6 s measured), `scripts/gen-client-catalog.spec.ts`'s workspace scan at its 30 s test budget (31.5 s measured), and the stale-config assertion in `packages/preset/agent-presets/tests/mount.spec.ts`.
- The mount case was not a race at all. Its fixture row named the shipped `@deepseek-ai/dsh-persona`, which the Loader resolves through Node to the package's built `lib/`; on a tree without that build the row never imports, and the mount reports `persona (@deepseek-ai/dsh-persona): never started` instead of the schema refusal the case pins. The unit lane builds `lib/` as a side effect of `typecheck`'s `build:lib:host`; the coverage lane builds nothing. The fixture's row now carries an import-free local plugin, which the mount reports with the same schema line in both lanes.
- The two budget-bound cases are now sized for this runner instead of for an idle machine. The ptc-runtime cases carry a 120 s ceiling with a 180 s case budget, twice the worst lane measurement and still under the case budget so an overrun reports the memory verdict; the workspace scan joined the coverage-exempt roster, where `scripts/`' files are never instrumented and the 3.7x instrumentation tax measured on a workstation (1.5 s to 5.4 s) no longer applies.
- Two calibration facts belong to this lane rather than to any test. A row or fixture module must be import-free, because the Loader resolves entry modules through Node's ESM resolver and no lane here builds. And a fixture budget calibrated on an idle machine has roughly a fifth of its nominal headroom here: the same ptc-runtime case takes 12.7 s instrumented on a workstation and 60 s on this runner.
- Both new jobs duplicate the install step that `node-checks` already pays for. GitHub Actions jobs do not share a workspace, so this is the cost of keeping the unit lane's precondition untouched.

## Testing

- `pnpm run build && pnpm run hygiene` on this change's tree: `run-gates: 16 passed, 0 failed, 0 skipped`. The same sequence was red on `constraints` before the declaration change.
- The mount case's lane failure reproduces on this host: with `packages/preset/persona/lib` moved aside, `packages/preset/agent-presets/tests/mount.spec.ts` reports `persona (@deepseek-ai/dsh-persona): never started (…/stale-persona/agent.cordis.yml)`, the coverage lane's exact string, and the file reports 54 passed 54 with the directory in place. The replacement fixture reports the same 54 passes in both states, which is what removes the case's dependence on the lane that builds.
- Both sides of the roster entry: `DSH_COVERAGE_EXEMPT_HEAVY=1 pnpm exec vitest list --filesOnly` no longer lists the workspace scan, and running the exempt gate's own filter set (`vitest run scripts/gen-client-catalog.spec.ts scripts/install-lefthook.spec.ts scripts/oxlint-contract.spec.ts scripts/change-scope.spec.ts scripts/translation-pairing-merge.spec.ts`) reports 5 files and 102 tests passed, the scan at 1.6 s.
- `pnpm run check:ci:coverage` under the lane's own budgets (`DSH_COVERAGE_PARTITIONS=4 DSH_COVERAGE_MAX_WORKERS=2 DSH_COVERAGE_TEST_TIMEOUT_MS=90000`, without fail-fast so both gates report): 2 gates passed, 1 failed, and both failures belong to this host rather than to the change. The instrumented gate's only threshold gap is `packages/boot/app-boot/src/profile-resolution/resolver.ts`, the Node 22 red this job pins Node 24 against. Four cases in `packages/client/ui-document-studio/tests/client-bundle.client.spec.ts` fail against a locally built studio bundle older than the studio's own change; that suite self-skips on the unbuilt checkout CI runs. Every case this change touches passed inside the lane: the mount file 54/54 in 501 ms, the ptc-runtime file in 111 s with its two O(depth) cases at 14.3 s and 7.9 s, and the exempt gate green in 122.7 s over the enlarged roster.
- A full `DSH_COVERAGE_PARTITIONS=4 pnpm run test:coverage:partitioned` run under Node 24 on macOS reported 100% for every measured file, `packages/client/better-sidebar/src/pty-manager.ts` included, and its only failing test was `packages/util/http-proxy/tests/install.spec.ts` — "connects directly when the bypass list covers the target", a 5000 ms timeout that also fails in isolation on that host and belongs to no package this fork changes. That result did not establish the gate's Linux behavior: `pty-manager.ts` restores node-pty's spawn-helper executable bit only where that macOS-only artifact exists, so the Linux runner reports two uncovered locations at `pty-manager.ts:38` and misses the file's statement and branch thresholds. `packages/client/better-sidebar/tests/cov-host-platform-edges.spec.ts` now pins that path by injecting `linux` under its existing `node:fs` mock, so the branch no longer depends on the host's file layout. `better-sidebar` is fork-local, absent from upstream, which is why no earlier lane measured the file.
- The workflow parses and `scripts/ci-workflow.spec.ts` (43 tests) passes; that spec reads the archived upstream workflows, so it constrains the new jobs only indirectly.
- The first CI run is the only verification of the jobs themselves; nothing on a developer machine executes a GitHub Actions job.

## Related

- [CI Node compile cache](2026-08-28-ci-node-compile-cache-data-disk.md) — the lane-scoped environment injection upstream lanes carry and these two do not.
- [Post-sync debt sweep](../bug-fix/2026-08-28-post-sync-debt-sweep.md) — the coverage exclude registrations this gate now runs against.
