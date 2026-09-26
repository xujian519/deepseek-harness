# Agent Note: Fork CI runs the recorded-session snapshot lane

Status: implemented

English | [中文](2026-09-26-fork-ci-snapshot-lane.zh.md)

## Problem

`ci-fork.yml` ran lint, typecheck, duplication, the unit suites, the built-artifact suites, the documentation checks, coverage, hygiene, benchmarks, and the keyless Python suite. No lane ran `pnpm run test:snapshot` — the only keyless end-to-end check of model-visible behavior. It boots the shipped profiles, replays committed transcripts, and compares the assembled request headers, system prompts, and persisted logs against committed expectations.

While no lane ran it, those expectations drifted away from the source they pin. The pinned `tool-schemas.expected.json` and `system-prompt.expected.md` sidecars still carried prompt and tool-description wording from before the fork trimmed its model-facing prose, and the committed session generations were V3 while the checkout writer is V4. On the merge base of the change that adds this job, 83 of the lane's 190 cases failed on a request header or a system prompt.

## Decision

`ci-fork.yml` gains `node-snapshots`, restricted to `pull_request`, bounded at 45 minutes, running four steps in order: `pnpm install --frozen-lockfile`, `bash scripts/prepare-ci-bubblewrap.sh`, `pnpm run build`, and the lane as `DSH_EXAMPLE_MODE=lib pnpm run test:snapshot snapshots scripts/session-snapshot-corpus.corpus.ts`.

### The lane owns its build and its confinement

`DSH_EXAMPLE_MODE=lib` boots every profile subprocess from built `lib/` under plain Node, where a bare package plugin resolves through the package's real `exports`; source mode is the zero-build developer path, which resolves workspace imports through the tsconfig paths map instead. `scripts/build.ts` also builds the native system addon that the Session log flocks through, so one build step covers both. The confinement scenarios pin the Session file policy through real sandboxing, and the Linux chain prefers `bwrap` over Landlock, which the hosted image cannot provision for an unprivileged user namespace; the job therefore carries the same preparation step as `node-checks` and `node-built-suites`.

### Both filters are load-bearing

`DSH_EXAMPLE_MODE=lib` also makes `vitest.snapshot.config.ts` collect `apps/web/tests/**/*.snapshot.ts`, so the lane needs an explicit `snapshots` filter to stay on the recorded-session corpus. That filter alone would then drop `scripts/session-snapshot-corpus.corpus.ts`, the policy file that checks ownership, header pins, redaction, and cross-scenario Session references over the same tree, so the job names both paths.

### The job waits on pull requests only

A pull-request run gates the merge that lands a change, and this fork's merge path is a pull request. Upstream restricts its snapshots-and-artifacts lane the same way. `node-checks`, `node-built-suites`, and `node-hygiene` run on both events and stay as they are.

## Alternatives considered

**Run `pnpm run check:ci:snapshot`, the aggregate upstream's artifacts lane calls.** Rejected: the aggregate sets `DSH_EXAMPLE_MODE=lib`, which is also what collects `apps/web/tests/**/*.snapshot.ts`. Those four cases launch Chromium against the built Web client, one of them (`minimal-preset`) compares a stale ARIA golden and fails on this host — the render is missing a `tab "Teams"` row the golden holds — so the job would need Playwright provisioning and would arrive red on Web-lane work. The recorded-session corpus carries the model-visible contract this job exists to defend; the assembled Web snapshot belongs to the Web lane, which this fork does not wire.

**Run the lane in source mode (`pnpm run test:snapshot`, no environment).** Rejected: every CI lane here that owns a build runs profile subprocesses from built `lib/` ([testing policy](../../../../docs/testing.md)), and source mode would exercise a resolution path no user installation takes.

**Run it on pushes to `master` as well.** Rejected: the pull-request run already gates the merge, and a redundant second run of a 45-minute lane on every merge buys no new signal.

**Keep the fixture refresh out and let the job arrive red.** Rejected: a lane that is red on arrival is a lane nobody reads, and the refresh is the evidence that the lane works. The refresh is reviewed as its own commit — 143 new session generations, 63 sidecars, 8 native-writer oracles, and three web Session references — while this commit adds the job, the workflow spec assertion, and the tier line in `docs/testing.md`.

## Consequences

- A pinned expectation that drifts from the current composition, a Session-format successor that is missing, and a cross-scenario reference that stops naming its owner's selected generation now fail the pull request that introduces them. The refresh in this pull request is the first proof: the lane reports 188 passed and 2 skipped where the merge base reported 83 failed.
- `apps/web/tests/**/*.snapshot.ts` keeps no CI signal in this fork. `minimal-preset.snapshot.ts` fails on this host against its committed ARIA golden, so that lane needs its own refresh and Playwright provisioning before it can be wired.
- The job pays for an install and a full build that `node-built-suites` and `node-hygiene` also pay, because GitHub Actions jobs share no workspace. It is the third build in the workflow.

## Testing

- `pnpm run test:snapshot`: 188 passed, 2 skipped, 0 failed (was 83 failed of 190 on the merge base).
- The job's own command on this host, `DSH_EXAMPLE_MODE=lib pnpm run test:snapshot snapshots scripts/session-snapshot-corpus.corpus.ts`, over a fresh `pnpm run build`: 4 files, 188 passed, 2 skipped.
- `pnpm run test:snapshot:refresh` needs two passes to settle: the first leaves 14 failures — 11 order-dependent readers, 2 SDK scenarios that pin a `text-turn` sidecar, and one cross-scenario reference — and the second reports 4 files passed and 187 passed. Refresh is serial, so a scenario that reads another scenario's pin or header source compares against the file that run rewrites later.
- `pnpm exec vitest run scripts/ci-workflow.spec.ts`: 50 passed, including the case that pins this job's step order, lib mode, and both filters.
- The first GitHub Actions run is the only verification of the job itself; no local command executes a workflow.

## Related

- [Fork CI hygiene and coverage gates](2026-09-19-fork-ci-hygiene-and-coverage-gates.md) — the two jobs this one is shaped like, and the install cost they share with it.
- [`dsh-session-snapshot`](../../../../packages/test-support/session-snapshot/README.md) — the shared storage, launcher, and normalization rules the lane runs on.
