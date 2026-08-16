# Plugin Authoring

English | [中文](plugin-authoring.zh.md)

This reference is the lookup table of contracts and cautions a plugin author must hold, not a tutorial or a step-by-step how-to. Concepts belong to the [Cordis primer](cordis-primer.md); the ordered first-plugin path belongs to [Your first plugin](user/develop/basic/index.md); procedures belong to the [extension cookbook](cookbook/extension-cookbook.md) and [adding a package](cookbook/adding-a-package.md); the extension-point map belongs to [Where new behavior goes](architecture.md#where-new-behavior-goes).

## A. The plugin contract

Each section states the contract in one paragraph, links its owning document, cites a real package, and lists the Do/Don't cautions that follow from it.

### A1. Two plugin shapes

The Loader accepts two export shapes: a function plugin that named-exports `name` / `inject` / `Config` / `apply` with no default export, and a `Service` subclass that default-exports the class. The two shapes never mix in one entry: mixing makes the Loader discard the function plugin's namespace ([postmortem](postmortem/0001-acp-default-export-drops-inject.md)). `packages/todo/tool-todo/src/index.ts:22-43` is the function-plugin template and `packages/shell/shell/src/index.ts:40-103` the Service shape.

- Do — pick one shape per package and keep the four named exports of a function plugin.
- Don't — add a default export to a function plugin, or export a bare `apply` without `name` and `inject`.

### A2. Declare dependencies by injection

Required services are declared through `inject` (a function-plugin field or a Service subclass's `static inject`); optional services are read strictly through `ctx.get(name)` and must fail loud when absent. Runtime service probing in `apply` is forbidden: it makes activation order unpredictable and leaves registrations behind after reload ([package rules](../packages/AGENTS.md)). `packages/shell/bash-local/src/index.ts:102-103` declares its injection statically; `packages/shell/tool-bash/src/index.ts:185-200` reads optional services through `ctx.get` and throws when a required policy is missing.

- Do — read optional services through `ctx.get(name)` and fail loud at the earliest resolvable point when a needed service is absent.
- Don't — switch behavior on `typeof ctx.xxx !== 'undefined'` probes, or use the `ctx.<name>` property proxy for undeclared keys.

### A3. Config: schema, defaults, and `!!js`

A plugin pairs its `Config` interface with a same-named Schemastery schema exported from the same module; deployment choices are `.required()`, defaults live in the schema, and call sites never re-default. `cordis.yml` interpolates entry `config` and `disabled` through `!!js` expression nodes ([loader configuration](cordis-primer.md#loader-configuration)). `packages/todo/tool-todo/src/index.ts:29-43` pairs the interface with the schema; `examples/headless-agent/cordis.yml` shows entry config and `!!js`; overlay `disabled` patches select environments (`examples/acp-agent/subagent-durability-failure.cordis.snapshot.yml`).

- Do — make deployment-varying options `.required()`, document each key's semantics in the interface JSDoc, and default in the schema.
- Don't — read environment variables or embed secrets in the schema, or keep defaulting logic at the `run`/`resolve` call site.

### A4. Lifecycle and reversible effects

Every registration is an effect: prompt sections, tool schemas, adapters, providers, and listeners install through `ctx.effect()` or `ctx.on()` so teardown and reload unwind them predictably; the vendored fiber state machine hardens this lifecycle against reentrant unload and mid-teardown registration ([primer](cordis-primer.md), [vendoring manifest](../vendor/README.md)). A registry contribution must prove disposal through the HMR-safety test ([testing](testing.md)); `packages/guard/timeout-policy/src/index.ts:55-81` wraps a tool execution inside one listener and restores the signal in `finally`.

- Do — install every registration inside the effect scope and prove disposal by disposing the fiber in a test.
- Don't — leave side effects outside an effect scope, or do asynchronous startup work at the top level of `apply` or a constructor.

### A5. Events and dispatch modes

Event names are declared through TypeScript declaration merging; the dispatch mode is part of each event's public contract and new harness events document it with an `@mode` tag ([dispatch modes](cordis-primer.md#dispatch-modes)). Waterfall listeners are around-middleware: call `next()` to delegate, return without it to short-circuit, and read the wrapped result from `next()`'s return value ([waterfall semantics](cordis-primer.md#cordis-waterfall-semantics)). `packages/guard/timeout-policy/src/index.ts:55-81` is the reference wrapper: it delegates through `next()` and replaces the result only when its deadline fired.

- Do — honor the declared dispatch mode, use `prepend: true` only for order-sensitive listeners, and always call `next()` when a listener only observes.
- Don't — intercept in an `emit` listener (it is not awaited and returns nothing), or treat a waterfall listener's return value as optional.

### A6. Seam authorship: Definition, Provider, Consumer

A capability seam has three roles — Service Definition, Service Provider, Consumer — and the role definitions and service graph belong to [capability seams](capability-seams.md) and [architecture](architecture.md#capability-seams). The author obligations are: the Definition is an abstract `Service` (never a TypeScript `interface`) designed for all current Consumers; defaults are filled by `resolve(request): Spec`, and `run` consumes only resolved specs; a public service method with a single internal caller becomes a private capability closure instead. `packages/shell/shell/src/index.ts:65-101` declares the seam; `packages/shell/bash-local/src/index.ts:146-160` fills defaults in `resolve`; `packages/shell/tool-bash/src/index.ts:370-380` consumes the seam through `resolve` then `run`.

- Do — keep tool-schema, Loader, UI, transport, and provider-specific behavior in the Consumer or provider, and design the Definition for every current Consumer.
- Don't — let one Consumer dictate the service contract, or expose a public service method that only one internal caller uses.

### A7. Session log and projections

The session log is the single source of the model-visible context: `SessionEventMap` is a merge-extensible, append-only map and a new model-visible input requires a new event rendered from the log ([session log](architecture.md#session-log), [session subsystem](subsystems/session.md)). A plugin extends the map in its pure `src/types.ts` and re-exports the types from the index so declaration merging survives the module edge; events are appended only at the commit point of a successful operation ([publish state at its commit point](../packages/AGENTS.md)). `packages/core/session/src/types.ts:236` owns the map; `packages/llm/llm-retry/src/types.ts:5-10` extends it; `packages/todo/tool-todo/src/types.ts:15-24` extends the projection map instead, and `packages/todo/tool-todo/src/index.ts:128-148` derives a `SessionProjectionMap` view from the log.

- Do — extend `SessionEventMap` in `src/types.ts` with a type-only re-export from the index, and append the event only after the operation succeeds.
- Don't — put runtime code in `src/types.ts`, or keep derived state outside the log.

### A8. Ship the package whole

A publishable package is the plugin plus its `./invariant` companion (a manifest-registered runtime check of an event/data relation), package-level `tests/`, and a README in the canonical Model Experience format; product-visible plugins require a non-unit REAL-composition test that boots a `cordis.yml` through the Loader ([package rules](../packages/AGENTS.md), [testing policy](testing.md)). `packages/todo/tool-todo/src/invariant.ts` is the invariant companion; `packages/todo/tool-todo/tests/loader-composition.spec.ts` boots a `cordis.yml` through the real Loader to prove `allowParallelInProgress` is real configurability.

- Do — register a manifest name for `./invariant` (an empty installer gives a package-specific `No runtime invariant:` reason), keep README and JSDoc in the same change as behavior, and add the REAL-composition test.
- Don't — ship an unexplained empty invariant, rely on a hand-built `ctx.plugin(...)` suite alone, or put tests under `src/__tests__/`.

## B. The caution checklist

This table is the fast scan surface; each row's full reasoning lives in its section above.

| Caution | Direction | Section |
|---|---|---|
| Mixing export shapes in one package | Don't | [A1](#a1-two-plugin-shapes) |
| Default export on a function plugin, or bare `apply` without `name`/`inject` | Don't | [A1](#a1-two-plugin-shapes) |
| Runtime service probing instead of `inject` / `ctx.get` | Don't | [A2](#a2-declare-dependencies-by-injection) |
| Silent degradation when an optional service is absent | Don't | [A2](#a2-declare-dependencies-by-injection) |
| Deployment choices left optional in the schema | Don't | [A3](#a3-config-schema-defaults-and-js) |
| Environment reads or secrets inside the schema | Don't | [A3](#a3-config-schema-defaults-and-js) |
| Defaulting logic at the `run`/`resolve` call site | Don't | [A3](#a3-config-schema-defaults-and-js) |
| Side effects outside an effect scope | Don't | [A4](#a4-lifecycle-and-reversible-effects) |
| Async startup at the top level of `apply` or a constructor | Don't | [A4](#a4-lifecycle-and-reversible-effects) |
| Intercepting in an `emit` listener | Don't | [A5](#a5-events-and-dispatch-modes) |
| Omitting `next()` in a waterfall listener that only observes | Don't | [A5](#a5-events-and-dispatch-modes) |
| One Consumer dictating the service contract | Don't | [A6](#a6-seam-authorship-definition-provider-consumer) |
| Public service method with one internal caller | Don't | [A6](#a6-seam-authorship-definition-provider-consumer) |
| Runtime code in `src/types.ts` | Don't | [A7](#a7-session-log-and-projections) |
| Derived state kept outside the log | Don't | [A7](#a7-session-log-and-projections) |
| Appending an event before the operation commits | Don't | [A7](#a7-session-log-and-projections) |
| Unexplained empty `./invariant` | Don't | [A8](#a8-ship-the-package-whole) |
| Hand-built `ctx.plugin(...)` suite as the only product-visible test | Don't | [A8](#a8-ship-the-package-whole) |

## C. Community alignment

dsh inherits its plugin model from the Cordis ecosystem. This table maps upstream conventions to the dsh equivalent so a contributor with Koishi or Cordis background can carry the mental model over; it judges the relation only, and each convention's full content lives at its linked landing. One fact frames the relationship: the upstream [cordiverse/cordis](https://github.com/cordiverse/cordis) README points its documentation link at dsh's published [Cordis primer](https://deepseek-harness.github.io/deepseek-harness/reference/cordis-primer), so the dsh copy of the framework docs serves as upstream documentation.

| Community convention | Source | dsh equivalent | Relation | Landing |
|---|---|---|---|---|
| Every registration is a revertible effect | [Cordis paper](https://github.com/cordiverse/paper), [Koishi lifecycle](https://koishi.chat/guide/plugin/lifecycle.md) | Registrations install through `ctx.effect()`/`ctx.on()` with hard fiber teardown | enhanced | [primer](cordis-primer.md), [vendoring manifest](../vendor/README.md) |
| Declare dependencies, never probe services at runtime | [Koishi service guide](https://koishi.chat/guide/plugin/service.md) | `inject` for required services, strict `ctx.get` for optional | aligned | [A2](#a2-declare-dependencies-by-injection), [package rules](../packages/AGENTS.md) |
| Config validated by schema with defaults and descriptions | [Koishi schema guide](https://koishi.chat/guide/plugin/schema.md) | Same-named Schemastery schema; `!!js` adds lazy interpolation | enhanced | [A3](#a3-config-schema-defaults-and-js), [loader configuration](cordis-primer.md#loader-configuration) |
| Async initialization lives in lifecycle events | [Koishi lifecycle](https://koishi.chat/guide/plugin/lifecycle.md) | Vendored fiber state machine hardens unload and teardown | enhanced | [vendoring manifest](../vendor/README.md) |
| Reusability is declared explicitly | [Koishi lifecycle](https://koishi.chat/guide/plugin/lifecycle.md) | Preset composition and `isolate` realms scope per-session capability sets | enhanced | [Where new behavior goes](architecture.md#where-new-behavior-goes) |
| Metadata and manifest conventions | [Koishi publish guide](https://koishi.chat/guide/develop/publish.md), [Agent Skills spec](https://agentskills.io/specification) | `@deepseek-ai/dsh-*` naming and per-package README contract | aligned | [publish](user/develop/basic/publish.md), [adding a package](cookbook/adding-a-package.md) |
| Privacy and security boundaries | [Koishi filters](https://koishi.chat/guide/plugin/filter.md), [MCP server guide](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/docs/draft/develop/build-server.mdx) | Secrets never inline: credentials and settings seams resolve them at request time | enhanced | [A3](#a3-config-schema-defaults-and-js), [capability seams](capability-seams.md) |
| Progressive disclosure in docs | [Agent Skills spec](https://agentskills.io/specification) | Tiered documentation with word budgets and one home per fact | distinct | [documentation standard](AGENTS.md) |
| Type-level integration over package-level coupling | [Koishi service guide](https://koishi.chat/guide/plugin/service.md) | Workspace project references plus pure-`types.ts` type face | aligned | [TypeScript project layout](development.md#typescript-project-layout) |
| Publish checklist and deprecation etiquette | [Koishi publish guide](https://koishi.chat/guide/develop/publish.md) | Publish checklist exists; no formal deprecation mechanism yet | not established | [publish](user/develop/basic/publish.md) |
