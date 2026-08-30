# Agent Note: M2 sink — one `assertResolvedConfig` for the plugin-config boundary

Status: implemented

English | [中文](2026-08-30-assert-resolved-config-sink.zh.md)

## Problem

Schemastery applies every schema default before a plugin sees its config, but the type system cannot encode that fact: the schema output type is unconditional while the hand-written `Config` interface is all optional, so thirteen source files restated a local `ResolvedConfig` alias and cast (`config as ResolvedConfig` / `as Required<Config>` / `config.thresholds as number[]`), each annotated with one of two fixed comments asserting that schemastery had already filled the fields. The ledger's worry was concrete: any future call site that bypassed the schema would silently read `undefined`. Re-scanning also found the ledger stale — its `code-mode.ts` file had been folded into `ptc.ts`, `lsp-stdio` and the e2b pair had dropped their casts, and the `as Required<Config>` family had grown past the listed set.

## Decision

`@deepseek-ai/dsh-value` gains `assertResolvedConfig(label, config, defaultlessKeys)` plus the `ResolvedConfig<C, K>` type: it throws at load, naming the field, when a default-backed key is `undefined`, and returns the same object typed with only the declared defaultless keys optional. Thirteen files now call it; the local aliases either shrink to derive from it (`type ResolvedConfig = ResolvedShape<Config>`), survive as structural restatements checked by assignment (the shell executors' constructor fields and settings callbacks), or disappear where only the cast used them. The old two comment styles are gone with the casts.

## Consequences

M2's cast family is closed and the shared-primitive list is complete at five of five. The check covers explicit `undefined` values, not key presence, so the helper's contract states that a hand-built config must still go through its schema. Three sub-items the ledger filed under M2 are deliberately open and separately owned: the `default(undefined as unknown as T)` schema idiom (expresses schemastery's "do not materialize omission" behavior; needs a vendor-level primitive), agent-loop's whole-schema `as z<Config>` (a schema-to-interface alignment check bypass, not a boundary cast), and the weak `ToolDefinition.parameters` slot (`ptc.ts:679`, `schema.ts:572`; a public-type change).

## Alternatives considered

**Type the schemastery `.default()` chain so the resolved shape is inferred and drop the `z<Config>` annotations.** Rejected: the annotation is what keeps the hand-written `Config` interface and the schema aligned at compile time; removing it reopens the drift the cast family papered over, and narrowing `.default()`'s output type is a vendored-schemastery change with a re-apply obligation on every sync.

**Share only a `ResolvedConfig<Config>` type alias without the runtime check.** Rejected: the alias restatement was cosmetic; the actual hazard was the unchecked cast, and a type-only helper would have kept every one of those casts alive.
