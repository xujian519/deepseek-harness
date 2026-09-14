---
description: "Publication state for one registry entry: a single creation announcement, the listener dispatches that keep it live, and removal deferred to the last one"
kind: "package-library"
---

# @deepseek-ai/dsh-entry-lifecycle

English | [中文](README.zh.md)

## Summary

Registries publish an entry in two steps: insert it live, then announce its creation. That exact entry must stay visible until the announcement dispatch unwinds, because a creation listener may remove it while it is still being called. `dsh-entry-lifecycle` holds this state once — `announce` claims the single creation edge, `beginDispatch`/`endDispatch` bracket any further dispatch that must observe the entry, and `detachCapability` turns removal into a single-shot request that runs when the last open dispatch ends. The package owns this state only; store membership, event carrier, and disposal stay with the registry.

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

An entry's owner keeps the entry, its store membership, and its disposal notification; this package keeps the publication order. The owner inserts the entry live, hands out the removal capability, and closes the announcement dispatch last:

```ts
import { EntryLifecycle } from '@deepseek-ai/dsh-entry-lifecycle'

interface Entry {
  readonly id: string
  readonly lifecycle: EntryLifecycle
}

declare const store: Map<string, Entry>
declare function detachEntered(entry: Entry): void
declare function dispatchCreated(entry: Entry): void

function enter(id: string): () => void {
  const entry: Entry = { id, lifecycle: new EntryLifecycle() }
  store.set(id, entry)
  return entry.lifecycle.detachCapability(() => { detachEntered(entry) })
}

function announce(entry: Entry): void {
  entry.lifecycle.announce(`session "${entry.id}"`)
  try {
    dispatchCreated(entry)
  } finally {
    // A listener that removed the entry mid-dispatch left a request; removal
    // runs here, after that dispatch unwound.
    if (entry.lifecycle.endAnnouncement()) detachEntered(entry)
  }
}
```

A publisher whose own dispatch must not reenter reads `hasOpenDispatch` before opening one, brackets it with `beginDispatch`/`endDispatch`, and removes the entry when `endDispatch` returns true.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `EntryLifecycle` — the announcement claim, the dispatch windows, and the deferred-removal request |
| — | No runtime invariant companion is published; this pure state machine owns no event stream or mutable runtime data, and its ordering rules are enforced by unit tests. |

### Two edges, one order

Removal follows the creation a listener may have observed: `announce` claims the creation edge before the owner dispatches, so a listener that removes the entry mid-dispatch cannot produce a disposal that precedes it — the request is honored only after that dispatch unwinds. The claim is also single: a second `announce` rejects, including a reentrant call from a creation listener.

### One request, one removal

`detachCapability` is single-shot, so calling a duplicated disposer cannot remove a second entry. The transition that honors a deferred request consumes it while returning true, which keeps one request equal to one removal. The count of open dispatches is the only thing that defers removal, so a dispatch nested inside another keeps the entry live until the outermost one closes.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Defensive patterns](../../../docs/defensive-patterns.md) — the publication and teardown ordering rules this state machine implements.
- [Contained dispatch](../contained-emit/README.md) — the sibling `util/` primitive that runs every listener without letting one failure starve the rest.

-----

<a id="model-experience"></a>
## Model Experience

None, as this in-process publication state registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define what the package deliberately does not do. They are current package constraints, not a task backlog.

- **Synchronous dispatches only** — a window closes when its synchronous dispatch returns, and a listener that returns a promise releases the entry immediately, exactly as Cordis' own `emit` does. Awaiting a listener before removal is not expressible here.
- **The owner keeps the entry** — the package tracks no store, carrier, or subject; removing, disposing, and re-registering an id stay the owner's decisions.
- **Every `beginDispatch` needs its `endDispatch`** — the open count is what defers removal, so an unpaired open would hold the entry live indefinitely.
- **No reentrancy policy** — `hasOpenDispatch` reports an open dispatch; a publisher that must not reenter enforces that rule itself.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
