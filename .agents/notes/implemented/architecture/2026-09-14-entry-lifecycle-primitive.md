# Agent Note: Registry entries share one publication state machine

Status: implemented

English | [中文](2026-09-14-entry-lifecycle-primitive.zh.md)

## Problem

`dsh-agent` and `dsh-session` each kept the same entry lifecycle machine. `AgentEntry` and `SessionEntry` carried `announced`/`announcing`/`detachRequested` — plus `appending` on the session side — and each registry ran the same four steps: insert the entry live, announce its creation, defer a removal that arrives while the creation dispatch is still calling listeners, and emit the paired disposal only for an announced entry. The two copies also threw the same sentence, `` `<kind> "<id>" was already announced` ``.

They had already drifted. `dsh-session` defers removal while its append publication is open, a second dispatch window the agent registry has no analogue for, and each side's single-shot detach closure restated the deferral rule in its own terms (`entry.announcing` in [`core/agent/src/index.ts`](../../../../packages/core/agent/src/index.ts), `entry.announcing || entry.appending` in [`core/session/src/index.ts`](../../../../packages/core/session/src/index.ts)). Any correction to the ordering rule had to land twice, which is the drift seed [defensive patterns](../../../../docs/defensive-patterns.md) names as honoring a contract on both sides.

## Decision

- **One primitive, `@deepseek-ai/dsh-entry-lifecycle`.** `EntryLifecycle` owns the announcement claim, the count of open dispatches, and the deferred-removal request. `announce(subject)` claims the single creation edge and opens its dispatch; `endAnnouncement()` and `endDispatch()` close a window and report, by returning true, that the caller must now remove the entry; `detachCapability(remove)` wraps removal as the single-shot capability both registries hand out; `hasOpenDispatch` is the guard a publication reads before opening its own window.
- **The open-dispatch count generalizes both sides' flags.** A window is any synchronous listener dispatch that must still observe the entry. `dsh-session`'s `appending` becomes one `beginDispatch`/`endDispatch` pair around its append publication, and its reentrancy guard reads `hasOpenDispatch` alone — the same condition the `appending` flag expressed, so appending from inside a `session/created` listener behaves as before.
- **Ownership stays with the registries.** Store membership, the `scopeTarget` carrier, event names and payloads, the session `attachments` map, and the `agent/disposed` / `session/disposed` emission remain in their packages; the primitive holds the publication state only. Its rejection is built from a caller-supplied subject such as `` agent "<id>" ``, which moves the shared sentence into the primitive while the kind and the id stay the caller's.
- **The primitive is a `util/` library.** No service, no event, and no runtime dependency, in the group that already holds the H7 dispatch primitive and states the support-level compatibility expectation.
- **The consumer edges are ordinary dependencies, classified at package level.** A runtime value import from a Host entry belongs in `dependencies` when the provider's complete runtime entry is duplicate-install-safe. `EntryLifecycle` instances are self-contained, nothing compares their identity across packages, and the module holds no module-level state, so the package joins `duplicateSafePackages` in [`scripts/package-dependency-policy.ts`](../../../../scripts/package-dependency-policy.ts) instead of taking a per-export exception in the review-gated `safeHostDependencyExports` table.

## Alternatives considered

- **Host the primitive in `dsh-scope` beside `NamedEntries` and `ScopedLayers`.** Rejected: those are scope-aware registry tables, while this machine has no relationship to scope at all, and `dsh-scope` is a stable core package whereas a shared mechanical primitive belongs in the support-level `util/` group.
- **Keep both copies and record a ruling instead.** Rejected: neither side carries a contract the other does not need. The only real difference is the number of dispatch windows, one versus two, and a count is exactly what generalizes it.
- **Expose pure transitions only and let each registry keep its own single-shot closure.** Rejected: an idempotent detach capability is part of the contract both registries document, and the two closures were verbatim duplicates, which is the duplication this change removes.
- **Let the primitive run the removal itself when a window closes.** Rejected: the transitions stay pure booleans so each registry keeps the action only it can perform — removing the store entry and emitting the disposal edge — while the rule deciding *when* lives in one place.

## Consequences

Both registries lose three or four flag fields, the deferred-removal branches, and the single-shot closure; `dsh-session`'s `SessionEntry` keeps `detach` only as the bridge from `Session.append` to the service. Behavior is unchanged: an entry is announced at most once, a removal requested during the creation or the append dispatch runs after that dispatch unwinds, and disposal is emitted only for an announced entry. The announcement sentence is byte-for-byte what it was, and the `hasOpenDispatch` guard preserves the existing append-reentrancy rejection for a publication that must not reenter.

## Testing

`packages/util/entry-lifecycle/tests/entry-lifecycle.spec.ts` pins the machine: the single claim and its verbatim rejection, immediate removal with no dispatch open, deferral across the announcement, across one dispatch, across two nested dispatches, and across a dispatch nested inside the announcement, plus the single-shot capability and the consumed request. The registries' own suites are the behavior evidence for the convergence.

## Related

- [The contained-dispatch sink](2026-08-30-contained-emit-loop-sink.md) — the sibling `util/` primitive this change follows.
- [A local helper copy survives only on a contract of its own](2026-09-14-local-helper-copy-rulings.md) — the same ruling applied to a state machine rather than a helper.
- [Contained dispatch](../../../../packages/util/contained-emit/README.md) — the package this one sits beside in `util/`.
