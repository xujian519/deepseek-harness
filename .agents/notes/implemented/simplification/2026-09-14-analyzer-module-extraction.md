# Agent Note: Extracting the analyzer's node-text, export-map, and path modules (Issue #86)

Status: implemented

English | [中文](2026-09-14-analyzer-module-extraction.zh.md)

## Problem

`packages/typert/generator/src/analyzer.ts` reached 3235 lines. `WorkspaceAnalyzer` and `FaceAnalyzer` account for the first 2650; the remaining 584 are a tail of module-level helpers the classes call but that share no state with them — every one takes compiler nodes, strings, or paths and returns a string, a boolean, or a plain model value.

The tail is not homogeneous. It is three clusters with no edge between them: reading syntax nodes (declaration and member text, modifiers, JSDoc, literal models), reading `package.json` export maps, and resolving modules and filesystem paths. Each cluster was reachable only through the file that also held the analyzer, so changing how `package.json#exports` maps to source files meant finding that code below 2700 lines of extraction logic.

[The split plan](../../proposed/simplification/2026-09-14-god-file-split-plan.md) names this cut as batch 1's `analyzer` item and estimates three cuts of about 250 lines each. This note records what the cut produced.

## Decision

Three modules hold the clusters and a fourth holds the vocabulary they share. `src/analyzer.ts` is 2806 lines.

| Module | Lines | Owns |
| --- | --- | --- |
| `src/node-text.ts` | 397 | 25 syntax-node readings: `preferredDeclaration`, `declarationText`, `memberName`, `documentationOf`, `typertMode`, `visibilityOf`, `literalModel`, and their private helpers |
| `src/package-exports.ts` | 111 | 6 export-map readings: `isDualFacePackage`, `hostExportSubpaths`, `clientExportSubpaths`, `packageExportTargets`, `sourcePathForExport`, and the private `exportTarget` |
| `src/module-path.ts` | 201 | 13 module and path helpers: `moduleSpecifierOf`, `importBindingOf`, `moduleIdentity`, `formatDiagnostic`, `formatProgramDiagnostic`, `realPath`, `isWithin`, `slash`, and the rest |
| `src/types.ts` | 26 | `TypertAnalysisError`, `ModuleIdentity`, `ReferenceSite`, `EMPTY_DOCUMENTATION` |

Seven helpers stayed in the entry as the glue the new modules do not own: `mergeWorkspaceModels`, `parseConfig`, `projectConfigPath`, `sourceFileHasSurface`, `hasPackageSurface`, `uniqueBy`, and `compareCrossFaceLinks`. Each is called by the classes or by another staying helper and by nothing else, so they keep the entry as their only home.

### The cut is behavior-preserving by construction

Every moved range is byte-identical to the code that left the entry. No function body, constant, or default changed; the entry declares the same eight exports it declared before. Five comments moved with their statements and keep their exact form: four `/* v8 ignore ... */` annotations (`node-text.ts` 3, `module-path.ts` 1) and the three-line `//` comment recording that `isRemoteSegment` mirrors `isTypertRemoteSegment()` from `dsh-typert-protocol`, which travels with the function it describes.

### Why `TypertAnalysisError` left the entry

`node-text.ts` and `module-path.ts` both throw it. Keeping the class in `analyzer.ts` while the entry imports from those modules would have made the import graph cyclic. It moved to `src/types.ts`, where `packages/AGENTS.md` already places "the package's own error class" among the runtime values a package's seam vocabulary owns, and the change cites the Issue #99 exception the plan's third rule requires. `ModuleIdentity`, `ReferenceSite`, and `EMPTY_DOCUMENTATION` moved with it: the entry's classes and the moved helpers both use all three, so any other home would have created exactly the edge back into the entry that the error class was moved to avoid.

The entry keeps the public name through `export { TypertAnalysisError } from './types.ts'`, so `src/index.ts` needed no edit.

### The JSDoc the move had to add

`verify-export-jsdoc` scans every `packages/*/*/src/**/*.ts` file, not only entry modules. Thirty-eight of the forty-four moved symbols became exports of their new module and needed a documented `@param`/`@returns` block each; the six that stayed private — `classShape`, `normalizedDocText`, `firstSentence`, `rawJsDoc`, `exportTarget`, and the `realPathCache` constant — kept the comments they already had. That JSDoc is the bulk of the 253 lines the four new files carry beyond the 482 lines of moved code.

### One declaration-emit constraint

`importBindingOf` returns `ImportBinding`. Under `declaration: true` a named return type must be nameable from the emitted declaration file, so `ImportBinding` is exported from `module-path.ts` even though `importBindingOf` is its only user. `tsc --noEmit` does not report this class of error; declaration emit does, and this cut was verified with both.

