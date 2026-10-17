# Agent Note: upstream dsh-v0.2.1-rc.2 sync

Status: implemented

English | [中文](2026-10-17-upstream-dsh-v0.2.1-rc.2-sync.zh.md)

## Problem

The fork moved from upstream's `dsh-v0.2.1-rc.1` tag to `dsh-v0.2.1-rc.2`: 9 commits (5 non-merge), 456 files, +4,921/−845 lines. The merge base is the rc.1 release commit the previous sync landed, so one `git merge` reaches the tag. The merge produced 15 conflicts: three in executable source or manifests and twelve in generated documents and their bilingual records.

Unlike rc.1, this release carries behavior. `web-deepseek-api` adds the DeepSeek Search and Fetch APIs behind the Web Search settings switch, `llm-deepseek` appends `1017` to the bundled DeepSeek Flash display name, and `ui-deepseek-model-label-1017` adds a temporary badge. The release commit raises the DSH family to `0.2.1-rc.2`.

## Decision

- **The sync branch merge-forwards the release tag.** `sync/upstream-dsh-v0.2.1-rc.2` starts at the fork `master` tip and merges `dsh-v0.2.1-rc.2`. Landing it as a merge commit whose first parent is `master` keeps upstream's commits and the tag in the fork's graph.
- **The web seam keeps the fork's selection helpers over upstream's live settings reads.** `packages/web/web/src/index.ts` retains `selectProvider()` and `resolveFetchProvider()`, and each operation reads `this.config.searchProvider.get() ?? this.searchProviderEnv` (with the fetch equivalent) so a settings change applies to the next search or fetch.
- **The bundle keeps the fork's curated dependency list and adds the new provider.** `packages/bundle/base/package.json` appends `@deepseek-ai/dsh-web-deepseek-api`, and `packages/bundle/base/cordis.patch.yml` registers it with the same `DEEPSEEK_API_KEY` reference as the Messages search provider.
- **The tool-lsp manifest keeps the fork's literal em dash.** `packages/lsp/tool-lsp/package.json` retains the fork description and raises only its version.
- **Generated documents are regenerated rather than hand-merged.** `docs/capability-seams.md`, `docs/persistence-catalog.*`, `docs/persistence-schema.json`, and `docs/persistence-changes/historical-formats/README.*` come from `gen-doc-graphs`, `gen-persistence-catalog`, and `persistence-formats --write`. `docs/capability-seams.zh.md` is authored on the Chinese side, so its diagram nodes, `pkg_web_deepseek_api --> svc_web` edge, and provider row mirror the generated English addition.
- **Two upstream duplication suppressions state their reason.** The `web-deepseek-api` transport mirrors the Messages search transport, and the fork's suppression gate requires an inline reason on each `jscpd:ignore-start`.
- **The version is pinned across the fork surface.** The root manifest, 47 fork manifests, `SIDEBAR_SERVICE_VERSION`, and nine ACP `agentInfo.version` goldens move to `0.2.1-rc.2`. `scripts/release/verify.ts --family dsh` resolves 390 members at that version with no unordered peer declaration.
- **The tool and config catalogs are regenerated against this tree.** Base `master` carried catalog entries for two patent-methodology fields whose sources live only on the unmerged feature branch; regeneration aligns both catalogs with the sources present here.

## Consequences

The fork ships the rc.2 behavior — DeepSeek Search and Fetch APIs behind the settings switch and the DeepSeek Flash 1017 label — while the patent, self-evolve, desktop, better-sidebar, and document surfaces keep their previous behavior. The merged tree changes 515 files against the pre-sync `master`: 456 upstream files plus fork version pins and regenerated documentation.

The settings switch now writes the `web` namespace's `searchProvider` and `fetchProvider` refs at runtime, so the fork's `resolveFetchProvider()` reads the same live values as `fetch()`. The new package is part of the base bundle and resolves `DEEPSEEK_API_KEY` the same way as the Messages provider.

Regenerating the catalogs removed `conflictingApplications` from the tool catalog and `guidelineRevision` from the config catalog because their sources are not on `master`. The feature branch that adds those sources regenerates both catalogs when it merges forward.

## Alternatives considered

- **Taking upstream's `packages/web/web/src/index.ts` wholesale.** Rejected: it drops `resolveFetchProvider()` and `selectProvider()`, which the fork's tool enablement consults at load time.
- **Keeping the fork's static provider ids.** Rejected: the settings switch updates volatile config refs after mount, and static ids would ignore the new selection.
- **Hand-merging the generated persistence and capability documents.** Rejected: the counts, digests, and section hashes are derived from source, so the generator is the only reliable resolution.
- **Leaving the upstream `jscpd:ignore-start` lines unannotated.** Rejected: `hygiene` fails on every suppression without a stated reason.

## Testing

`pnpm run build:artifacts` passes 7 of 7 gates. `pnpm run typecheck` passes all five gates — Host Typert, the host and client compilers, and both aggregates — and `pnpm run build:check` passes both aggregate checks on the built output.

`pnpm run lint` exits 0 with the one pre-existing unused-disable warning in `packages/experimental/client-ui-cot-translation/src/index.ts`. `pnpm run hygiene` reports 22 of 22 gates passing after the suppression reasons are added. `pnpm run doc-sync` reports 51 of 51 gates passing.

Targeted tests cover the changed surfaces: 55 files and 1,164 tests across `packages/web`, `packages/client/ui-settings-web-search`, `packages/client/ui-deepseek-model-label-1017`, and the DeepSeek LLM packages.

`pnpm run test:snapshot` replays 226 cases across the session, sdk, acp, and web lanes with 224 passing and 2 skipped. The host's `/usr/bin/python3` is 3.9.6, below the PTC runtime's CPython 3.10 floor; the replay passes with Homebrew Python 3.14 on `PATH`, which is the environment condition for `ptc-python-turn`.
