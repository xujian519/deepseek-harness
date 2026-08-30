# Agent Note: H6 sink — export the canonical aborted-before-dispatch result factory

Status: implemented

English | [中文](2026-08-30-aborted-before-dispatch-result-sink.zh.md)

## Problem

The ledger's H6 entry recorded two families of copied model-visible recovery text. Re-scanning before this change found the ledger half stale: the two drifted `TOOL_OUTCOME_UNKNOWN` wordings it cited no longer exist anywhere — `packages/core/session/src/repair.ts` holds the single definition of both recovery messages, and the session README pins them verbatim. What remained was the cancellation-result shape: `toolAbortedBeforeDispatchResult()` existed as the canonical factory in `@deepseek-ai/dsh-tools` but was private, so two consumers re-typed the literal shape — agent-loop's `appendSkippedToolCall` (the synthetic result appended for a model call skipped by cancellation) and session-checkpoint-policy's `tools/execute` abort arm, whose local wrapper even copied the factory's intent doc.

## Decision

Export `toolAbortedBeforeDispatchResult` from `@deepseek-ai/dsh-tools` and point both consumers at it; delete both hand-typed shapes. Neither call site has a `prior` result, so the appended and returned objects are byte-identical to what the deleted copies produced. `toolAbortedResult` (the body-already-invoked branch) stays private: no consumer re-types it, and exporting an unused API is worse than a private factory.

## Consequences

H6 is closed with a smaller mechanism than the ledger proposed: no shared recovery-vocabulary package was needed because the canonical home already existed and the recovery-text half had already collapsed to one definition. The pinned `ABORTED_BEFORE_DISPATCH` code assertions across tool packages now have exactly one producer. The ledger's shared-primitive list stands at four of five; ResolvedConfig (M2) remains.

## Alternatives considered

**Create the ledger's shared recovery-vocabulary module (error codes + verbatim copy + factories).** Rejected: it would house two owners' contracts in a new package when each already has one — the recovery texts live in `dsh-session` (their only definition) and the cancellation results in `dsh-tools` (their canonical producer). A new package would add an owner without removing a copy.

**Export both cancellation factories together for symmetry.** Rejected for `toolAbortedResult`: symmetry across the pair matters inside `dsh-tools`, where both are selected by the body-invoked check, but the export surface should follow consumers, and only the before-dispatch factory has any.
