# Agent Note: Hygiene gate debt and the liberalization-plugin conflict

Status: proposed

English | [中文](2026-08-26-hygiene-gate-debt-and-conflict.zh.md)

## Problem

The `feat/onboarding-rebrand-dsh-patent` branch carries pending changes that belong entirely to the self-evolve family (`packages/self-evolve/self-evolve-benchmark/` plus regenerated catalog/doc outputs for `ctx.selfEvolveBenchmark`). A parallel window reported two gate failures over this change and asked whether they are pre-existing debt or introduced here: the `hygiene` gate (knip + constraints) and the full `test:coverage` run.

These failures must be classified before they are fixed, because their ownership differs. If an item belongs to the other window's ongoing liberalization-plugin work (`dsh-im` bundle design, external plugin integration, preset switching) fixing it here would collide; if it is unrelated debt it can be repaired independently.

## Proposal

This note records the root-cause analysis and the repair backlog, to be applied after the liberalization-plugin window closes, in one coordinated change.

### Root cause of the `hygiene` failures

**constraints — one error, unrelated debt.** `packages/self-evolve/evaluation` reports `expected a package here (no package.json found)`. That directory holds only `RUNBOOK.md`/`RUNBOOK.zh.md` — a P1-10 offline-evaluation data/document directory, deliberately excluded from the workspace by `pnpm-workspace.yaml` (`- '!packages/self-evolve/evaluation'`). But `checkHierarchyShape()` in `scripts/check-workspace-constraints.ts` walks `packages/*/*` and skips only `localArtifactDirs` (`node_modules`); it never reads the `!` exclusion globs in `pnpm-workspace.yaml`, so it misreads the excluded directory as a package with no manifest. This is a script/workspace-exclusion mismatch debt, unrelated to the self-evolve-benchmark change.

**knip — two distinct items split across ownership.**

- `@deepseek-ai/dsh-fs` (unused devDependency in `packages/memory/openviking`): neither `src/` nor `tests/` imports it, and `package.json` declares it in both `dependencies` and `devDependencies`. Genuinely redundant, unrelated debt; the fix is to drop the declaration.
- `@xmanrui/dsh-im` (unused dependency in `packages/bundle/im`) and that package's knip.json configuration hints: `packages/bundle/im` was introduced by HEAD `3350947517 feat(bundle): integrate @xmanrui/dsh-im`, an item of the liberalization-plugin work. Its `src/index.ts` is `export {}` — a pure patch-list carrier with no runtime API; `@xmanrui/dsh-im` appears only in `cordis.patch.yml` (YAML), README, and comments, so knip's static TS analysis cannot see the YAML `name:` reference and reports the dependency unused. The bundle also has no `knip.json` of its own, so it falls into the root `packages/*/*` default rules whose `tests/` entry/project patterns match nothing in this testless package, triggering both "Refine entry pattern (no matches)" and "Refine project pattern (no matches)" hints. The `self-evolve-app`, `base`, `desktop-app`, and `web-app` bundles already carry an `ignoreDependencies: ["@deepseek-ai/.+"]` entry; `@xmanrui/dsh-im` is external so it needs its own exemption.

### Root cause of the `test:coverage` failures

The coverage gate uses `coverage.perFile: true` with `statements/branches/functions/lines: 100` in `vitest.config.ts`, so every `src` file must be 100% covered. The failing packages (`web/synapse`, `patent-*`, `self-evolve-basic`, `self-evolve-eval`, `client/ui-agent-preset`, `host/apiproxy`) have source trees that are not fully covered and are absent from the vitest exclude list, so they run the per-file 100% gate. Representative examples: `packages/web/synapse` has 6 `src` files against 5 specs; `packages/patent/patent-core` has 75 `src` files against 10 specs. Most of that source is GUI (`web/synapse`, `ui-agent-preset`, `apiproxy`) or patent asset code, the same class as the already-excluded client-UI GUI debt that has not yet been registered in `exclude`. These packages exist on `master` and the working tree does not touch them, so the failures are pre-existing.

### Conflict with the liberalization-plugin window

Two lines share a narrow band of files and collide there: `scripts/gen-cordis-catalog.ts`, `scripts/gen-doc-graphs.ts`, `packages/extensions/tool-cordis/src/api-catalog.ts` (a generated artifact, already modified here), and the regenerated `docs/config-catalog.*`, `docs/capability-seams.*`, `docs/subsystems/*`. The generators carry a byte-for-byte reproduction gate (`--check`); whenever the liberalization work adds any `ctx.*` service or moves a service's owning package, it must rerun both generators and rewrite the catalog docs, landing on the same files as this self-evolve change. The runtime code is disjoint (`app-boot`, `plugin-market`, `agent-presets`, `self-evolve-benchmark` do not overlap).

## Repair backlog

Items 1 and 2 shipped 2026-08-26 once the liberalization-plugin window closed; item 3 and the `bundle/im` items remain. The original list:

1. `scripts/check-workspace-constraints.ts` — **implemented 2026-08-26.** `checkHierarchyShape()` now reads the `pnpm-workspace.yaml` `!` exclusion globs (via `yaml.load`, as `scripts/gen-third-party-notices.ts` does) and skips the excluded `packages/self-evolve/evaluation` tree instead of misreading it as a package with no manifest.
2. `packages/memory/openviking/package.json` — **implemented 2026-08-26.** Dropped the redundant `@deepseek-ai/dsh-fs` from `devDependencies` (the section knip flags), leaving it a `peerDependencies` declaration only.
3. The `test:coverage` failures are confirmed pre-existing and deliberately out of scope for this repair; they need a separate debt change either adding coverage or registering the packages in `vitest.config.ts` `exclude`. **Pending.**

The `@xmanrui/dsh-im` / `bundle/im` knip items belong to the liberalization-plugin window: give `packages/bundle/im` a knip configuration (its own `knip.json` or a root `knip.json` entry) that exempts `@xmanrui/dsh-im` and corrects the entry/project patterns so it stops reporting hints. Do not fix these here to avoid colliding. **Pending — the window's item.**

## Alternatives considered

- **Fix everything, including `bundle/im`, in this change.** Rejected: `bundle/im` is the other window's active area; editing it here would collide. The `@xmanrui/dsh-im` items are also not existing debt but a consequence of the bundle design the other window is still landing.
- **Treat all `hygiene` failures as pre-existing and ignore them.** Rejected: two of them (`constraints` evaluation, `openviking` `dsh-fs`) are unrelated, deterministic, cheap fixes that should not rot further.
- **Fix the `test:coverage` failures now.** Rejected: they span many GUI/patent source files (adding coverage or registering exclusions) and are confirmed pre-existing; treating them as a separate debt change keeps this repair scoped.

## Acceptance criteria

- The analysis above is recorded so the repair can be applied later without re-investigation.
- The repair keeps `@xmanrui/dsh-im` / `bundle/im` ownership with the liberalization-plugin window; this change does not edit those files.
- Items 1 and 2 landed 2026-08-26 (items 3 and the `bundle/im` items remain for their own debt/window changes); the repair keeps the two fixes scoped and the two open items logged.

## Risks

- The two repair items (`check-workspace-constraints.ts`, `openviking` manifest) sat in shared catalogs; the narrow textual conflict motivated scheduling them after the liberalization window closed, and they landed 2026-08-26 without one.
- If the liberalization window changes the bounds of `bundle/im` before that repair runs, the recorded `@xmanrui/dsh-im` details may stale; the repair should re-verify them then.
