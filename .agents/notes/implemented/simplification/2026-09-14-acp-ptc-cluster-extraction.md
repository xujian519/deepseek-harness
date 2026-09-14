# Agent Note: Extracting the ACP cursor codec and two PTC clusters (Issue #86)

Status: implemented

English | [中文](2026-09-14-acp-ptc-cluster-extraction.zh.md)

## Problem

Two entry modules carried module-level code that shares no symbol with the handlers beside it. `packages/acp/acp/src/index.ts` reached 543 lines and its `apply` 341, with the `session/list` keyset cursor — an opaque base64url token, its decode/encode pair, and the byte-stable ordering comparison — sitting in the same module scope as ACP handshake, admission, and teardown. `packages/core/tools/src/ptc.ts` reached 678 lines, where the `run_code` schema text per language (a flavor table keyed by runtime language plus the resolver that reads the mounted runtime) and the JSON presentation of a completion value both lived outside `createRunCodeTool`, next to code that never calls them.

[The split plan](../../proposed/simplification/2026-09-14-god-file-split-plan.md) lists both as batch-1 items, the batch whose cuts preserve behavior by construction: no instance state, no new interface, no behavior change, and the entry module re-exports what moved. This note records what those two cuts produced.

## Decision

Three modules hold what the entry modules used to inline, and both entry modules export the same names they exported before.

| Module | Lines | Owns |
| --- | --- | --- |
| `packages/acp/acp/src/session-list-cursor.ts` | 75 | `interface SessionListCursor` and the four pure functions over it: `decodeSessionListCursor`, `encodeSessionListCursor`, `isAfterSessionListCursor`, `compareSessionIds`. |
| `packages/core/tools/src/run-code-flavor.ts` | 110 | `interface RunCodeFlavor`, `TYPESCRIPT_FLAVOR`, the module-private `PYTHON_FLAVOR` and `RUN_CODE_FLAVORS`, `type CodeSdkLanguage`, and `resolveFlavor`. |
| `packages/core/tools/src/json-render.ts` | 103 | `JSON_INDENT`, `MAX_JSON_INDENT_CHARS`, the module-private `JsonRenderTask` and `renderJsonValue`, and the exported `renderValue`. |

`packages/acp/acp/src/index.ts` is 503 lines and `packages/core/tools/src/ptc.ts` is 492.

### What the ACP cut moved

The cursor symbols were module-private — `SessionListCursor` and all four functions carried no `export` — so the cut moved them without widening any surface: the package's public API (`name`, `inject`, `AcpConfig`, `Config`, `apply`) and the module's own export list are both unchanged. The `Buffer` import from `node:buffer` moved with them into the new module, which is the only one of the two that reads it.

`resolveSessionListPageSize` and `DEFAULT_SESSION_LIST_PAGE_SIZE` stayed: they validate the deployment-owned page limit from `Config`, which is configuration admission rather than cursor codec. The handler in `apply` imports the five symbols it still spends.

### What the PTC cut moved

The flavor cluster moved whole, so the language's `description` and `code` parameter description still share one source of truth and the `satisfies Record<CodeSdkLanguage, RunCodeFlavor>` check that keeps this table in step with `SDK_RENDERERS` moved with them. `resolveFlavor` gained the `@param`/`@returns`/`@throws` tags the exported-function JSDoc gate requires; its body is byte-identical to what `ptc.ts` held.

`CodeSdkLanguage` is the one moved symbol that carried an `export`. It is not package-public — `core/tools/src/index.ts` consumed it as `import type` and does not re-export it — so the entry's export list is unchanged and that single import now names `./run-code-flavor.ts`. The JSDoc on `SDK_RENDERERS` that pointed at `ptc.ts` for the flavor table's home was updated in the same edit.

