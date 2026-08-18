# Agent Note: Desktop packaging chain unblocked (client-face isolation, stale bridge socket, base-bundle deps)

Status: implemented

English | [中文](2026-08-18-desktop-packaging-chain-unblocked.zh.md)

## Problem

`pnpm run package:desktop:mac` could not produce a working app; four pre-existing defects blocked it in sequence:

1. **Client-face type isolation was broken.** Shared packages (`api/remotes`, `llm-retry`, `compaction`, …) import types from the `@deepseek-ai/dsh-session` root, whose emitted declarations carried the host-only `Context.sessions: SessionStore` merge. Any client-face program that pulled those packages in — client/runtime references them — collided with the client's own `Context.sessions: ISessions` declaration (~30 TS errors, headed by TS2717). The repo's own rule (projection-store.ts: "one program must not hold both sides") had silently rotted: CI's typecheck lane only runs `build:lib:host`, so the client face never caught it.
2. **Base-bundle manifest was incomplete.** `packages/bundle/base/cordis.patch.yml` includes `dsh-self-evolve`, `dsh-self-evolve-basic`, and `dsh-tool-self-evolve`, but `base/package.json` never declared them, so the packaged backend deploy tree lacked the packages and the desktop profile failed with `Cannot find package` at boot.
3. **Stale bridge socket.** A POSIX socket file survives its listener; a killed or crashed app leaves `dsh-desktop-bridge.sock` behind, and the next launch failed with `EADDRINUSE` even though nothing listened. This was the original "desktop won't start" root cause, recurring on every unclean exit.
4. **Tool catalog lagged.** `scripts/gen-tool-catalog.ts`'s `TOOL_PACKAGES` omitted `tool-self-evolve` (added later), so its spec failed with a manifest-completeness error and the generated `docs/tool-catalog.md` was stale.

## Decision

1. `Context.sessions` moved out of the `dsh-session` root into a dedicated `@deepseek-ai/dsh-session/context` subpath. Every package that reads `ctx.sessions` adds one type-only import (`import type {} from '@deepseek-ai/dsh-session/context'`): the augmentation is program-global once loaded, and the type-only form keeps the import out of emitted declarations, so a client program never sees the host merge. The host face roots its own injection in `apps/cli/tests/context-host.ts`.
2. `base/package.json` now depends on `@deepseek-ai/dsh-self-evolve`, `@deepseek-ai/dsh-self-evolve-basic`, and `@deepseek-ai/dsh-tool-self-evolve`; `verify-cordis-config` passes over all 132 configs.
3. `BridgeServer.start()` probes an `EADDRINUSE` POSIX socket path: a live listener keeps the error, a dead file is unlinked and the bind retried once. Covered by a new stale-socket regression test.
4. `TOOL_PACKAGES` gained the `tool-self-evolve` entry (mount stubs `ctx.selfEvolve` via `ctx.provide`), the catalog spec's full tool-name assertion was refreshed to the 81 shipped tools, and `docs/tool-catalog.md`/`zh` were regenerated and re-recorded.

## Alternatives considered

- **Convert every shared package to `/types` imports** — impossible: values (`SessionStore`, `canonicalHeader`, …) live only in the root; the root would still carry the merge.
- **Drop the client `ISessions` declaration** — would force assertion casts across every client consumer; rejected in favor of the isolation fix.
- **Fix the bridge by deleting the socket file at startup unconditionally** — would break a genuinely live second instance; the probe distinguishes live from stale.

## Consequences

`package:desktop:mac` completes end to end; the installed app boots (bridge + backend + UI) and survives unclean exits. `tsc -b tsconfig.client.json` is now green and stays checked by the desktop build path, so this class of host/client Context merge drift fails fast. The tool catalog now includes the self-evolve tools. Known remaining debt: `docs/tool-catalog` and `docs/config-catalog` zh sides are hand-maintained reviewed translations; the generator writes only English.
