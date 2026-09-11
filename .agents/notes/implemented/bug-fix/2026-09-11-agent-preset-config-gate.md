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

`scripts/verify-agent-preset-config.ts` applies the schema the loader applies, before mount. It judges every row of every shipped preset, recursing the containers the loader recurses: a group's `config` list, an `insert` list, and the `insert` lists of an `@deepseek-ai/cordis-plugin-include` row's patches.

The verdict mirrors the runtime in three places, and each mirror is load-bearing. The plugin value comes from `exports.default ?? exports` and its `__esModule` repeat, the way `unwrapExports` reads it — a named `Config` beside a default export is not the schema the runtime applies. A plugin exporting no `Config` passes, as `resolveConfig` returns the config unchanged. The call is `schema['~standard'].validate(config)`, the expression `resolveConfig` evaluates, so a gate message matches the runtime's `ValidationError` line for line.

A row is skipped rather than judged when the loader would decide it somewhere this gate cannot reach: a `!!js` expression anywhere in the config (interpolated against a live plugin context before the schema sees it), a truthy `disabled`, a specifier that is not a workspace package, a specifier that does not resolve through the tsconfig `paths` facade to TypeScript source, a module Node cannot import, and a plugin exporting no `Config`. Skipped rows are counted by reason, because a preset whose rows were all skipped says nothing about the repository.

Corpus floors keep a passing run honest: an empty shipped-preset glob throws, and a preset where no row was validated fails the gate. `scripts/verify-agent-preset-config.spec.ts` pins the boundary table, and `mount.spec.ts` gains a `stale-persona` fixture preset that carries `text` and asserts the mount refuses it with `$.prefix missing required value` — evidence that the gate's rule is the runtime's rule.

The repository root is scanned by default. `$DSH_HOME/.agent-presets` is scanned only under `--home` (`pnpm run verify-agent-preset-config:home`), because that directory is machine state and the documentation aggregate that runs this gate in CI must pass on a clean tree.

## Alternatives considered

**Extend `discoverPresets` health to validate each row's config.** Rejected: discovery deliberately never imports a plugin, which is what keeps a roster read to filesystem lookups. Validation needs the plugin's `Config`, so it needs the module loaded, and a roster read would then execute arbitrary plugin top-level code on every call.

**Resolve workspace packages with `import.meta.resolve`.** Rejected: it sees a workspace package only while the `tsx` paths hook is active. Under plain Node the root `node_modules/@deepseek-ai` holds four links, so every row would resolve nowhere, be skipped, and the gate would report success for having checked nothing. `ts.resolveModuleName` against `tsconfig.base.json` is deterministic and cwd-independent.

**Fail the gate when a plugin module will not import.** Rejected: four workspace client packages import a `.module.css` file, which Vite handles and Node does not. That is a property of the module graph, not a defect in the preset, and a gate that reds on it teaches people to ignore it.

**Scan the harness-home preset root by default.** Rejected: `pnpm run test:docs` runs this gate in CI, and a developer's in-progress preset would turn the repository's documentation check into a statement about one machine.

**Validate unparsed `!!js` nodes with a placeholder substituted for the expression.** Rejected: no placeholder satisfies an arbitrary schema, so the substitution produces false violations for healthy presets — and `agent-presets` surfaces a broken verdict by making the preset unselectable and uncopyable.

## Consequences

A renamed or removed config field now fails in CI rather than in a running deployment, for the six shipped presets and, on demand, for presets authored under `$DSH_HOME`.

What the gate proves is narrower than "the config is correct". schemastery merges unknown keys instead of rejecting them, so a misspelled OPTIONAL key passes here exactly as it passes at runtime; the gate covers a missing required key and a wrong type on a known key. Coverage is also partial by construction: 30 of the 43 modules named by shipped rows export no runtime `Config` at all — mostly the `tool-*` rows — so a shipped run validates 76 of 154 rows and reports the other 78 as skipped rather than silently counting them as clean.

The gate costs a plugin import per distinct named module, a few seconds for the shipped set, and runs in the build-free documentation aggregate. Importing plugin sources prints their own stderr warnings, one of them `ExperimentalWarning: SQLite` from `patent-knowledge`; the gate reports on stdout and is read by exit code.

## Testing

`npx vitest run scripts/verify-agent-preset-config.spec.ts` (28 tests) pins the boundary table: `!!js` in config and in `disabled`, `disabled: 0` judged against `disabled: true` skipped, group recursion including a nested group, group rows never judged by their own `cordis:group` name, external and unimportable and schema-less rows counted by reason, a missing required key, a wrong type, an unknown key accepted, the corpus floors, and the real `dsh-persona` schema refusing `text` while accepting `prefix`.

`npx vitest run packages/preset/agent-presets` (187 tests) covers the mount regression. Reverting a shipped preset's persona row to `text` and running the gate reports `$.prefix missing required value` at the row's line and exits 1.

## Related

- [Restore the fork presets' persona row to the current field names](2026-09-10-persona-config-field-in-fork-presets.md) — the incident whose coverage gap this closes.
- [Agent preset discovery](../../../../packages/preset/agent-presets/README.md) — the health check this gate sits beside rather than extends.
