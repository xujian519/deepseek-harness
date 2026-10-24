# Agent Note: upstream dsh-v0.2.1-rc.3 sync

Status: implemented

English | [中文](2026-10-24-upstream-dsh-v0.2.1-rc.3-sync.zh.md)

## Problem

The fork moved from upstream's `dsh-v0.2.1-rc.2` tag to `dsh-v0.2.1-rc.3`: 6 commits (5 non-merge), 640 files, +5,682/−1,021 lines. The merge base is the rc.2 release commit the previous sync landed, so one `git merge` reaches the tag. The merge produced 29 conflicts: six in executable source, manifests, or tsconfig; one in a generated package reference; five in bilingual README records; six in generated documents; ten in expected snapshots and web goldens; and one in `pnpm-lock.yaml`.

The release carries behavior. `llm-deepseek` follows the official `/models` listing on the DeepSeek API-key route instead of its bundled table. `ui-entry-customization` adds a new client package that lets users customize sidebar and conversation-view entries and create plugins from them. Sidebar and conversation-view pins now live separately from selection and render menu icons, and analytics records navigation entries and preset selections. The release commit raises the DSH family to `0.2.1-rc.3`.

## Decision

- **The sync branch merge-forwards the release tag.** `sync/upstream-dsh-v0.2.1-rc.3` starts at the fork `master` tip and merges `dsh-v0.2.1-rc.3`. Landing it as a merge commit whose first parent is `master` keeps upstream's commits and the tag in the fork's graph.
- **The preset seat adopts the structured apply outcome and keeps the fork's refusal surface.** `packages/client/ui-agent-preset/src/client/seat-store.ts` uses upstream's `AgentPresetApplyOutcome`, returns `{ kind: 'staged' }` when no Session is current, and returns `{ kind: 'refused', reason: SEAT_PRESET_LOCKED }` for a started Session so the chip still explains the lock instead of dropping the pick silently. The `apply.client.spec.ts` assertions for a started Session and for a pick the Session already runs now state those two outcomes separately.
- **Both bundle entries stay.** `packages/bundle/web-app/package.json` keeps `@deepseek-ai/dsh-client-ui-document-studio` and adds `@deepseek-ai/dsh-client-ui-entry-customization`; `cordis.patch.yml` registers both.
- **The agent-preset tsconfig keeps both project references.** `packages/client/ui-agent-preset/tsconfig.json` keeps upstream's `product-analytics` reference and the fork's `../../util/value` reference, because the package imports both `@deepseek-ai/dsh-client-product-analytics` and `@deepseek-ai/dsh-value`.
- **The llm-deepseek manifest keeps the fork's sorted dependency list.** `packages/llm/llm-deepseek/package.json` retains its alphabetical devDependencies and appends upstream's `@types/semver` at the end.
- **The tool-lsp manifest keeps the fork's literal em dash.** `packages/lsp/tool-lsp/package.json` retains the fork description and raises only its version.
- **Generated documents are regenerated rather than hand-merged.** `gen-plugin-packages` rewrites the skill's package reference, `gen-config-catalog` rewrites both config catalogs, and `gen-doc-graphs` rewrites the module graph and event producer/consumer documents in both languages.
- **Bilingual records are re-recorded for the merged READMEs.** `verify-translation-pairing --write` records `packages/client`, `ui-agent-preset`, `ui-conversation`, `ui-sidebar`, and `llm-deepseek` after both sides carry upstream's sections.
- **The expected web snapshots follow the rendered tab rows.** The six browser goldens now list the fork's Board, Deliverables, and Teams tabs where the test profile mounts them, followed by upstream's `More conversation views` button. `DSH_SNAPSHOT=refresh` rewrote them from the running app, and a replay confirms them.
- **The version is pinned across the fork surface.** The root manifest, 50 fork manifests, `SIDEBAR_SERVICE_VERSION`, and nine ACP `agentInfo.version` goldens move to `0.2.1-rc.3`. `scripts/release/verify.ts --family dsh` resolves 394 members at that version with no unordered peer declaration.
- **The rescope gate records the new preset-id sites.** `scripts/rescope-vendor.ts` lists the seven rc.3 files where `'cordis'` is the agent-preset id rather than a package reference, matching the existing skip records for the same product id.
- **The export JSDoc baseline is cleared.** Six legal and patent files gain the missing `@param`, `@returns`, property, and return-type annotations. The gate reported 33 gaps before this sync and 47 on the pre-sync `master`; `doc-sync` now passes all 51 gates.
- **The Synapse switch follows the new tab-row DOM and clears the right sidebar.** `ui-conversation` marks the full row as `data-conversation-tab-row`; the synapse plugin anchors to it, retries a row replaced between frames, and on a blank Session without a tab row parks below the conversation header. The previous window-corner fallback covered the right sidebar's file-open controls.
- **The new entry-customization e2e drops a redundant picker overlay.** `launchWebScaffold` already pins the in-app directory picker; applying `pin-browse-picker.overlay.yml` on top repeated the same insert rows, which the fork's loader rejects as duplicate entry ids.
- **The stale blank-cache golden records the normalized workspace title.** `snapshots/web/workspace-management/new-session.expected.md` now carries `{{workspace}}`, the token `captureStableAria` produces from the scaffold directory; the previous literal was not reproducible from this scenario.

