# Agent Note: gating group README package tables against their directories

Status: implemented

English | [中文](2026-09-12-group-readme-package-gate.zh.md)

## Problem

Ten group READMEs listed 16 fewer packages than their directories hold, in both languages: `client/` was missing seven (`synapse`, `ui-dockkit`, `ui-document-studio`, `ui-patent-teams`, `ui-plugin-market`, `ui-sidebar-documentpreview`, `ui-sidebar-right`) and `util/` two (`contained-emit`, `value`), while `api/`, `bundle/`, `core/`, `host/`, `session/`, `test-support/`, and `web/` were missing one each. Every one of the 16 already had its own package README, so these were omissions rather than packages still waiting for a page.

The [root group map](../../../../packages/README.md) had been completed and gated by an earlier pass, but the per-group tables under `packages/<group>/README.md` had no gate: `hygiene`'s leaves check manifests, dependencies, and entry points, and `doc-sync` checks README Summaries, model-experience sections, and bilingual pairing. A package could therefore be added, published, and documented on its own page while never appearing in the table a reader browses to learn what the group contains.

## Decision

- **`verify-group-readme-packages` is the owner.** It compares each group's `## Packages` (or `## 包`) section against the directories under `packages/<group>/` that hold a `package.json`, and reports one diagnostic per package the section does not list. It runs inside `doc-sync` as a quick leaf, so `pnpm run test:docs` and the fork CI documentation job execute it.
- **A row counts when it links the package's README.** The check reads link targets in the Packages section and takes the directory the target names, so a row's link text, column count, and family order stay the author's choice. A `../` target points into another group and is ignored: that group's README owns the row, which is how `client/` links `../test-support/client-runtime/` and `fs/` links `../e2b/fs-e2b/`.
- **Both languages are checked in one gate.** The English and Chinese tables are separate files, and the pairing gate cannot enforce agreement between them: it compares each side against the pair's recorded state, so an English-only row can be recorded and leave the Chinese table short. Checking both files here closes that path.
- **An empty or narrowed scan fails.** A missing `## Packages` heading, a group with no packages, and finding no group READMEs at all are diagnostics, not silent passes.
- **The 16 rows are backfilled beside their semantic siblings** — the right-Sidebar cluster in `client/`, the Persistence family in `session/`, `value` next to `values` — rather than appended blindly. `host/`'s "All eight packages" and "Eight packages play the host roles" and `web/`'s "Six packages play the web roles" became nine and seven with their Chinese counterparts.

## Alternatives considered

- **Check only the English README and let `verify-translation-pairing` cover the Chinese side.** Rejected: the pairing gate validates each side against the pair's last recorded state, so adding an English row and re-recording accepts a Chinese table that omits it — exactly the drift this gate exists to stop.
- **Generate the tables from the directory listing.** Rejected: each row carries a hand-written Role and, in most groups, the `ctx` key the package provides; the tables are also ordered by theme rather than alphabetically, so a generator either loses the prose or rewrites all 56 tables to satisfy itself.
- **Extend the existing package-README gates instead of adding a leaf.** Rejected: `verify-package-readme-summaries` and `verify-package-readme-model-experience` validate one README's own sections and never read the group directory, so folding a cross-file inventory rule into them would make each gate's diagnostic name lie about what it checked.
- **Let `verify-md-links` carry it.** Rejected: link resolution only proves that rows which exist point somewhere real; it never notices an absent row.

## Consequences

The group tables cannot fall behind their directories again, in either language, and the failure names the package and file to fix. The cost is that a package move or rename now has one more place to update in the same change, and that the gate is stricter than the tables it guards were: it reads the Packages section only, so a package listed in a later section — or only in prose — is still a violation.

## Testing

`scripts/verify-group-readme-packages.spec.ts` covers the accepted table, each omitted package, rows spread across family tables, a satisfying row outside the Packages section, a `../` cross-group target, the Chinese heading with `.zh.md` targets, and the missing-section case. `scripts/run-gates.spec.ts` asserts the leaf stays in `doc-sync`. The repository passes with 112 group READMEs checked (56 groups × 2 languages); `pnpm run test:docs` and `pnpm run verify-translation-pairing` were re-run after the table edits.

## Related

- [tech-debt tracking in same-repository Issues](2026-09-11-tech-debt-issue-tracking.md) — the 2026-09-11 scan that produced this finding, which Issue #90 records.
- [Root package map](../../../../packages/README.md) — the gated group table these per-group tables sit under.
