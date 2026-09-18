# Agent Note: the build-allowlist config homes behind the dsh plugin failure hints

Status: implemented

English | [中文](2026-09-02-pnpm-plugin-failure-hint-config-homes.zh.md)

## Problem

Installing a git-hosted plugin into a profile (`dsh plugin --profile web add github:guchang/draw2code#…`) failed twice in practice, and the forwarder's failure hint misdirected both times. The hint said to add the key pnpm printed under `allowBuilds` in the profile's `pnpm-workspace.yaml`. On pnpm 10.34.x that config is never consulted for this check: the git-hosted prepare enforcement reads the profile `package.json`'s `pnpm.onlyBuiltDependencies` — while the same pnpm binary also warns that the `pnpm` field "is no longer read" — and it matches only dependency-path-shaped keys (`name@<tarball-url>` or `name@git+ssh://…#sha`); bare package names do not match a git-hosted dependency, and neither `allowBuilds` entries nor workspace-file lists reach that check. Both real installs converged only after writing the depPath keys pnpm printed into the profile `package.json` field.

The hint also had the wrong trigger: it keyed on the forwarded spec looking git-shaped. A second real failure, `ERR_PNPM_UNEXPECTED_STORE` (the desktop profile's node_modules was linked by pnpm 10 while the repository pin had moved to pnpm 11), hit a `github:` spec in argv — the spec-shaped trigger would have fired the allowlist hint there, misdirecting a store problem as an allowlist problem, while a registry package whose transitive git dependency needs prepare would get no hint at all.

## Decision

[apps/cli/src/plugin.ts](../../../../apps/cli/src/plugin.ts) captures pnpm's stderr (echoing it back verbatim so pnpm's own diagnostics stay visible; stdout stays inherited so progress and interactive pnpm flows keep their live rendering) and derives hints from the captured error text via the exported `pnpmFailureHints(stderr, dir)`, not from the forwarded spec shape. `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` yields a hint that names the exact key form and points at `"pnpm.onlyBuiltDependencies"` in the profile `package.json`, noting that pnpm 10 enforces the allowlist from there even though its own output points at `pnpm-workspace.yaml`. `ERR_PNPM_UNEXPECTED_STORE` yields a hint naming the two resolutions: run the pnpm major that installed the profile, or migrate with `pnpm install` in the profile directory. Any other failure prints no hint.

## Alternatives considered

- **Keep the argv-shaped git-spec trigger** — rejected: the failure cause is independent of the spec shape. The desktop-profile draw2code install hit `ERR_PNPM_UNEXPECTED_STORE` with a `github:` spec in argv, where a spec-shaped hint misdirects, and a registry package with a transitive git dependency gets no hint at all.
- **Point the hint at `allowBuilds` as pnpm's messages suggest** — rejected: measured against pnpm 10.34.5, `allowBuilds` entries and workspace-file lists do not reach the git-hosted prepare enforcement; only the `package.json` `pnpm.onlyBuiltDependencies` array does.

## Consequences

`dsh plugin` failures carry an actionable hint for the two blocking classes observed in practice and stay silent otherwise, so the hint never competes with an unrelated cause. The git hint text documents pnpm's self-contradictory 10.34 behavior — warning that the `pnpm` package.json field is unread while enforcing this allowlist from it — so a future pnpm that makes `pnpm-workspace.yaml` (or `allowBuilds`) the real enforcement home again needs a matching update to the hint and the test in [apps/cli/tests/plugin-failure-hints.spec.ts](../../../../apps/cli/tests/plugin-failure-hints.spec.ts).
