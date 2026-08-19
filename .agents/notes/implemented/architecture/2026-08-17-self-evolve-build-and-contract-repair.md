# Agent Note: self-evolve build and contract repair

Status: implemented

English | [中文](2026-08-17-self-evolve-build-and-contract-repair.zh.md)

## Problem

The self-evolve capability packages (`@deepseek-ai/dsh-self-evolve`, `@deepseek-ai/dsh-self-evolve-basic`, and `@deepseek-ai/dsh-tool-self-evolve`) had drifted far enough from current harness conventions that they no longer compiled, tested, or bundled. `pnpm run build` and `pnpm run test` failed for the whole subtree.

Specific failures included:

- `dsh-brand` now brands with a string-literal tag, but `self-evolve/src/brand.ts` still declared `Branded<unique symbol, ...>` and had no opaque-id factories for the package's own ids.
- `dsh-invariants` exposes a `(ctx, fail)` dispatcher API, while `self-evolve/src/invariant.ts` called an older `(label, ctx, check)` shape, so every invariant rule was a type error.
- `self-evolve-basic/src/index.ts` imported ids directly as strings, passed an invalid schemastery shape for `Config`, accessed `ProjectionSnapshot.values` with the wrong field name, narrowed the `EvolveProposal` union incorrectly, and passed the wrong validation object downstream.
- `self-evolve-basic/tsconfig.json` and `tool-self-evolve/tsconfig.json` referenced moved packages (`core/agent-loop-testkit` and `scope/scope`).
- None of the three packages had a `tsdown.config.mjs`, so the build produced no bundle even if compilation had succeeded.
- Two of the three packages lacked `README.md`, and the existing `dsh-self-evolve` README used a deprecated Model Experience heading.
- Several exported symbols (`SelfEvolveEngine` methods, `foldEvent`, config types) lacked required JSDoc.

## Decision

Repair the three packages to current harness conventions in a single scoped change.

- `packages/self-evolve/self-evolve/src/brand.ts` now brands with a string-literal tag and exports `SelfEvolveRunId`, `FailurePatternId`, and `EvolveProposalId` factories so callers construct opaque ids instead of casting raw strings.
- `packages/self-evolve/self-evolve/src/invariant.ts` is rewritten against the current `dsh-invariants` `(ctx, fail)` API. It validates `self-evolve/*` event brackets through an internal dispatch check plus a session/event check.
- `packages/self-evolve/self-evolve-basic/src/index.ts` imports branded id factories, fixes `resolveConfig` typing, uses the real schemastery object/dict/union API, reads `ProjectionSnapshot.values` correctly, narrows `EvolveProposal` by its `kind` discriminant, forwards the right validation object, removes a non-existent `rank` field, and wraps `requireSession` with `SessionId(sessionId)`.
- `packages/self-evolve/self-evolve/src/index.ts` keeps the `EvolveProposal` type export and removes the unused import that caused a lint error.
- `packages/self-evolve/self-evolve/src/failure-projection.ts` makes `foldEvent` synchronous by replacing the async WebCrypto SHA-1 path with `node:crypto` `createHash('sha1')`; the projection definition's `apply` now actually folds events instead of returning the state unchanged.
- `tsconfig.json` references in `self-evolve-basic` and `tool-self-evolve` now point to `test-support/agent-loop-testkit` and `core/scope`.
- Each package adds a `tsdown.config.mjs` that bundles `lib/types/{index,invariant}.js` into `lib/`.
- Each package adds or updates `README.md` to satisfy `verify-package-readme-model-experience`: `dsh-self-evolve` uses sentence-form Model Experience because it is a shared capability library; the leaf packages (`dsh-self-evolve-basic` and `dsh-tool-self-evolve`) use the full Model Experience section.
- JSDoc is added for exported `SelfEvolveEngine` methods, `foldEvent`, `BasicSelfEvolveConfig`, `TriggerPolicy`, and `BasicSelfEvolveEngine.config`.

## Alternatives considered

**Delete the self-evolve packages.** Rejected. Self-evolving plugins are a deliberate harness capability; removing them would discard the service definition, the basic provider, and the `tool-self-evolve` consumer that other packages reference as an example.

**Exclude the packages from the workspace build and test graph.** Rejected. Broken packages rot silently and still break any aggregate command that walks `packages/**`; an in-tree capability must compile, test, and bundle.

**Fix compilation only and skip README, tsdown, and JSDoc.** Rejected. The change would still fail `hygiene`, `doc-sync`, and published-package checks; a partial repair leaves the packages unreleasable.

## Consequences

- `pnpm exec tsc -b packages/self-evolve/self-evolve packages/self-evolve/self-evolve-basic packages/self-evolve/tool-self-evolve --force` passes.
- `pnpm exec vitest run packages/self-evolve/` passes.
- `pnpm exec tsdown --config tsdown.config.mjs` succeeds in each of the three packages.
- `pnpm exec tsx scripts/verify-package-readme-model-experience.ts` reports no violations for the touched packages.
- The broader `pnpm run build:lib:host` still fails because of unrelated type errors in uncommitted `packages/patent/` files; that failure is outside this scope.
- `pnpm run verify-agent-note-format` and corpus-wide `pnpm run verify-translation-pairing` are also red because of unrelated uncommitted patent-package Agent Notes and README pairs; the self-evolve pairs pass when checked individually.
