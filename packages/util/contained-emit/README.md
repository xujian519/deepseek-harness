---
description: "Contained observe-only event dispatch over Cordis: run every listener, log every failure, and keep veto semantics with the caller."
kind: "package-library"
---

# @deepseek-ai/dsh-contained-emit

English | [中文](README.zh.md)

## Summary

Cordis' `emit` walks listeners through `Array.map`: one synchronous throw starves every later listener, and a returned promise that later rejects surfaces as an unhandled rejection. Notifications that must not veto a committed state change need the opposite behavior — every listener runs, and every failure becomes one log line. `dsh-contained-emit` provides that loop once: `emitContained` dispatches an `emit`-mode event and contains each listener; `invokeContained` contains an already-resolved callback snapshot (for example from a registry that is not the event bus). Callers inject their own log label and error renderer, so the zero-dependency package stays format-neutral and works for any consumer vocabulary.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use `emitContained` where `ctx.emit` would be called for a non-vetoing notification, and `invokeContained` where the callback set comes from somewhere other than `ctx.events.dispatch` — a private listener registry, or a snapshot that must be resolved before a state transition.

### Dispatching a contained notification

```ts
import { emitContained } from '@deepseek-ai/dsh-contained-emit'
import { errorMessage } from '@deepseek-ai/dsh-value'
import type { Context } from '@deepseek-ai/cordis'

declare const ctx: Context
declare const session: { id: string }

emitContained(ctx, `session "${session.id}": session/event`, ['session/event', { session }], errorMessage)
```

The log label appears verbatim in both failure kinds: `… listener threw: …` for a synchronous throw, `… listener rejected: …` for a rejected returned promise. The renderer renders the caught value; inject `errorMessage` for short-form messages, `errorChain` where cause chains matter, or a package-local renderer for a different format.

### Containing a snapshot from a private registry

```ts
import { invokeContained } from '@deepseek-ai/dsh-contained-emit'
import { errorMessage } from '@deepseek-ai/dsh-value'
import type { Context } from '@deepseek-ai/cordis'

declare const ctx: Context
declare const listeners: Array<(owner: unknown) => unknown>
declare const owner: unknown

invokeContained(ctx, 'jobs: onJobsChanged', listeners, [owner], errorMessage)
```

`invokeContained` is the loop `emitContained` delegates to; it never touches the event bus.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One loop, two entry points, and the Cordis argument-shape contract.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `invokeContained`, `emitContained`, the `ContainedListener` callback type |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant; containment behavior is enforced by unit tests) |

### The dispatch argument contract

`ctx.events.dispatch('emit', args)` mutates `args`: it shifts off an optional leading scoped carrier and the event name, leaving exactly the declared listener payload, and returns the matching callbacks bound to the carrier. `emitContained` therefore accepts `args` in the same shape `ctx.emit` would, calls every callback with the remaining payload, and needs no argument reassembly of its own.

### Containment shape

Each callback is invoked inside its own `try` block, and `Promise.resolve(returned).catch(…)` observes the returned promise, so a synchronous throw and an asynchronous rejection each produce exactly one `ctx.logger.warn` line. Later listeners always run; nothing escapes the function.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Defensive patterns](../../../docs/defensive-patterns.md) — the containment requirements this loop implements.
- [Agent Note: the abort-race primitive](../../../.agents/notes/implemented/architecture/2026-08-30-abortable-abort-race-sink.md) — the related promise-versus-signal primitive in `dsh-timeout`.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the notification consumers that own any model-facing rendering of contained events.

#### KV Cache effect

No direct invalidation; dispatched notifications are log-only, so no failure line reaches a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the package deliberately does not do. They are current package constraints, not a task backlog.

- **Observe-only, never vetoing** — a synchronous listener throw is logged, not propagated. A notification whose synchronous failure must roll back a state transition (a publication veto) does not fit this package; dispatch it directly and contain only the returned promise.
- **`emit`-mode dispatch only** — `serial`, `waterfall`, and `bail` semantics have their own Cordis entry points with veto or aggregation contracts.
- **The caller owns the log format** — the package renders nothing itself; two consumers may log the same failure differently by injecting different renderers.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
