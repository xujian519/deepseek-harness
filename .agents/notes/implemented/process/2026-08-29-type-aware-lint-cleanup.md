# Agent Note: Type-aware lint cleanup distinguishes dead code from type-blind defense

Status: implemented

English | [中文](2026-08-29-type-aware-lint-cleanup.zh.md)

## Problem

The 66k-line better-sidebar package accumulated 226 type-aware lint errors (oxlint `typescript/*` rules: `no-base-to-string` 79, `no-unnecessary-condition` 40, `no-unsafe-assignment` 25, `unbound-method` 23, `no-redundant-type-constituents` 15, and 18 further rules). None were compile errors, so `tsc` gave no signal; but every one either hid a real typing defect or trained readers to ignore the linter. The errors clustered in the test files (161) with the remainder in `src` (65), and the `src` share included `no-unnecessary-condition` reports — "this branch is always false" — where deleting the branch is wrong as often as it is right.

## Decision

Clean up against the *runtime* contract, not the declared type alone. Every `no-unnecessary-condition` report got a reachability verdict before any edit, and the verdicts fell into four classes with different fixes:

- **Control-flow narrowing vs. callback-mutated state** (`let flag = false` set inside a `mapLeaf`/`forEach` callback or across an `await`). The type checker's value range is simply blind to the writer. Fix at the declaration (`= false as boolean`) or at the read (`flag as boolean`) — zero behavior change, and the assertion documents "this variable is runtime-polymorphic".
- **jsdom-defense branches** (`HTMLElement.prototype.setPointerCapture?`, `window.visualViewport`, `event.dataTransfer?`). The lib.dom declaration says the member is always there; jsdom says otherwise, and component tests dispatch events without a `dataTransfer` on purpose. These keep the optional chain under a one-line `oxlint-disable-next-line` naming the environment, because the branch is load-bearing.
- **Incomplete wire-shape assertions** (`data.chunk as {...} | undefined` when the JSON can literally be `null`; ws `RawData` lacking a shared utf8 `toString`). Fix the assertion or add a narrowing helper (`frameText`), never delete the guard.
- **Genuinely dead checks** (`documentElement === null` on a parsed document, a second `?? undefined` compare, `String()` on an already-string). Deleted.

Test-only fetch mocks are typed to the real call surface rather than the ambient `fetch` signature: the api layer posts string routes with stringified JSON, so the stubs take `(url: string, init?: RequestInit)` and a `postedJson`/`matchers.ts` helper replaces `JSON.parse(String(init?.body))` and the `any`-returning asymmetric matchers in object-literal positions. Prototype save/restore uses `vi.spyOn` where the member exists (jsdom's missing `scrollIntoView` needs the assign-then-delete shape instead — `vi.spyOn` requires an own member and throws otherwise). Unbound-method references that serve as identity anchors for a restore (the open-path HMR wrapper) get narrow disables; every reference that is later *invoked* gets `.bind()` or an arrow passthrough instead.

## Alternatives considered

- **Silence the five rules for `tests/**` in the oxlint config.** Rejected: the test files carry real defects of their own (any-typed mocks that let a renamed wire field slip through), and a global off-switch also hides the jsdom-defense distinction the per-site disables make visible.
- **Delete every always-false branch the rule reports.** Rejected: two of the forty (the logger optional chain, the visualViewport check) were reachable in the very environments the tests simulate; blanket deletion broke 73 tests before the manual verdicts caught up.

## Consequences

- `pnpm run lint` is clean for the package; the remaining repository warnings are pre-existing `memory/openviking` test warnings outside this change.
- The `oxlint-disable` comments are load-bearing documentation: each names the environment gap or identity-anchor reason. A future jsdom upgrade that implements `visualViewport` or `setPointerCapture` should delete the paired defense and its disable together.
- The narrow `any` exits now sit in one typed file (`tests/matchers.ts`); new asymmetric matchers should extend it rather than re-inline `expect.any` in object literals.
- Type-level workarounds (`false as boolean`, `value as never` in the `textRender` eraser) are the deliberate shape for "the checker cannot see the writer"; prefer restructuring to a `some()`/early-return when a rewrite stays behavior-identical.
