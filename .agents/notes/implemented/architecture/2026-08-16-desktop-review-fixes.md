# Agent Note: Desktop Review Fixes

Status: implemented

English | [中文](2026-08-16-desktop-review-fixes.zh.md)

## Problem

The code review of the Phase 3 desktop shell (bridge, Service Definition, tray, app rename) surfaced contract and lifecycle defects: a prefix-matched navigation allow-list, an unguarded bridge startup, an unimplemented abort contract, a stale fail-loud claim in the directory-picker README, a spurious `desktop/bridge-lost` on normal disposal, and transport errors leaking outside the `DesktopError` vocabulary.

## Decision

- **Navigation**: compare the exact URL origin instead of a prefix (`isWithinBackendOrigin` in `apps/desktop/src/navigation.ts`); a look-alike host such as `127.0.0.1.evil.com` stays outside the allow-list.
- **Startup**: wrap `bridge.start` in a try/catch that reports the failure and quits instead of leaving a blank window with an unhandled rejection.
- **Abort contract**: `ctx.desktop.showOpenDialog` / `showSaveDialog` accept an optional `AbortSignal`; `BridgeClient.call` rejects a pending call with `AbortError` and discards a later server response. Electron exposes no programmatic dialog close, so the JSDoc and the directory-picker capability document that abort rejects the call while the dialog stays open until the operator acts.
- **Directory picker**: declare `static inject = ['desktop']` so a missing desktop seam fails the load (Cordis keeps the plugin pending) instead of a delayed `TypeError` on first pick; README corrected.
- **Disposal**: `BridgeClient` suppresses `onClose` after an explicit `dispose`, so normal shutdown no longer emits `desktop/bridge-lost`.
- **Error mapping**: the bridge reports server errors as `BridgeRpcError`; the shell provider maps them to `DesktopError('dialog-failed')` and socket failures to `DesktopError('bridge-disconnected')`, keeping the closed vocabulary.
- **Naming and hygiene**: `shortcutDisposers` renamed to `shortcutHandlers`; empty catches name what they swallow; rejected second bridge connections get an error listener.

## Alternatives considered

**Add an abort-capable dialog method with a cancel round-trip.** A bridge cancel request would still not close an already-open native dialog because Electron exposes no programmatic close, so the signal rejects the caller's wait and discards the result instead of pretending to terminate the chooser. Accepted.

**Map transport errors by message string.** Matching `Error.message` text is brittle when Electron or Node rewords failures; a dedicated `BridgeRpcError` class keeps the provider mapping stable. Accepted.

**Keep the prefix navigation check.** `http://127.0.0.1.evil.com` shares the backend origin prefix and would load inside the window; an exact `URL.origin` comparison closes that gap. Accepted.

## Consequences

- New tests cover the navigation policy, bridge startup failure, abort propagation through `BridgeClient` / shell / directory-picker, server-error mapping, unexpected socket close, and quiet disposal.
- The 2026-08-15 note was corrected where it contradicted shipped behavior (bridge registration with a missing path, no backend restart, static tray).
- Desktop unit tests: 56 passing.

## Remaining risks

- Abort cannot close a dialog already on screen; consumers must treat the dialog result as discarded, not cancelled, when the signal aborts.
