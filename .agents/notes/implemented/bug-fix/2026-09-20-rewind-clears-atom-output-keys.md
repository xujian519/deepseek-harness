# Agent Note: Clear every output key a rewound stage wrote

Status: implemented

English | [中文](2026-09-20-rewind-clears-atom-output-keys.zh.md)

## Problem

Both rewind paths deleted the stage-id key and nothing else:

- `runWorkflow` in `patent-workflow/src/workflow.ts` looped over `manifest.stages.slice(rewindIndex)` and deleted each `stage.id`;
- `makeRetryRouter` in `patent-core/src/graph/adapter.ts` deleted each id in `stages.slice(rewindIndex, currentIndex + 1)`.

An atom writes more than its stage-id key. `extract` declares `outputSchema: ['extraction_result', 'features', 'problems', 'effects']` and writes all four into state; `search` writes `prior_art` alongside its summary. The executors read only `outputSchema[0]` as the stage's main output key, so the remaining keys are never the executor's business — they are state that later stages and atoms read by name. Nothing deleted them on a rewind.

The failure is a rerun whose parse fails. `extract` keeps the raw model text instead of JSON when parsing fails and writes only `extraction_result`, so a rerun leaves the *previous* generation's `features` array in state. The downstream merge then reads one generation of features beside a fresh generation of problems, and reports nothing: the state looks fully populated, and no consumer can tell that one of its inputs is from the run that was rewound away.

`Reflect.deleteProperty` appeared at exactly those two sites in the tree, which is what made the gap visible: two independent copies of one rewind semantic, both incomplete in the same way.

Neither rewind test covered key cleanup. The declarative path's case asserted only that the final output was the new one, and the graph path had no cleanup case at all, so the stale keys were invisible to the suite.

## Decision

`clearStageOutputs` in `packages/patent/patent-core/src/workflow/stage-outputs.ts` owns the deletion: for each stage in the passed range it deletes the stage-id key and then every key in `atoms.lookup(stage.atom)?.outputSchema ?? []`. Both paths call it.

It lives in `patent-core` because that is the package both callers already depend on: `patent-workflow` and `patent-tools` peer-depend on `patent-core`, and `patent-core` depends on neither. The primitive is shared rewind semantics, and the two implementations had already drifted into being two copies of it.

The range stays the caller's decision. `runWorkflow` passes everything from the rewind point onward; the graph router passes the rewound slice including the current stage. The primitive takes the stages it is given and does not recompute the boundary — the two paths derive it from different structures, and a primitive that recomputed it would have to know both.

`makeRetryRouter` now carries `atoms: AtomRegistry` so it can reach the registry, threaded from `manifestToGraph`'s `deps`.

A stage with no atom, or whose atom is not registered, has only its stage-id key deleted. An unregistered atom is already rejected at graph construction, and a stage with no atom has no declared output keys to clear; neither is an error at cleanup time.

`clearStageOutputs` is exported from `@deepseek-ai/dsh-patent-core` so `patent-workflow` can call it.

## Alternatives considered

**Port Sati's `stage-primitives.ts` whole.** Rejected: its other two exports already exist here inline — `executor.ts`'s main-output-key resolution and `isApprovalGateHandler` — and importing a module to use one of three functions, two of which duplicate live code, adds a second home for behaviour that already has one.

**Fix each path in place.** Rejected: that is the arrangement that produced the bug. Two copies of one semantic drifted into the same omission, and a third rewind path would have no reason to get it right.

**Have the rewind clear the whole state and replay from the start.** Rejected: `runWorkflow`'s rewind is a rerun from `rewindTo`, not a restart, and the stages before the rewind point are not re-executed — their outputs must survive.

**Derive the output keys from the stage's atom at the call site and pass the key list.** Rejected: the caller would then need the registry and the atom for each stage, which is the lookup the primitive already does. Passing stages keeps the arguments to what the caller holds.

## Consequences

A rewound rerun starts with no key from the rewound stages, whether or not the rerun writes them all. A rerun whose parse fails leaves the affected keys absent rather than stale, so a downstream consumer that needs them sees a missing input instead of an old one.

Clearing per name is safe when the range boundary splits stages that share an atom, because the caller reruns every stage in the range: the state map holds one entry per key, and its value comes from the last writer — the in-range stage — so the clear removes nothing the rerun does not write back.

`Reflect.deleteProperty` now appears once, inside the primitive. A third rewind path has a single function to call.

The graph router's signature changed; its only construction site is `manifestToGraph`.

## Testing

`packages/patent/patent-core/tests/workflow/stage-outputs.spec.ts` — a stage-id key plus all three `outputSchema` keys are deleted; a stage with no atom loses only its stage-id key and stages outside the passed range are untouched; an unregistered atom deletes the stage-id key without throwing.

`packages/patent/patent-core/tests/graph/adapter.spec.ts` — two extraction stages write `features` and `problems`; the second round's feature branch returns non-JSON, so `features` is never written back. The test asserts `state.features` is `undefined` and `state.problems` holds the new generation, which is the mixed-generation state the fix prevents.

`packages/patent/patent-workflow/tests/workflow-retry.spec.ts` — the rewind case runs a probe atom declaring `out_primary` and `out_extra`, and records what the rerun reads at `out_extra`. Asserting the rerun saw `undefined` on both rounds is the check that the non-stage-id key was cleared, which the previous assertion on the final output could not make.

## Related

- [Sati patent domain as dsh plugins](../feature/2026-08-17-sati-patent-domain-dsh-plugins.md) — the port this package belongs to.
