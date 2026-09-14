# Agent Note: Repository scanners exclude oxlint-contract test probes

Status: implemented

English | [中文](2026-09-14-oxlint-contract-probe-race.zh.md)

## Problem

`scripts/oxlint-contract.spec.ts` writes temporary probe files named `oxlint-contract-*` into real package source and test directories to verify that oxlint discovers the correct TypeScript project for each file class. The probes are deleted in the test's `finally` block.

While the probes exist, other specs that concurrently scan the repository and read every matching file can hit a deleted probe between their `globSync` and `readFileSync` calls, throwing:

```
Error: ENOENT: no such file or directory, open '.../src/oxlint-contract-<uuid>.ts'
```

This is a load-sensitive race: `pnpm exec vitest run scripts/` reproduced it locally, with different failing specs on different runs (`gen-client-catalog.spec.ts`, `verify-application-entrypoints.spec.ts`, and `verify-suppression-reasons.spec.ts`).

## Decision

Every repository scanner that walks the paths where probes appear now filters out paths containing `oxlint-contract-`. This matches the existing `.gitignore` and `.oxlintrc.json` ignore patterns that already treat these files as test-only scratch files.

Scanners updated:

- `scripts/slot-walk.ts` — `scanSlotFiles` and `indexExportedTypes`
- `scripts/verify-application-entrypoints.ts` — `SOURCE_EXCLUDES`
- `scripts/verify-suppression-reasons.ts` — `scanRepository` glob exclude
- `scripts/verify-client-ui-i18n.ts` — `sourceFiles`
- `scripts/verify-no-bare-dispatcher.ts` — `scanRepository`

## Alternatives considered

**Move probes into a temporary directory with synthetic tsconfigs.** Rejected: the test's purpose is to verify that oxlint discovers the owning TypeScript project for each real file class, which requires the probes to live under the real package paths so the correct `tsconfig.json` is resolved.

**Run `oxlint-contract.spec.ts` in a sequential pool.** Rejected: the repository's testing policy treats specs as isolated units that must own their temporary paths; serializing one spec because it leaks files into shared directories hides the leak instead of fixing it.

## Consequences

`pnpm exec vitest run scripts/` is stable under repeated local runs. The scanners continue to see every real repository file; the only excluded paths are transient probe files that are already ignored by git and oxlint.

## Testing

`pnpm exec vitest run scripts/` passed three consecutive local runs after the change. The race previously reproduced on the first run.

## Related

- Issue #132 — the bug report this change closes.
- `.oxlintrc.json` ignore patterns for `oxlint-contract-*` files.
- `.gitignore` entries for `oxlint-contract-*` files.
