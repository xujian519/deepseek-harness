# Agent Note: declared type dependencies, branded bridge ids, and the published agent version

Status: implemented

English | [中文](2026-09-12-cross-boundary-declarations.zh.md)

## Problem

Three 2026-09-11 findings share one cause: a fact that crosses a package boundary was recorded in only one of the places that must agree.

- `session-persistence-jsonl` imported the runtime guards `isEEXIST`/`isENOENT` from `@deepseek-ai/dsh-value` without declaring it (Issue #82). That declaration landed with the value-sink batch (#110); what remained were the type-only imports, and the ones whose types surface in a published `.d.ts` are real breakage: a consumer compiling the declarations of `patent-tools`, `mcp-client`, `api-settings-controller`, and `tool-fs-search` (`JsonValue`), `token-meter` (`ImageAttachmentRef`), or `host-synapse` (`ContentBlock`) cannot resolve a package the manifest never installs.
- `patent-teams` event payloads, the desktop bridge payloads, and `ui-chat`'s `ToolCallId` carried opaque ids as bare strings (Issue #83), so a team id was readable where a task id was expected, and the client re-declared an identity the host already owns.
- The ACP handshake advertised `agentInfo.version: '0.0.1'` while the package publishes `0.1.5-rc.2` (Issue #84), so a client cannot tell which build it is talking to.

## Decision

Each fact is now stated where it crosses.

- **Declare the type dependencies that reach the artifact plane.** Six pairs gained a declaration in the section the package already uses for that seam: `dsh-util-values` in `dependencies` for `patent-tools`, `mcp-client`, `api-settings-controller`, and `tool-fs-search`; `dsh-attachment` in `peerDependencies` (with its dev mirror) for `token-meter`; `dsh-llm` in `dependencies` for `host-synapse`. The other type-only importers stay undeclared on purpose: their types never reach the emitted declarations, so a declaration would add an install requirement for nothing.
- **Brand the ids where they leave their owner.** `patent-teams` payload identities (`PatentTeamsTeamId`, `PatentTeamsTaskId`, `PatentTeamsMessageId`, `PatentTeamsAttemptId`) plus member and captain session ids, branded at the emitter, since the durable team file keeps plain strings; the desktop payloads (`MenuId`, `NotificationId`) with same-named constructors, branded in the shell where the value returns from the Electron bridge; and `ui-chat`'s `ToolCallId` as a re-export of the host vocabulary, branded at the one seam that speaks it (`ui-tool`'s `inspectCall`). Three specs pin the brand relations at compile time.
- **Derive the advertised version from the manifest.** `acp` reads its own `package.json` through `createRequire(import.meta.url)('../package.json')`, mirroring `@deepseek-ai/dsh-llm`'s attribution, and its bridge spec pins the handshake to that manifest.

## Alternatives considered

- **Declare every type-only workspace import.** Rejected: the dependency policy ignores type-only imports deliberately, and the emitted `.d.ts` is the fact that decides whether a consumer needs the package.
- **Brand the durable team file and the whole client id plane.** Rejected: those ids are structural or private there, and the client's node projection normalizes host ids to strings on purpose, so branding them would ripple through roughly twenty client sites without an opaque boundary to protect.
- **Inject the ACP version at build time.** Rejected: the repository already derives published versions from package manifests, the relative path resolves from both `src/` and bundled `lib/`, and a build-time define would add a build rule without removing the manifest as the source.
- **Ship the three findings as three pull requests.** Rejected: each is a small, independently verifiable edit, and the batch shares one binding surface and one Agent Note.

## Consequences

Six published declaration sets now list a dependency they require, the client contract has one tool-call identity, and an ACP client sees the version this build actually is. Two limits are recorded rather than fixed: the dependency gate selects only client-faced and configured-host packages, so a plain host package could still import an undeclared workspace package (measured today: no such value import remains anywhere in `src`); and the Electron bridge speaks plain strings on its own side of the wire, so `MenuId`/`NotificationId` exist only where the backend consumes the notification. The cost is that brands are erased at runtime — the pins are the three specs, and a cast that brands a string of the wrong provenance would compile.

## Testing

`pnpm exec vitest run` over the twelve touched packages; `pnpm run typecheck`, `pnpm run lint`, `pnpm run duplication`, `pnpm run test:docs`, and the catalog gates. The new `ids.spec.ts`, the desktop-seam identity assertions, and the `ToolCallId` identity test are the compile-time pins. Brands do not change serialized values and the ACP handshake is not a session record, so no recorded-session snapshot is owed.

## Related

- [naming the swallowed failure in the remaining catch sites](2026-09-12-cross-package-catch-sites.md) — the preceding batch on the same audit.
- [tech-debt tracking in same-repository Issues](../process/2026-09-11-tech-debt-issue-tracking.md) — the scan that produced these findings, which Issues #82–#84 record.
