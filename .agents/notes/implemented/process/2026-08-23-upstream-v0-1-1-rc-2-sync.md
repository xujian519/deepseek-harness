# Agent Note: Sync upstream dsh-v0.1.1-rc.2 into the fork

Status: implemented

English | [中文](2026-08-23-upstream-v0-1-1-rc-2-sync.zh.md)

## Problem

Upstream released `dsh-v0.1.1-rc.2` (`b150a551b8`), 431 files changed (+8101/−2039) against the rc.1 base (`528c682e06`) the fork merged in PR #20. Upstream rc.2 is dominated by the image-pipeline unification: `read_image` canonical admission with deterministic downscaling, `originalDimensions` in the result envelope, `saveImage` returning the canonical ref beside source facts, and the retired image-region tool. The fork's own surfaces (patent, self-evolve, desktop, synapse, plugin-market, the `dsh-timeout-guard` rename) sit on the same rc.1 base.

## Decision

Merge forward in one merge commit (`Merge upstream v0.1.1-rc.2 (b150a551b8) into fork`), with conflict resolution by category:

- **Conflicts (9 files, all documentation)**: `docs/event-producer-consumer.{md,zh.md}`, `docs/module-graph.{md,zh.md}`, `packages/fs/tool-fs/README.{md,zh.md}` plus their `.i18n.yaml` pair records. The generated graph docs took the fork side as the merge baseline and were then regenerated from the merged tree, which folds in the upstream changes (the `llm/stream` source-line move, the dropped `permission-presets` dependency of `host-apiproxy`) while keeping fork content. The hand-written tool-fs README merged both sides: the fork's `timeout-guard` wording stays, the upstream `No attachment-region tool` limitation bullet is adopted.
- **No source conflicts**: fork code does not touch the reworked attachment/`read_image` seams; `typecheck`, `lint` (89 rules), and the unit suite pass on the merged tree without further source changes.
- **Version family**: the 25 fork-only package manifests plus `apps/desktop/package.json` bumped `0.1.1-rc.1` → `0.1.1-rc.2` so the workspace shares one version, as the dsh release family requires. No tags pushed — the fork shares the `dsh-v*` tag space with upstream.
- **Regeneration**: doc graphs, module graph, cordis/config/tool/persistence catalogs, client slot catalog, scoped events, and third-party notices regenerated against the merged tree. The regeneration restored fork entries the merged upstream catalog content had dropped (`dsh-host-synapse`, `dsh-client-synapse`, `dsh-client-ui-document-studio`, `dsh-self-evolve-eval` in the config catalog; synapse/patent/self-evolve rows in the module graph). The zh counterparts were mirrored by hand and the five changed pairs re-recorded (`verify-translation-pairing --write`).
- **Stale build artifacts**: the gitignored `apps/desktop/release/` and `apps/desktop/resources/mac/` outputs from a previous desktop build were deleted; they are not translation-scope exclusions and their stale rc.1-era READMEs broke the pairing scan.
- **Pre-existing master gate debt stays out of this PR**: the failing `launch-checklist` links/wrap, the `createFixtureApi` export-JSDoc drift, the nested `packages/self-evolve/evaluation` package-path violation, and the `self-evolve-eval`/`synapse` README model-experience/limitations gaps were introduced by PRs #23/#24/#26 on master and are tracked by `fix/master-gate-debt` (PR #28).

## Consequences

The fork tracks upstream rc.2 with its own seams intact: `dsh-timeout-guard` naming, the desktop/patent/self-evolve/synapse surfaces, and the fork's CI layout all survive, and `dsh` package versions read `0.1.1-rc.2` across the workspace. The image-pipeline semantics upstream shipped (canonical image admission, downscaled reads with `originalDimensions`) are now part of the fork's `tool-fs` surface without fork-side code changes.

## Alternatives considered

- **Merging upstream rc.2 into `fix/master-gate-debt` first**: rejected — the sync branch stays a clean upstream-merge record; the master gate debt lands via PR #28 on top of the new master, and the two branches share no conflicting hunks.
- **Adding the desktop artifact paths to the pairing excludes**: rejected — they are disposable build outputs; deleting them keeps the excludes list upstream-faithful.
- **Translating the regenerated catalogs from scratch**: rejected — the fork rebuilds zh pages by mirroring the regenerated English sides (existing convention from the rc.1 sync).