Two clusters stayed deliberately. `RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION` describes the `description` parameter and is language-independent — the UI label contract is the same for every runtime — so it belongs beside the static spec, not with the flavor lookup. `jsonNormalizeArgs` snapshots a binding call's arguments as lossless JSON for dispatch and logging; it is argument admission, not presentation, and the JSON module would have no caller for it. `json-render.ts` exports only `renderValue`; `renderJsonValue` stays module-private, as the two are an entry and its non-string implementation.

### Verification

`pnpm exec tsc -p packages/core/tools/tsconfig.json --noEmit` is clean. `pnpm exec vitest run packages/core/tools` reports 12 files / 391 passed; `pnpm exec vitest run packages/acp/acp` reports 11 files / 140 passed. No test needed a new import path — the ACP suite reaches the plugin through `import * as AcpPlugin from '../src/index.ts'` and the tools suite never imported the cursor symbols or the flavor table directly. `pnpm exec tsx scripts/run-oxlint.ts packages/core/tools/src packages/acp/acp/src`, `pnpm run typecheck`, `pnpm exec tsx scripts/verify-export-jsdoc.ts`, `pnpm run verify-tool-catalog`, and `pnpm run test:docs` (18 gates) all pass.

The export lists were checked mechanically rather than by reading: `diff <(git show HEAD:<file> | grep -oE '^export.*' | sort) <(grep -oE '^export.*' <file> | sort)` is empty for both `packages/core/tools/src/index.ts` and `packages/acp/acp/src/index.ts`.

No `jscpd:ignore` block was touched. The moved regions contain no such marker, and `pnpm run duplication` reports 0 clones across 2196 files — moving cursor code and a flavor table did not create a cross-file clone pair against the sibling implementations the plan's first rule protects.

## Alternatives considered

- **One `ptc-helpers.ts` for both PTC clusters.** Rejected: the two share no symbol, so a single module would put a schema-text edit and an indentation-rendering edit in the same file — the coupling this cut exists to remove.
- **Folding the flavor table into the existing `ts-types.ts` / `py-types.ts`.** Rejected: the flavor table maps a language to schema text, while the SDK renderers map a language to type text, and `SDK_RENDERERS` in `index.ts` pins each table's key set with its own `satisfies`. Merging them would make one edit change both tables.
- **Moving the ACP cursor cluster into `session.ts`.** Rejected: `session.ts` owns one session's lifecycle, while the cursor encodes `session/list` pagination and is spent by the request handler, not by any session instance.
- **Exporting the cursor symbols as package API.** Rejected: `listSessions` is their only caller. Exporting them would turn an internal encoding into a compatibility promise for a transport whose cursor is deliberately opaque.
- **Leaving `renderValue` in `ptc.ts` and moving only `renderJsonValue`.** Rejected: the pair is an entry and its implementation, and separating them would leave `ptc.ts` importing a module for one delegating line.
- **Creating `src/types.ts` for the flavor vocabulary (plan rule 3).** Rejected: that rule covers *new shared vocabulary*. Nothing here is new — the symbols moved between existing modules — and their only consumer is the same package's entry.

## Consequences

`ptc.ts` is 186 lines shorter and `acp/acp/src/index.ts` is 40 lines shorter. The three new modules total 288 lines, so the net growth is module headers and the JSDoc the exported symbols now require; `resolveFlavor` and `renderValue` are the only two whose documentation is new rather than moved.

Batch 1's no-behavior-change rule held: no constant, default, or schema value moved, and the model-visible `run_code` description and parameter text are byte-identical. The package README source map for `core/tools` gained the two new rows in both languages, and the pair's consistency record was re-recorded.

## Related

- [Splitting the seven god files](../../proposed/simplification/2026-09-14-god-file-split-plan.md) (the plan; this is a batch-1 item)
- [Extracting the python runtime's cost and log-ledger modules](2026-09-14-code-runtime-python-cost-and-ledger.md) (the batch-1 pilot, whose note this one follows)
- `packages/core/tools/src/index.ts` (the `SDK_RENDERERS` table the flavor keys are checked against)
- `packages/acp/acp/src/session.ts` (the session record the `listSessions` handler reads)
