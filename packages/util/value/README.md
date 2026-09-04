---
description: "Shared unknown-value primitives: object guards, fail-loud positive-number assertions, filesystem errno tests, thrown-value normalization and rendering, and a cycle-safe deep freeze for parser and config boundaries."
kind: "package-library"
---

# @deepseek-ai/dsh-value

English | [中文](README.zh.md)

## Summary

`dsh-value` holds the smallest pieces of untrusted-input handling that every parser, config loader, and wire decoder re-implements: `isRecord` classifies a value as a non-null, non-array object, `isPlainObject` additionally demands the `Object.prototype`-or-null prototype, `assertPositiveInteger` and `assertPositiveFinite` reject out-of-range numbers while narrowing `unknown` to `number`, `assertResolvedConfig` pins the plugin-config boundary once schema defaults have run, `isENOENT` and `isEEXIST` classify filesystem errno errors, and `errorMessage` and `toError` render and normalize arbitrary thrown values without letting hostile coercion escape; `deepFreeze` is re-exported from `dsh-util-values`, the harness-wide owner of the shared deep-freeze implementation. The library owns the predicate and the failure, so a package's diagnostics stay word-for-word consistent across the harness instead of forking per plugin.

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

Reach for `isRecord` before reading properties off an `unknown` value, for `assertPositiveInteger` at the config boundary where a numeric option must be a positive integer, for `assertResolvedConfig` where a plugin receives its schemastery-resolved config, and for `deepFreeze` when a handed-out value must stay immutable.

### Guarding an untrusted object

```ts
import { isRecord } from '@deepseek-ai/dsh-value'

declare const value: unknown

if (isRecord(value) && typeof value.type === 'string') {
  // value: Record<string, unknown> — property reads are unknown-typed here.
}
```

`isRecord` accepts every object prototype — `Date`, `Map`, class instances — and rejects `null`, arrays, primitives, and functions. It answers "can I index this like a record", never "is this a plain object literal".

### Asserting a positive integer

```ts
import { assertPositiveInteger } from '@deepseek-ai/dsh-value'

declare const raw: unknown

assertPositiveInteger('tool-web: maxDepth', raw)
// raw: number here; a non-integer threw TypeError('tool-web: maxDepth must be a positive integer')
```

The caller owns the diagnostic label, so the message names the option in the consumer's own vocabulary. The assertion narrows `unknown` to `number` and throws `TypeError` for non-numbers, non-integers, and values below 1.

### Asserting a positive finite number

```ts
import { assertPositiveFinite } from '@deepseek-ai/dsh-value'

declare const raw: unknown

assertPositiveFinite('bash-local: timeoutMs', raw)
// raw: number here; 0, negatives, NaN, and Infinity all throw TypeError
```

Same shape as the integer assertion: the caller owns the label, the shared library owns the decision and the failure message. The value need not be an integer, but it must be finite and greater than 0.

### Asserting the resolved config boundary

```ts
import { assertResolvedConfig } from '@deepseek-ai/dsh-value'

interface Config { readonly enabled: boolean; readonly cwd?: string }
declare const config: Config

const resolved = assertResolvedConfig<Config, 'cwd'>('bash-local', config, ['cwd'])
// resolved.cwd stays optional; every other field is typed as required
```

Schemastery fills every schema default before a plugin sees its config, but the type system cannot encode that fact, so each plugin restated a local resolved alias and cast. `assertResolvedConfig` is the single assertion point: a default-backed field that is still `undefined` — a bypassed or drifted schema — throws at load with the field named, and the returned value keeps only the declared defaultless keys optional. Key presence is not reconstructed, so a hand-built config must still go through its schema.

### Classifying a plain data object

```ts
import { isPlainObject } from '@deepseek-ai/dsh-value'

declare const payload: unknown

if (isPlainObject(payload)) {
  // payload: Record<string, unknown> — arrays, class instances, and null-prototype lookalikes
  // other than true plain objects were rejected.
}
```

`isPlainObject` is the prototype-strict sibling of `isRecord`: it accepts only objects whose prototype is `Object.prototype` or `null`. Use it at wire and protocol boundaries where a foreign class instance must not pass for data.