## Consequences

The fork ships the rc.3 behavior — official DeepSeek model listing on the API-key route, navigation entry customization, separated navigation pins, and the new analytics events — while the patent, self-evolve, desktop, better-sidebar, legal, and document surfaces keep their previous behavior. The merged tree changes 719 files against the pre-sync `master`: 640 upstream files, fork version pins, regenerated documentation, refreshed web goldens, and the JSDoc completions.

The preset seat's return type is now a tagged outcome. Callers such as Settings read refusals through `outcome.kind === 'refused'`; a started Session still produces the `session-already-started` marker that surfaces translate, and a pick the Session already runs remains a silent `unchanged`.

The new `ui-entry-customization` package is part of the Web bundle and the generated package reference. Its hooks and analytics wiring import `@deepseek-ai/dsh-client-product-analytics`, which the agent-preset package also references. Regenerating the module graph also added the `packages/legal` group and its `tools` edges, which the pre-sync graph lacked.

## Alternatives considered

- **Taking upstream's `seat-store.ts` wholesale.** Rejected: upstream folds a started Session into `unchanged`, which drops the fork's localized refusal marker and leaves the chip reading as a no-op.
- **Keeping only upstream's `Deliverables` tab in the browser goldens.** Rejected: the fork's bundle mounts Board, Deliverables, and Teams, so the recorded rows must match the rendered tab strip.
- **Hand-merging the generated catalogs and graph documents.** Rejected: node lists, counts, and section hashes derive from source, so the generators are the only reliable resolution.
- **Leaving the pre-existing JSDoc gaps out of the sync.** Rejected: `doc-sync` is the repository's completion gate, and the missing tags document existing contracts without changing behavior.
- **Renaming the `cordis` preset id at the new sites.** Rejected: it is product data, and the rescope gate already carries the same skip for older sites.

## Testing

`pnpm run typecheck` passes all five gates — Host Typert, the host and client compilers, and both aggregates. `pnpm run build:artifacts` passes 7 of 7 gates, and `pnpm run build:check` passes both aggregate checks on the built output. `pnpm run lint` reports 0 warnings and 0 errors across 7,344 files. `pnpm run hygiene` passes 22 of 22 gates, and `pnpm run doc-sync` passes 51 of 51.

The full unit suite runs 2,863 files and 55,677 tests: 55,454 pass, 219 skip, and one is an expected failure. Three unrelated tests fail under the suite's parallel load: `scripts/persistence-schema.spec.ts` and `packages/api/workspace-files/tests/changes.spec.ts` pass on rerun, while `packages/util/http-proxy/tests/install.spec.ts` still waits past its 5-second limit on an `origin.test` DNS lookup; that package's only change here is its version pin.

Targeted suites cover the changed client and LLM surfaces: 275 files and 4,392 tests across `ui-agent-preset`, `ui-conversation`, `ui-sidebar`, `ui-entry-customization`, `ui-primitives`, `ui-layout`, and `llm-deepseek`, plus 53 synapse tests. The legal and patent packages affected by the JSDoc completions add 112 files and 2,123 passing tests.

`pnpm run test:snapshot` replays 229 cases across the session, sdk, acp, and web lanes with 227 passing and 2 skipped. The six affected browser specs pass in replay against the refreshed goldens (13 tests). The browser flows changed by this release also pass end to end: entry customization (1), workspace shortcuts (4), workspace management (17), agent-preset selection (10), and blank preset reuse (3).
