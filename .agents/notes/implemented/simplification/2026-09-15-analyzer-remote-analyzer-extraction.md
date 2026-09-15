# Agent Note: Extracting the analyzer's Remote/RPC analyzer (Issue #86)

Status: implemented

English | [中文](2026-09-15-analyzer-remote-analyzer-extraction.zh.md)

## Problem

`packages/typert/generator/src/analyzer.ts` was 2206 lines and still held two clusters. The type modeler had moved to `src/type-graph.ts`; what remained was the Remote/RPC analyzer — the decorator and gateway readings that decide an invocation, the type-meta maps a lookup or Context argument comes from, the strict JSON boundary every wire field projects to, and the invocation models the emitter consumes — interleaved with the package walk that calls it. All 22 of its members were private, so nothing outside the file named the cluster, and a reader who wanted the RPC contract had to find it between `collectExplicitServices` and `collectEvents`.

[The split plan](../../implemented/simplification/2026-09-14-god-file-split-plan.md) named this slice and predicted its shape: with the graph owning that state, only three of its call sites leave the file. Measured before the move, those three are the cluster's writes into the state the graph owns — `allocateNodeId`, `setNode`, and `setDeclaration`. Every other dependency of the cluster is a read.

## Decision

`packages/typert/generator/src/remote-analyzer.ts` (1025 lines) exports `class RemoteAnalyzer`, `RemoteAnalyzerDeps`, and `validateInvocationIdentity`; `analyzer.ts` is 1253 lines.

| Moved | Form in the new module |
| --- | --- |
| `collectInvocations`, `invocationModel` | `RemoteAnalyzer` methods; `collectInvocations` is the one public entry |
| `remoteMarker`, `remoteResultType`, `isGlobalAbortSignal` | `RemoteAnalyzer` methods, moved verbatim |
| `gatewayBinding`, `gatewayFieldBinding`, `gatewayServiceBinding`, `gatewayBindingArguments` | `RemoteAnalyzer` methods behind `GatewayBinding`, which moved with them |
| `lookupDeclarations`, `contextDeclarations`, `typeMetaMapMembers` | `RemoteAnalyzer` methods, with the `staticLookups` and `staticContexts` memos they fill |
| `remoteBoundary`, `resolvedRemoteCodecType`, `assertRemoteJsonType`, `includesRemoteAbsence`, `isRemotePhantomConstraint`, `resolvedCycleReference` | `RemoteAnalyzer` methods, moved verbatim |
| `namedWorkspaceType`, `publicRemoteType`, `isWorkspaceClass` | `RemoteAnalyzer` methods; `PUBLIC_REMOTE_TYPE_ROOTS` moved with them |
| `validateInvocationIdentity` | an exported function taking the face and the analyzed packages |

### The dependency list is the seam

`RemoteAnalyzerDeps` carries five values: the checker, the face program whose type-meta declarations list the lookup and Context keys, the `TypeGraph`, `registrationForFile`, and the program's parsed source files. The cluster's ten calls into the analyzer's graph delegations — `fail`, `location`, `resolveSymbol`, `symbolAtType`, `symbolId`, `isTypeMetaSymbol`, `convertType`, `addNode`, `requiredType`, and `allocateNodeId` — became direct `this.graph.<method>` calls instead of a second set of same-named delegations: those delegations exist for the analyzer's own call sites, and a new consumer naming whose operation it calls costs one prefix per site.

Three calls stopped leaving the analyzer at all. `allocateNodeId`, `isTypeMetaSymbol`, and `requiredType` had no reader outside the cluster, so their delegations are gone, and eight imports went with them.

### What the cut made testable

The cross-package identity check was reachable only by analyzing a whole fixture workspace: `tests/remote-model.spec.ts` proves the conflict by rewriting a fixture and running an analysis with a 60-second timeout. As a function of the face and the analyzed packages it is called directly, and `tests/remote-invocation-identity.spec.ts` builds both packages by hand — four cases in 2 milliseconds, including which of the two identities the message names first when both repeat.

The id-stability test guards the move. `tests/node-id-stability.spec.ts` pins the shared-start ordinals including the seven Remote codec rows, and `tests/__snapshots__/type-model.spec.ts.snap` compares byte-for-byte, so a reordered visit fails rather than arriving as a snapshot diff.

### Verification

| Check | Result |
| --- | --- |
| moved body | byte-identical to the original region after ten rename rules and one visibility change |
| `pnpm exec vitest run packages/typert/generator` | 10 files / 207 passed, every snapshot matched |
| `pnpm exec tsc -p packages/typert/generator/tsconfig.json --noEmit` | exit 0 |
| `pnpm exec tsx scripts/run-oxlint.ts packages/typert/generator` | 0 warnings, 0 errors |
| `pnpm run duplication` | 0 clones over 2229 files |
| coverage | not gated: `packages/typert/*/src/**` is an existing exemption |

## Alternatives considered

- **Split the boundary and codec half into a second module.** Rejected: `isWorkspaceClass` is read by the invocation half and `remoteBoundary` by four sites in it, so the split would add exports to shorten two files that are each already below the package's own largest module.
- **Keep the graph delegations in the new class.** Rejected: eleven private one-liners whose only purpose is keeping moved text unchanged, when naming the owner is the same edit.
- **Leave `validateInvocationIdentity` private and test through the analyzer.** Rejected: that is the 60-second path the extraction removes, and the check needs no program.
- **Move `PUBLIC_REMOTE_TYPE_ROOTS` to `src/types.ts`.** Rejected: one function reads it, and it is not vocabulary two modules share.

## Consequences

`analyzer.ts` loses 953 lines and holds the package walk, the export graph, service and event collection, explicit-service collection, and discovery; `remote-analyzer.ts` holds every reading that turns a decorated method into an RPC endpoint. Batch 3's list is complete: its five bullets have all landed, so the plan note's own acceptance criterion — that it moves to `implemented/` — is now due.

## Related

- [Splitting the seven god files](../../implemented/simplification/2026-09-14-god-file-split-plan.md) (the plan; this is batch 3's eighth landed cut)
- [Extracting the analyzer's type graph](2026-09-15-analyzer-type-graph-extraction.md) (the cut that left this one measured at three call sites)
- [Pinning the analyzer's node ids](../testing/2026-09-15-node-id-stability.md) (the guard for every analyzer move)
- `packages/typert/generator/src/remote-analyzer.ts`, `packages/typert/generator/tests/remote-invocation-identity.spec.ts`
