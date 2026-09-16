# Agent Note: Extracting the fixture's RPC dispatch table (Issue #86)

Status: implemented

English | [中文](2026-09-14-fixture-rpc-dispatch-extraction.zh.md)

## Problem

`packages/client/connection`'s `src/client/fixture.ts` was 2483 lines, and its last coupled region was the `rpc` object: a `call` switch with sixty endpoint arms and an `open` switch with five, 211 lines in all. The table reads no world state directly — every stateful endpoint reaches its state through a remote cluster, a session or workspace API object, a stream opener, or a small helper — but those nineteen values were the world's locals, so the table could not leave while they stayed where they were.

[The split plan](../../implemented/simplification/2026-09-14-god-file-split-plan.md) named this as batch 2's remaining `fixture.ts` item and predicted the cost: the roughly twenty handlers need an interface first. This cut builds that interface and moves the table.

## Decision

`packages/client/connection`'s `src/client/fixture-rpc.ts` (318 lines) exports `createFixtureRpc(deps: FixtureRpcDeps): ClientConnectionRpc`; `fixture.ts` is 2288 lines.

| Moved | Form in the new module |
| --- | --- |
| The `rpc` object's `call` and `open` (2249–2459) | The `ClientConnectionRpc` the factory returns |
| `fixtureModelGroups`, `DEEPSEEK_REASONING`, `OPENAI_REASONING`, `ModelProviderGroup` | Module-level catalog served by `session/modelCatalog` and `llm/discoverModels` |

`FixtureRpcDeps` is declared in `fixture.ts`, not in the new module, and that placement is the cut's main boundary decision. Its members are typed with the entry's own declarations — `FixtureSessionApi`, `FixtureWorkspaceApi`, `FixtureControlFrame`, `WorkspaceFollowFrame`, `FixtureRemoteEventResult`, the three in-file remote clusters, and the five openers. Declaring it in the new module would have required exporting every one of those twelve types (and with them, their JSDoc obligations); declaring it where they live costs one export and keeps the dependency list next to the values it names.

The new module reaches the types it needs through `Parameters<FixtureRpcDeps[...]>` projections — `SessionApi`, `WorkspaceApi`, the goal ref, the follow request, and the remote-event result — so no further type movement was needed. Two type declarations, `FxGoalRef` and `FxGoalView`, moved from `createFixtureWorld`'s body to module level, where the dependency list can name them.

### What the arms keep

All sixty-five arms keep their endpoint names, their argument marshalling, and their inline payloads. Two edits are mechanical and confined to type references:

- `Parameters<FixtureSessionApi['list']>[0]` and its siblings became `Parameters<SessionApi['list']>[0]`, because the session API now arrives through the dependency list.
- The six `workspace/*` arms asserted `WorkspaceCreateRequest` and its siblings directly; they now assert `Parameters<WorkspaceApi['create']>[0]`, matching the session arms' existing form. The six request interfaces stay module-private in the entry, so this is the same narrowing written the way the parallel family already writes it.

`workspaceFileRemotes` left the entry's imports and is imported by the new module directly: it is a module-level value in `fixture-file-system.ts`, not a world local, so it needs no dependency slot.

### Tests become possible, so they were written

`fixture-rpc.ts` is not in the root `vitest.config.ts` GUI-debt exemption list — that entry names `fixture.ts` by exact path — so the per-file gate applies at once. Twenty-nine endpoint arms and two refusal paths had no test anywhere in the package: the five `agentPresets/*`, the three `subagents/*`, the three `llm/*`, `fileReferences/list`, `sessionReferenceResolver/candidates`, `directoryPicker/pick`, `settings/{canOpenAgentPresetDirectory,openSettingsDocument,openAgentPresetDirectory,mutate}`, `session/{openWorkspacePath,canOpenWorkspacePath,fork,attachment,updateQueue}`, `workspaceFiles/{read,stat,list,changes}`, `workspace/{insertBefore,archiveSession}`, and the `open` method's channel guard and unknown-endpoint refusal.