### Testing a filesystem errno error

```ts
import { isENOENT, isEEXIST } from '@deepseek-ai/dsh-value'

declare const filename: string
declare const open: (path: string) => Promise<void>

try {
  await open(filename)
} catch (error) {
  if (!isENOENT(error)) throw error // every non-ENOENT failure surfaces
}
```

The tests accept only real `Error` instances carrying the code, so a lookalike value can never masquerade as absence or as an existing target.

### Freezing a value in place

```ts
import { deepFreeze } from '@deepseek-ai/dsh-value'

declare const request: { signal: AbortSignal }
declare const defaults: Record<string, unknown>

const snapshot = deepFreeze({ request, defaults })
// every nested object is frozen; the request's AbortSignal is deliberately left unfrozen
```

The traversal is iterative and cycle-safe, so arbitrarily deep values freeze without touching the call stack. `AbortSignal` objects are skipped: they are the live cancellation channel, and freezing one breaks abort.

### Rendering a thrown value

```ts
import { errorMessage } from '@deepseek-ai/dsh-value'

declare const payload: { dispatch(): Promise<void> }
declare const ctx: { logger: { warn(message: string): void } }

try {
  await payload.dispatch()
} catch (error) {
  ctx.logger.warn(`dispatch failed: ${errorMessage(error)}`)
}
```

The renderer is total: `Error` instances render `.message`, non-Error objects carrying a string `message` property render it, everything else is stringified, and a hostile value that traps coercion yields the fixed `[unrenderable thrown value]` placeholder. Diagnostics therefore keep one format harness-wide instead of forking per plugin.

### Normalizing a thrown value

```ts
import { toError } from '@deepseek-ai/dsh-value'

function settle(caught: unknown): Error {
  return toError(caught) // real Errors pass through; everything else becomes one
}
```

Real `Error` instances keep their identity; every other caught value becomes an `Error` carrying the rendered message. The `instanceof` probe is itself guarded, so a trapping value cannot throw from inside the handler and mask the original failure.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The library is built on one boundary: the predicate and the failure message belong to the shared library, the label belongs to the caller.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `isRecord`, `isPlainObject`, `assertPositiveInteger`, `assertPositiveFinite`, `assertResolvedConfig`, `isENOENT`, `isEEXIST`, `errorMessage`, `toError`, `deepFreeze` |
| — | No runtime invariant companion is published; this pure utility owns no event stream or mutable runtime data, and the predicate algebra is exercised by unit tests. |

### Why the guard is shape-only

Every consumer narrowed the same runtime test — object type, non-null, non-array — and then read properties off the result. Prototype discrimination would fork the predicate per consumer, so the shared guard keeps the shape contract the copies already relied on.

### Why the assertion takes a label

The copies differed only in the diagnostic prefix baked into their messages. Passing the label keeps the shared failure exact and lets each consumer name its own option, scope, or config path.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Brand ids](../brand/README.md) — the compile-time sibling: nominal typing for cross-boundary identifiers.
- [Timeout library](../timeout/README.md) — the shared numeric-validation precedent (`clampTimeout`) this package follows.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the parsers and config loaders that reject malformed input before it reaches a request.

#### KV Cache effect

No direct invalidation; the validating consumers own any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the library deliberately does not do. They are current package constraints, not a task backlog.

- **Shape-only object guard** — `isRecord` accepts class instances and `Date`; `isPlainObject` is the prototype-strict alternative when a consumer needs that discrimination.
- **Positive values only** — the assertions cover `>= 1` and positive finite numbers; ranges, upper bounds, and non-integer floors (other than 1) stay with their owning capability.
- **Freeze owns named properties** — `deepFreeze` cannot make TypedArray elements or internal slots (a `Date`'s time value) immutable; values relying on those need owner-side care.
- **Errno tests are strict** — `isENOENT`/`isEEXIST` reject non-`Error` lookalikes by design; a synthetic value carrying `code` surfaces instead of being classified.
- **Rendering is short-form** — `errorMessage` yields `.message` without the error-class prefix for structured records; name-inclusive lines, stack-first reports, and `inspect`-based bounded descriptions stay with their owning consumers.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
