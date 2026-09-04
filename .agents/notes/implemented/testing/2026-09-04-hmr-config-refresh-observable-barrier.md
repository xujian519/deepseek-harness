# Agent Note: HMR config refresh observable-state barrier

Status: implemented

English | [中文](2026-09-04-hmr-config-refresh-observable-barrier.zh.md)

## Problem

The config-refresh cases in `packages/boot/app-boot/tests/hmr-config.spec.ts` observe real filesystem events through chokidar. Two of them failed intermittently under CI concurrency.

The `serializes refreshes and waits for them during disposal` case wrote a second file version, slept a fixed 250 ms, then disposed. Disposal closes the chokidar watcher before awaiting the running refresh, so when the change event arrived after that window under parallel load the edit was never queued and `observed` stayed at `['one']` instead of `['one', 'two']`.

The `observes add, change, and unlink outside its module roots` case relied on the `eventually` helper's 10 s default budget, which is below the unit-test lane's `--testTimeout 90000`. A contended host therefore failed a case a quiet host passes.

Both are load-sensitive synchronization: a fixed sleep or a below-lane budget substitutes for observable readiness of the filesystem event the test asserts on. The reliability skill classifies this as a load-sensitive synchronization rather than a product concurrency defect; the shipped refresh serializer is correct.

## Decision

The `serializes refreshes and waits for them during disposal` case replaces the fixed 250 ms sleep with a wait on an observable state transition. The refresh handler now resolves a `secondStarted` promise when the second refresh actually starts, and the test awaits that promise before disposing. Because disposal is deferred until the second refresh has begun, a slow filesystem event delays the drain instead of being lost after the watcher closes; the serializer re-runs that refresh in the same running task while the dirty flag is set, never in parallel. The case also holds the second refresh on a `release2` gate so disposal provably waits on the in-flight refresh, and keeps every original assertion: `maxActive === 1`, disposal unresolved then resolved, and `observed === ['one', 'two']`.

The `observes add, change, and unlink` case passes an explicit 20 s budget to each `eventually` wait and raises the case timeout to the lane (90 s), replacing the 10 s default that sat below the granted budget.

The change is confined to these two cases; no product source, vendored plugin, or configuration is altered.

## Testing

Both cases pass consistently in the single-process app-boot suite, and the serializes case remains green under a six-way parallel process stress that exceeds the CI topology. Host `tsc -b tsconfig.host.json` reports no errors and oxlint reports zero warnings on the edited file.

## Alternatives considered

**Increase the fixed sleep or add a retry loop.** A larger sleep or a retry around disposal still does not name the awaited state, and a retry cannot help once disposal has closed the watcher because the edit is already lost. This is the flake-masking pattern the reliability skill rejects.

**Synchronize through a second watcher the test owns.** Watching the same path from the test side bounds delivery less reliably than a barrier on the plugin's own commit, because two separate watchers do not share one delivery queue and can diverge under load.

**Expose the serializer's dirty state or a change event from the vendored plugin.** A hook in `vendor/hmr` would make the queued state observable, but modifying vendored source requires the sync procedure and re-applying logged local modifications for a test-only benefit, so it is not worth the cost.

**Switch the case to a polling watcher.** Polling bounds detection to an interval but does not remove the need to observe that the edit was accepted; it still needs the state barrier and changes the detection mechanism under test.

## Consequences

The two cases no longer depend on a wall-clock sleep or a below-lane budget, so a contended host delays the refresh until the observable state is reached instead of falsely failing. The cost is that an unproductive run reports by budget rather than immediately: up to 20 s per event in the observes case, and up to the case timeout in the serializes case, which can consume the lane when the host is heavily contended. Product behavior and the vendored refresh serializer are unchanged.