`tests/fixture-rpc.client.spec.ts` builds the dependency set directly and asserts what each arm does: which dependency it reaches and with what, which fixed payload it answers, and that both channel guards reject. Four coverage metrics are 100% with no exemption written. The file is now reachable as a unit, which is what the cut bought: before it, the only way to exercise an arm was to drive an entire fixture world through it.

### Verification

| Check | Result |
| --- | --- |
| `pnpm exec vitest run packages/client/connection` | 17 files / 216 passed (16 / 201 before, plus the 15 new cases) |
| coverage for `src/client/fixture-rpc.ts` | 100% statements / branches / functions / lines |
| `pnpm exec tsc -p packages/client/connection/tsconfig.json --noEmit` | exit 0 |
| `pnpm run typecheck` | exit 0 |
| `pnpm exec tsx scripts/run-oxlint.ts packages/client/connection/src packages/client/connection/tests` | 41 files, 0 warnings, 0 errors |
| `pnpm run verify-export-jsdoc` | every exported name documented |
| `pnpm run duplication` | 0 clones |
| `pnpm run test:docs` | 18/18 |
| `pnpm run doc-sync` | 33 passed / 3 failed — doc graphs, config catalog, and package paths, each reproduced unchanged on the `origin/master` baseline |

The entry's export list gained `FixtureRpcDeps` and `FixturePageRequest` and lost nothing; `FixtureWorld`, `createFixtureFaces`, `createFixtureConnectionRpc`, `FixtureOptions`, and `FixtureAssistantStreamFrame` are unchanged. Neither addition is re-exported from the package entry, so the published surface does not move.

## Alternatives considered

- **Declaring `FixtureRpcDeps` in `fixture-rpc.ts`.** Rejected: it would export twelve of the entry's internal types for one consumer, and each new export owes JSDoc the entry never needed while those types were module-private.
- **Moving the three in-file remote clusters (`commandRemotes`, `referenceRemotes`, `goalRemotes`) into their own module.** Rejected: all three read and write world state (`logOf`, `append`, `sessions`, `setGoalActivation`), so a module of their own would need a world-state accessor — the boundary the file-system cut rejected by name.
- **Extracting only the ten world-independent arms into a zero-parameter factory.** Rejected as the weaker cut: it removes sixty lines of literals and leaves the table split across two files, still coupled to the world for the other fifty-five arms. The plan's item is the whole table.
- **Rewriting the six `workspace/*` type assertions as exports of their request interfaces.** Rejected: the `Parameters<WorkspaceApi[...]>` form is already how the parallel session arms read their request types, and it keeps six more interfaces module-private.

## Consequences

`fixture.ts` loses 195 lines and `fixture-rpc.ts` is 318, so the net growth is the dependency list plus the module header. The two `TODO(gui)` coverage entries that named `fixture.ts` and `fixture-projections.ts` went with the family's later removal (below); this cut added none. Batch 2 is now empty — the plan moved its `typert/generator` item to batch 3 in the previous PR — and Issue #86 stays open for batch 3's remaining items.

The module family and its sibling fixture modules — `fixture.ts`, the extracted `fixture-*` modules, and their specs — were later replaced wholesale by upstream with `@deepseek-ai/dsh-remote-mock` and `apps/web/tests/assembled-remote.ts`.

## Related

- [Splitting the seven god files](../../implemented/simplification/2026-09-14-god-file-split-plan.md) (the plan; this closes batch 2)
- [Extracting the fixture's configuration remotes](2026-09-14-fixture-configuration-remotes-extraction.md) (the cut this one follows, and the source of three of the dependency slots)
- [Extracting the fixture's in-memory file system](2026-09-14-fixture-file-system-module-extraction.md) (the cluster that settled what a fixture cluster owns)
- `packages/client/connection`'s `src/client/fixture-rpc.ts` and `tests/fixture-rpc.client.spec.ts`
