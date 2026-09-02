# Agent Note: Upgrade react-virtual for the debounce timer that outlived the jsdom environment

Status: implemented

English | [中文](2026-09-03-react-virtual-debounce-timer-jsdom-unhandled-error.zh.md)

## Problem

The CI unit-test step exited 1 while every test passed — `22635 passed | 8 skipped`, zero failures. Vitest's summary held the real signal:

```
Vitest caught 1 unhandled error during the test run.
Uncaught Exception
ReferenceError: window is not defined
  ❯ getCurrentEventPriority react-dom/cjs/react-dom.development.js:10993
  ❯ Object.onChange @tanstack/react-virtual/dist/esm/index.js:81
  ❯ Timeout._onTimeout @tanstack/virtual-core/dist/esm/utils.js:65
This error originated in "packages/client/ui-trajectory/tests/table.client.spec.tsx".
```

`@tanstack/virtual-core` 3.17.7 installs a scroll listener whose `isScrollingResetDelay` debounce queues a `setTimeout` per scroll event. Its `observeOffset` cleanup only removed the event listeners; the debounce handle is closure-local, so the queued callback stayed alive past `cleanup()` in the spec's `afterEach`. The spec file finished before the 150 ms delay elapsed — all 35 of its tests passed — and the Vitest worker moved on and tore the jsdom environment down. When the queued callback then fired, it ran the table's `onChange` into React's `dispatchReducerAction`, and react-dom's development build dereferences the bare `window` global, which no longer existed. The uncaught exception made the whole unit-test lane exit 1.

Running the spec alone never reproduces this: the environment outlives the timer there, and a dispatch on an unmounted component is a React no-op. Only the full-suite worker topology, where the environment dies between the file's end and the timer's fire, exposes it — which is why the failure looked flaky.

## Decision

Upgrade `@tanstack/react-virtual` from `^3.14.9` to `^3.14.10` in `packages/client/ui-trajectory/package.json`, pulling in `@tanstack/virtual-core` 3.17.8.

Version 3.17.8 fixes exactly this leak: the debounce wrapper gained a `cancel()` handle, and `observeOffset`'s cleanup calls it, dropping the queued invocation once the caller has unsubscribed. The late `onChange` can no longer fire after unmount, in any environment.

## Alternatives considered

**Flush the debounce delay in test teardown.** Waiting out `isScrollingResetDelay` in the spec's `afterEach` would drain the timer before the environment dies. Rejected: it makes every consumer of the library pay for one upstream cleanup gap, slows the suite for a product problem the tests do not own, and leaves the leak in place for the next vitest topology change to re-expose.

**Ignore unhandled errors in Vitest.** Setting `dangerouslyIgnoreUnhandledErrors` would turn the lane green. Rejected: it silences every future unhandled exception, the one class of signal that this incident shows the suite needs.

## Consequences

`ui-trajectory` is the only package depending on `@tanstack/react-virtual`, so the lockfile change is contained to the trajectory table's dependency subtree; its 9 test files (134 tests) and the full typecheck pass on virtual-core 3.17.8.

A unit-test lane that exits 1 with zero failing tests now has a known first diagnostic: read Vitest's "Unhandled Errors" summary before treating the run as flaky. Any jsdom spec whose environment can be torn down while a third-party timer is pending can produce this class of failure.
