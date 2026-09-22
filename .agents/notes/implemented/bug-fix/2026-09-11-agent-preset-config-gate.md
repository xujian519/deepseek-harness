# Agent Note: Gate preset rows whose config their plugin rejects

Status: implemented

English | [中文](2026-09-11-agent-preset-config-gate.zh.md)

## Problem

`dsh-agent-presets` judges a preset's health by composition shape and by whether each row's package resolves. It never applies a row's config to the schema of the plugin that row names, and the roster therefore reports a preset healthy while the loader refuses it at mount:

```
agent-presets: preset "patent-media" failed to mount: failed to apply loader entry persona
(@deepseek-ai/dsh-persona): invalid config: $.prefix missing required value
```

The [2026-09-10 persona field rename](2026-09-10-persona-config-field-in-fork-presets.md) closed that gap for the two presets it touched and named the coverage it left open: `mount.spec.ts` boots fixture presets only, and `shipped-root.spec.ts` reads the shipped root's structure without validating an entry's config against the named plugin's schema. A preset carrying a renamed or removed field therefore fails in a running deployment instead of in CI.

On 2026-09-11 that reached a person: an authored preset at `$DSH_HOME/.agent-presets/patent-media` still spelled `text`, so the desktop application could not mount the preset its owner selected. Nothing in the repository could have reported it — the file lives outside the repository, and the check that would have caught it did not exist for shipped presets either.

## Decision

`scripts/verify-agent-preset-config.ts` applies the schema the loader applies, before mount. It judges every row of every shipped preset declaration — the files matching `packages/bundle/web-app/presets/*.patch.yml` — recursing the row containers the loader recurses: a group's `config` list, a patch file's `insert` list, and an agent-preset declaration's `config.plugins`. A declaration is judged like any other row, and the child composition it carries is judged beside it.

The verdict mirrors the runtime in three places, and each mirror is load-bearing. The plugin value comes from `exports.default ?? exports` and its `__esModule` repeat, the way `unwrapExports` reads it — a named `Config` beside a default export is not the schema the runtime applies. A plugin exporting no `Config` passes, as `resolveConfig` returns the config unchanged. The call is `schema['~standard'].validate(config)`, the expression `resolveConfig` evaluates, so a gate message matches the runtime's `ValidationError` line for line.

A row is skipped rather than judged when the loader would decide it somewhere this gate cannot reach: a `!!js` expression anywhere in the config (interpolated against a live plugin context before the schema sees it), a truthy `disabled`, a specifier that is not a workspace package, a specifier that does not resolve through the tsconfig `paths` facade to TypeScript source, a module Node cannot import, and a plugin exporting no `Config`. Skipped rows are counted by reason, because a preset whose rows were all skipped says nothing about the repository.

Corpus floors keep a passing run honest: an empty shipped-preset glob throws, and a declaration where no row was judged at all — neither validated nor rejected — fails the gate, so an all-skipped preset cannot pass for a clean one. A declaration whose only judged row violated the schema is not unjudged; its violation is reported, the two findings print in the same run, and either one exits 1. `scripts/verify-agent-preset-config.spec.ts` pins the boundary table, and its last case holds the gate against the real `dsh-persona` `Config`: `text` refused with `$.prefix missing required value`, `prefix` accepted.

The corpus is exactly what the repository ships. Preset authoring is now a bundle patch a user installs into a profile, so there is no author directory left for this gate to scan — and the documentation aggregate that runs it in CI must pass on a clean tree, which a machine-owned corpus could not.

## Alternatives considered

**Extend `discoverPresets` health to validate each row's config.** Rejected: discovery deliberately never imports a plugin, which is what keeps a roster read to filesystem lookups. Validation needs the plugin's `Config`, so it needs the module loaded, and a roster read would then execute arbitrary plugin top-level code on every call.

**Resolve workspace packages with `import.meta.resolve`.** Rejected: it sees a workspace package only while the `tsx` paths hook is active. Under plain Node the root `node_modules/@deepseek-ai` holds 15 links against the 360 packages the gate's globs cover, so most rows would resolve nowhere, be skipped, and the gate would report success for having checked a small fraction of the corpus. `ts.resolveModuleName` against `tsconfig.base.json` is deterministic and cwd-independent.

**Fail the gate when a plugin module will not import.** Rejected: four workspace client packages import a `.module.css` file, which Vite handles and Node does not. That is a property of the module graph, not a defect in the preset, and a gate that reds on it teaches people to ignore it.

**Validate unparsed `!!js` nodes with a placeholder substituted for the expression.** Rejected: no placeholder satisfies an arbitrary schema, so the substitution produces false violations for healthy presets — and a broken verdict reaches the chooser, where the preset carries a failed-to-load badge and cannot be selected as the default.

## Consequences

A renamed or removed config field now fails in CI rather than in a running deployment, for the six shipped preset declarations. A declaration a user installs from outside the repository stays outside this gate; the registry reports its activation failure as a broken roster row, which is the failure mode this gate exists to move earlier.

What the gate proves is narrower than "the config is correct". schemastery merges unknown keys instead of rejecting them, so a misspelled OPTIONAL key passes here exactly as it passes at runtime; the gate covers a missing required key and a wrong type on a known key. Coverage is also partial by construction: 48 of the 168 shipped rows name a module that exports no runtime `Config` at all, 32 sit behind a truthy `disabled`, and 11 carry a `!!js` expression, so a shipped run validates 77 rows and reports the other 91 as skipped rather than silently counting them as clean.

The gate costs a plugin import per distinct named module, a few seconds for the shipped set, and runs in the build-free documentation aggregate. Importing plugin sources prints their own stderr warnings, one of them an `ExperimentalWarning: SQLite` from a plugin reaching `node:sqlite`; the gate reports on stdout and is read by exit code.

## Testing

`npx vitest run scripts/verify-agent-preset-config.spec.ts` (33 tests) pins the boundary table: `!!js` in config and in `disabled`, `disabled: 0` judged against `disabled: true` skipped, group recursion including a nested group, group rows never judged by their own `cordis:group` name, an `insert` list and a declaration's `config.plugins` recursed with the declaration judged by its own schema beside its children, a declaration carrying `!!js` still judging its children, external and unimportable and schema-less rows counted by reason, a missing required key, a wrong type, an unknown key accepted, the corpus floors — including a composition whose only judged row violated staying out of the unjudged list — and the real `dsh-persona` schema refusing `text` while accepting `prefix`.

`npx vitest run packages/preset/agent-preset-registry` (42 tests) covers the mount and roster path this gate depends on, and `npx vitest run packages/bundle/web-app/tests/patent-preset.spec.ts` (3 tests) keeps the fork's patent composition assertions on the declaration that now ships it. Reverting a shipped declaration's persona row to `text` and running the gate reports `$.prefix missing required value` at the row's line and exits 1.

## Related

- [Restore the fork presets' persona row to the current field names](2026-09-10-persona-config-field-in-fork-presets.md) — the incident whose coverage gap this closes.
- [Agent preset registry](../../../../packages/preset/agent-preset-registry/README.md) — the activation and roster path this gate sits beside rather than extends.
