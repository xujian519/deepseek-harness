---
description: "Shared unknown-value primitives: an object guard and a fail-loud positive-integer assertion for parser and config boundaries."
kind: "package-library"
---

# @deepseek-ai/dsh-value

English | [中文](README.zh.md)

## Summary

`dsh-value` holds the smallest pieces of untrusted-input handling that every parser, config loader, and wire decoder re-implements: `isRecord` classifies a value as a non-null, non-array object, `assertPositiveInteger` rejects anything that is not an integer >= 1 while narrowing `unknown` to `number`, and `assertPositiveFinite` does the same for positive finite numbers. The zero-dependency library owns the predicate and the failure, so a package's diagnostics stay word-for-word consistent across the harness instead of forking per plugin.

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

Reach for `isRecord` before reading properties off an `unknown` value, and for `assertPositiveInteger` at the config boundary where a numeric option must be a positive integer.

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

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The library is built on one boundary: the predicate and the failure message belong to the shared library, the label belongs to the caller.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `isRecord`, `assertPositiveInteger`, `assertPositiveFinite` |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion (no runtime invariant; the predicate algebra is exercised by unit tests) |

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

- **Shape-only object guard** — `isRecord` accepts class instances and `Date`; consumers needing prototype discrimination own that check themselves.
- **Positive values only** — the assertions cover `>= 1` and positive finite numbers; ranges, upper bounds, and non-integer floors (other than 1) stay with their owning capability.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
