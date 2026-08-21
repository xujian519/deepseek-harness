# Agent Note: Sync upstream dsh-v0.1.1-rc.1 into the fork

Status: implemented

English | [中文](2026-08-21-upstream-v0-1-1-rc-1-sync.zh.md)

## Problem

Upstream released `dsh-v0.1.1-rc.1` (`528c682e06`), 172 commits and 2303 files ahead of the rc.8 base (`141eb6fef8`) the fork had merged. The fork carries 107 first-parent commits of its own work (desktop, patent, self-evolve, plugin-market, the `dsh-timeout-guard` rename) on the same base, so a plain merge produced 87 conflicted files across docs, Agent Notes, READMEs, CI workflows, two source files, and two snapshots.

## Decision

Merge forward in one merge commit (`Merge upstream v0.1.1-rc.1 (528c682e06) into fork`), with conflict resolution by category:

- **`remote-events.ts`**: take the upstream `credentials/reference-updated` rename; keep the fork's `@deepseek-ai/cordis/*` forwarded-event names, which match the fork's rescoped cordis-host-runner emits.
- **`gen-cordis-catalog.ts`**: keep both sides' additions — the fork's `desktop`/`@deepseek-ai` rows and the upstream `authorization` rows.
- **`.github/workflows`**: the fork runs only `ci-fork.yml` + `expected-filenames.yml`; upstream's new and changed workflows (`ci-master.yml`, `release-publish.yml`, `release-vendor-publish.yml`, updated `issue-lifecycle.yml`/`issue-policy.yml`) join `workflows-disabled/` as an archive that follows upstream rc.1 verbatim. `ci-workflow.spec.ts` takes the upstream assertions plus the fork's `workflows-disabled/` fallback in `loadWorkflow`; `client-build-environment.client.spec.ts` keeps the fork's directory scan.
- **Agent Notes / docs**: fork substance wins where the fork decided (the `dsh-timeout-guard` rename stays; the fork's `workflows-disabled/` paths stay); upstream substance wins elsewhere (the `.zh.md` link localization, the ci/ci-master split facts). Regenerated catalogs, module graph, doc graphs, and translation-pairing records against the merged tree.
- **Snapshots**: the pwsh fixture moved via `migrate:packed-session-fixtures`; the translation-prompt response re-recorded against the rc.1 prompt.
- **Version family**: the fork's 22 non-upstream manifests bumped `0.1.0-rc.8` → `0.1.1-rc.1` so the workspace shares one version, as the dsh release family requires. No tags pushed — the fork shares the `dsh-v*` tag space with upstream.
- **self-evolve projection**: adapted to the rc.1 `ProjectionDefinition` wire form (`stateSchema` + `wire.view/viewSchema`, `SessionProjectionStateMap` declaration merge); the unit stays client-visible per its existing `SessionProjectionMap` entry.
- **rescope-vendor**: retired the knip logger-console edit (upstream already dropped the `@cordisjs` entry); exempted the `cordis/before-approval` event-domain listeners and the desktop-package vendor-tree path from the generic token pass.

## Consequences

The fork tracks upstream rc.1 with its own seams intact: `dsh-timeout-guard` naming, the desktop/patent/self-evolve surfaces, and the fork's CI layout all survive. `dsh` package versions read `0.1.1-rc.1` across the workspace. The upstream `timeout-policy` FIXME ("settle the intended dsh-timeout-guard rename before the first tagged release") remains open upstream; the fork keeps its decision and will re-conflict on every future change upstream makes to that package until upstream adopts the rename.

## Alternatives considered

- **Reverting the fork's `dsh-timeout-guard` rename to follow upstream**: rejected — the fork made the decision deliberately (role naming over mechanism naming) with a shipped Agent Note; upstream's own FIXME calls the rename "intended".
- **Translating the regenerated catalogs from scratch**: rejected — upstream rc.1 ships complete zh counterparts; the fork rebuilds its zh pages from the upstream zh base plus the fork-only sections.
- **Running the fork's adapted issue workflows**: rejected — the fork's free-tier CI layout only runs `ci-fork.yml`; the upstream workflows stay archived.
