# Agent Note: Two dead exports removed and documentation references scanned in `.tsx`

Status: implemented

English | [中文](2026-09-13-dead-exports-and-doc-reference-coverage.zh.md)

## Problem

Ledger item L2 recorded three dead exports fixed in the 2026-08-28 sweep, and issue #93 found the same class still open. `SessionTitleLlmConfigSchema` ([session-title-llm](../../../../packages/session/session-title-llm/src/index.ts)) wrapped `SessionTitleLlmConfigFields` in `z.object` and had no reference anywhere; both sibling title providers compose their own object from the shared fields map, so the wrapper is a leftover of the extraction that produced that map. `SESSION_QUERY_SQLITE_PATH_KEY` ([session-query-sqlite](../../../../packages/session-query/session-query-sqlite/src/index.ts)) named a boot-context slot whose Context merge key had no reader: the `dsh-v0.1.0-rc.7` upstream cleanup removed the TUI and legacy entrypoints that held the only provider (`hostCtx.provide(SESSION_QUERY_SQLITE_PATH_KEY, queryIndexPath)`) and the only consumer (`path: !!js launcherSessionQueryPath ?? './.sessions/session-query.db'`). The catalog exemption for that key deferred its documentation to a package README that never described it.

Three citations named paths that do not exist. `chunks/editor.tsx` and `chunks/terminal.tsx` cited `docs/plans/2026-08-12-lazy-chunks-design.md`, and those two comments were the only references to a `docs/plans/` directory this repository does not contain. `tests/plugin-shape.spec.ts` cited `packages/ui/jsonrpc`, which the `dsh-v0.1.0-rc.7` upstream package-layout refactor renamed to `packages/sdk/server`.

`verify-doc-refs` could not report the two `.tsx` citations: its `PATTERNS` covered `packages/**/*.ts` only, so the `.tsx` half of the same authoring surface went unchecked. Its token pattern also matched a doc-shaped component of any longer path, so adding the extension alone would have reported two fixture paths that name no repository file.

## Decision

- **Delete both exports and the Context key they mirrored.** The typed Context field is what a launcher installs, and nothing in the tree provided or read this one. `SERVICE_WALK_EXEMPTIONS` loses its entry, which the generator requires: it rejects an exemption whose key no Context merge declares.
- **Point the two chunk comments at the design's home inside the package.** `chunk-loader.ts` and `tsdown.config.ts` hold the chunk registry and the `chunkBundle` build, and the package README's source map names both.
- **Cite the post-mortem that justifies the plugin-shape guard** in place of a package path no gate resolves. [Post-mortem 0001](../../../../docs/postmortem/0001-acp-default-export-drops-inject.md) records why a stray default export makes the Loader discard `inject`.
- **Extend the corpus to `packages/**/*.tsx` and define a citation as a token that opens a reference**: `docs/…` or `.agents/notes/…` at a token start, or the tail of a `./`/`../` chain that resolves against the repository root. A token continuing a longer named path stays out of scope, which keeps a fixture's virtual `/ws/docs/README.md` out of the report. `apps/` remains outside the corpus: its only doc-shaped tokens are fixture paths inside a synthetic tool-call gallery.
- **Add no dead-export gate.** [Remove Knip from repository gates](../process/2026-08-19-remove-knip.md) owns the decision that the repository carries no repo-wide static check for unused exports, and that a future check must understand manifest-driven Cordis loading, generated outputs, and the Host/Client split.

## Alternatives considered

- **Keep the Context key as a launcher extension point.** Rejected: nothing reads the value it carries, so the slot cannot be a functional contract, and its catalog exemption claimed a README ownership that does not exist.
- **Repoint `packages/ui/jsonrpc` to its successor `packages/sdk/server`.** Rejected: a bare package path in a comment is what drifts, and the post-mortem states the same reason while `verify-doc-refs` resolves it.
- **Document the launcher slot in the package README instead of deleting it.** Rejected: the slot has no reader, so its documentation would promise behavior the package does not implement.
- **Extend the corpus to `apps/**` in the same change.** Rejected: `apps/web/tests/clickable-links-gallery.e2e.ts` passes `docs/press.md` and `docs/guide.md` as fixture tool arguments, and separating fixture paths from citations needs a rule of its own.
- **Add a narrow dead-export check over `packages/*/*/src` references.** Rejected: it would report exports consumed by generated code, manifests, and out-of-tree plugins, which is the exception inventory the Knip removal gave up.

## Consequences

The repository carries two fewer public exports and one fewer declared Context key, and `session-query-sqlite` loses a launcher slot no in-tree code provided or read. `verify-doc-refs` covers 4049 files instead of 3577, so the `.tsx` half of the client packages is inside the gate. What counts as a citation is documented on the pattern in the gate and pinned by `scripts/verify-doc-refs.spec.ts`. `apps/` keeps its unchecked citations, recorded here rather than in the gate.

## Testing

`scripts/verify-doc-refs.spec.ts` covers six acceptance paths: the corpus includes `.tsx` and still excludes `vendor/`, `.d.ts`, and built `lib/` output; a missing target is reported; a `../`-chain citation resolves against the root and is still reported once its note is gone; a named path component is skipped; and a token opening with `/` is still checked. Run against the repository before the three citations were fixed, the gate reported exactly the two `.tsx` lines and no fixture path. The `session-title-llm` and `session-query-sqlite` suites pass (88 tests), `pnpm run typecheck` passes, and lint reports 0 warnings and 0 errors over 4490 files. `pnpm run verify-cordis-catalog` reports 105 generated files and regions up to date, and the ten lines removed from `session-query-sqlite` shift that package's `Source:` pointer in `docs/config-catalog.md` from 93 to 83, which the regenerated catalog and its Chinese twin both carry.

## Related

[Remove Knip from repository gates](../process/2026-08-19-remove-knip.md) owns the decision that no repo-wide unused-code check exists.