### The plan's `jscpd` claim for this file was wrong

The plan's Problem paragraph lists `analyzer.ts` among the files containing a `/* jscpd:ignore-start */` block. It contains none. The package's only such block is in `src/cordis-catalog.ts`, where the markers are string literals bracketing emitted catalog text rather than a region of analyzer source. No `jscpd:ignore` block was touched, so the plan's first rule does not apply to this cut, and the plan's Problem paragraph is corrected in the same change.

## Verification

| Check | Result |
| --- | --- |
| `pnpm exec tsc -p packages/typert/generator/tsconfig.json --noEmit` | clean |
| `pnpm exec tsc -p packages/typert/generator/tsconfig.json --emitDeclarationOnly` | clean, which is what proves `ImportBinding` had to be exported |
| `pnpm exec vitest run packages/typert/generator` | 8 files / 201 passed — the count before the cut |
| `pnpm run typecheck` | passes, covering the cross-package consumers of the generator |
| `pnpm exec tsx scripts/run-oxlint.ts packages/typert/generator/src` | clean |
| `pnpm exec tsx scripts/verify-export-jsdoc.ts` | passes |
| `pnpm run duplication` | 0 clones across 2197 files |
| `pnpm run test:docs` | 18 passed / 0 failed |
| export-name comparison | identical 8 names on both sides |
| call-site check | every one of the 38 exported symbols has a caller in `analyzer.ts`; every private helper is referenced in its own module |

Batch 1's acceptance criteria hold: the entry exports the same names, no test needed a new import path, and no constant, default, or schema value moved.

The per-file coverage gate does not apply here: `packages/typert/*/src/**/*.{ts,tsx}` sits in `vitest.config.ts`'s coverage exclude list, whose comment records that typert correctness is checked by its uninstrumented suites. Coverage is therefore not part of this cut's evidence.

## Alternatives considered

- **Leaving `TypertAnalysisError` in the entry and importing it into the two new modules.** Rejected: the entry imports from both, so this is the cycle the split exists to avoid. It would also have kept the class 2600 lines from the code that throws it.
- **A fourth cluster module (`syntax-types.ts`) instead of `src/types.ts`.** Rejected: `ModuleIdentity`, `ReferenceSite`, and `EMPTY_DOCUMENTATION` are used by the entry's classes as much as by the moved helpers, so a cluster module holding them would be an entry-adjacent module named after one cluster. `packages/AGENTS.md` already gives the vocabulary its home.
- **Re-exporting the moved helpers from `src/index.ts`.** Rejected: none of them was exported before, so re-exporting would widen the published surface. `src/index.ts` is untouched.
- **Splitting the entry's classes in the same cut.** Rejected: the plan puts the `Remote`/RPC analyzer and type modeler in batch 2, gated on showing that a cut does not perturb `nodeOrdinals` id stability. Cutting them here would have made that proof a condition of this move.
- **Interleaving the helpers into two modules (`syntax.ts`, `paths.ts`) rather than three.** Rejected: the three clusters have no edge between them, and `package-exports.ts` needs no shared vocabulary at all — merging it with either neighbour would have created an import that does not exist today.

## Consequences

`analyzer.ts` is 429 lines shorter and holds only the analyzer and its glue. The cost is the accounting: 482 lines moved, 735 lines in the four new files, 56 lines of import wiring in the entry — the 253-line growth is module headers, imports, and the JSDoc `verify-export-jsdoc` requires of the 38 new exports. Nothing was deleted or rewritten; the growth is entirely scaffolding the split introduced.

The move also surfaced that `packageExportSpecifier` and `firstSentence` already had independent copies in `emitter.ts` and `cordis-catalog.ts`. The move preserves that count rather than adding to it: the analyzer's copies now live in `node-text.ts`, one each, as before. Deduplicating them is not this cut's work — `emitter.ts` and `cordis-catalog.ts` are different consumers with no shared module today.

## Related

- [Splitting the seven god files](../../proposed/simplification/2026-09-14-god-file-split-plan.md) (the plan; this is its batch-1 `analyzer` item)
- [Extracting the python runtime's cost and log-ledger modules](2026-09-14-code-runtime-python-cost-and-ledger.md) (the batch-1 pilot)
- [Closing out the hardcoded-tunable audit](2026-09-14-hardcoded-tunable-closeout.md) (Issue #88; batch-1 change rule: no constant or default moves)
- `packages/AGENTS.md` (where a package's seam vocabulary lives)
