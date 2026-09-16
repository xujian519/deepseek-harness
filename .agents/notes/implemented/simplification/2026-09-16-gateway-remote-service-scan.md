# Agent Note: One scan feeds both the gateway's SRC claims and its descriptor lookup

Status: implemented

English | [中文](2026-09-16-gateway-remote-service-scan.zh.md)

## Problem

`TypertGatewayService` walked `ctx.reflect.props` twice with the same six-step prefix: enumerate the properties, keep `definition.type === 'service'`, read `this.ctx.get(serviceKey)` as the receiver, keep objects, unwrap it through `originalOf`, and read `typertRemote` off the original. `collectSrcClaims` used the value to enumerate every Remote endpoint a live Service claims; `resolveSrcDescriptor` used it to find the single descriptor that answers one namespace and method.

The two loops only diverged after that prefix: a claim scan needs a value that is an object exposing a string `namespace`, while resolution hands the value to `readBinding`, which validates the whole binding and throws `gateway/binding-invalid` when it is inconsistent. So a change to how a live Remote is discovered — a second binding property, a different unwrap — had to be applied in two places, and nothing in the code made a missed second application visible.

## Decision

A private generator, `remoteBindingValues()`, yields `{ serviceKey, original, value }` for every active Service whose receiver is an object, where `value` is the raw `Reflect.get(original, 'typertRemote')`. `collectSrcClaims` keeps its object-and-namespace filter; `resolveSrcDescriptor` keeps its `undefined` skip and its `readBinding` call.

Accepting a candidate therefore stays with the consumer that needs the judgment: a claim scan may skip a binding it cannot read a namespace off, while resolution must report an inconsistent one. The generator yields the raw value rather than a validated binding because it cannot make that call for both.

## Alternatives considered

**Validate inside the generator and yield `TypertGatewayBinding`.** Rejected: validation is exactly where the consumers differ. A validating generator would either throw `gateway/binding-invalid` during a claim scan that only wanted to enumerate endpoints, or swallow a binding that resolution must report — one of the two consumers would have to re-do the check.

**A module-level `function* remoteServices(ctx)` next to the other helpers.** Rejected: both consumers are methods on the same service and read nothing but `this.ctx`, so a free function would take the Context as a parameter and move a service-internal walk out of the class without removing any dependency.

**Let the generator build the claim set and have resolution filter that set.** Rejected: the claim scan derives endpoints from `namespace` plus every `remoteMethods` candidate, while resolution needs the whole binding and builds an `InvocationDescriptor` per candidate. Sharing the derived data would compute the claim set on every resolution.

**Record the duplication as accepted and leave both loops.** Rejected: the loops must stay in step for a live Remote to be reachable at all, and a divergence fails silently — the claim set would miss endpoints that resolution still serves, or claim ones it cannot.

## Consequences

Discovering a live Remote is one walk, so a new discovery rule is applied once and both consumers see it.

Each consumer states its own acceptance rule at its own site, which is what a reader needs: the skip in the claim scan and the throw in resolution are visible where they are decided rather than folded into a shared helper.

The gateway's strict-definition path is untouched — an endpoint found through `ctx.typert.local` never reaches these loops.

## Testing

`packages/api/gateway/tests/gateway.host.spec.ts` reaches both consumers through SRC markers. The gateway suite (8 files, 287 tests) passes unchanged, and `packages/api/gateway/src/index.ts` keeps 100% statements, branches, functions, and lines under `vitest --coverage --coverage.include`.

## Related

- [the strict and SRC dispatch modes](../../../../docs/subsystems/typert.md) — where a live Remote binding comes from and what the gateway does with it.
