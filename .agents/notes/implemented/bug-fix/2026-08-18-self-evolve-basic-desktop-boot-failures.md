# Agent Note: self-evolve-basic missing plugin entry and empty-target drift guard

Status: implemented

English | [中文](2026-08-18-self-evolve-basic-desktop-boot-failures.zh.md)

## Problem

The desktop shell (and any dsh backend booting the `base` bundle) failed to start, in two stacked layers:

1. `@deepseek-ai/dsh-self-evolve-basic` never exported a Cordis plugin entry — no `export default` and no `apply` — while `packages/bundle/base/cordis.patch.yml` has included it as a loader entry since the Phase 1 commit. The loader rejected it with `invalid plugin, expect function or object with an "apply" method, received object` (the module namespace object). The packaged desktop app kept working because its bundled resources predate the seam; source/dev launches failed every time.
2. After adding the plugin entry, a second failure surfaced: schemastery's `z.object({...})` normalizes a missing nested-object field to `{}` rather than `undefined`, so the load-time drift guard in `resolveConfig` saw `config.proposerTarget !== undefined` as true for an unconfigured target and compared `{}.provider === {}.provider` (`undefined === undefined`), throwing `validatorTarget must differ from proposerTarget` on every boot that did not configure both targets.

## Decision

1. `packages/self-evolve/self-evolve-basic/src/index.ts` now ends with `export default BasicSelfEvolveEngine`. The class matches the Cordis class-plugin contract (`new Plugin(ctx, config)` with `static Config` and `static inject`), the same shape `dsh-skill` uses with `export default SkillRegistry`.
2. `resolveConfig` treats a target as configured only when it carries both a `provider` and a `model`: an empty object (the schemastery normalization for an absent field) is ignored, and a half-specified target fails loud with a dedicated message. The schema was left unchanged — schemastery's `z.object(...)` has no `.optional()` method, and its fields are optional by default, so the schema layer cannot express "absent object field yields `undefined`".

## Alternatives considered

- **`.optional()` on the target schemas** — not available in this schemastery version (`z.object(...).optional is not a function`); rejected as infeasible.
- **`.required()` on the target schemas** — would reject the `{}` normalization for unconfigured fields too, breaking the documented optional semantics; rejected.
- **Ignore half-specified targets silently** — contradicts the load-time fail-loud convention; rejected in favor of a dedicated error.

## Consequences

Source/dev boots of the desktop shell and the `base` bundle load `self-evolve-basic` again; deployments that configure neither target no longer trip the drift guard; a target with only one of `provider`/`model` now fails load with a precise message instead of silently carrying a broken route. A regression test covers the schema-normalized empty-target path (`BasicSelfEvolveEngine.Config(baseConfig())` must not throw and the drift-guard test for equal configured targets stays green); 43 provider tests pass.
