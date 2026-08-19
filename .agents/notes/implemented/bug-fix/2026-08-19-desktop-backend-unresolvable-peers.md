# Agent Note: packaged backend drops peer-provided runtime imports

Status: implemented

English | [中文](2026-08-19-desktop-backend-unresolvable-peers.zh.md)

## Problem

The installed desktop app failed at startup with `dsh backend exited before reporting a URL (code 1, signal null)`: the backend child process exited during boot, before printing the `dsh web:` readiness line the shell waits on. Running the packaged backend directly showed the underlying error: `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/cordis-plugin-group'` from `dsh-app-boot`, then (after that was fixed) the same class of failure from `dsh-llm` (`@deepseek-ai/dsh-timeout`) and many more.

The workspace boots fine because pnpm links resolvable peers into each workspace package's own `node_modules`. The packaged backend is built by `pnpm deploy --prod` of `@deepseek-ai/dsh` (`scripts/desktop-package.ts`), which materializes only the dependencies closure of the cli. Harness packages declare shared seam and definition packages (capability service definitions, `dsh-scope`, `dsh-timeout`, the vendored cordis plugins, ...) as `peerDependencies`, so any peer the cli does not also declare as a dependency is dropped from the deployed tree, and the first module that statically imports it dies at load.

## Decision

1. `apps/cli` now declares every runtime-imported peer its profile graph needs as a `dependencies` entry: `@deepseek-ai/cordis-plugin-group` (the missing sibling of the four cordis plugins `dsh-app-boot` already declared as peers) plus 19 shared seam/definition packages (`dsh-anonymous-user-id`, `dsh-atomic-write`, `dsh-bash-local`, `dsh-code-runtime`, `dsh-compaction`, `dsh-fs`, `dsh-output-retention`, `dsh-patent-core`, `dsh-patent-data`, `dsh-sandbox`, `dsh-scope`, `dsh-session-telemetry`, `dsh-session-title-llm`, `dsh-shell`, `dsh-spill`, `dsh-subagent-in-process-driver`, `dsh-subprocess`, `dsh-timeout`, `dsh-workflow`). The cli is the deploy root and the aggregator every profile boots from, so providing the shared peers there matches how the cordis plugins were already handled.

2. `scripts/desktop-package.ts` now verifies the deployed tree resolves every `@deepseek-ai/*` specifier its own code imports. `findUnresolvableBackendImports` scans the deployed `lib/` and every `@deepseek-ai` store package for static imports, then resolves the specifiers with an `--eval` subprocess whose working directory is the deployed tree (see Alternatives), and `prepareDesktopResources` fails loud listing each missing specifier with the files that import it. `REQUIRED_BACKEND_PATHS` also gained the five vendored cordis plugin paths.

## Alternatives considered

- **Declare the shared packages as `dependencies` of the packages that import them** (e.g. `dsh-llm` → `dsh-timeout`) — correct per package-manager conventions, but the peer pattern is a deliberate singleton contract for capability seams across dozens of packages, and the change would touch every seam consumer. Rejected as the larger blast radius.
- **Restore the removed `.pnpm/node_modules` store mirror** — it was deleted deliberately because electron-builder compressed the whole store twice. Rejected.
- **Resolve with `import.meta.resolve(specifier, parent)` in the packager** — Node ≤ v22.22 ignores the explicit `parent` argument and resolves from the calling module, which made the first gate implementation check the repo-root `node_modules` instead of the deployed tree and false-positive on `@deepseek-ai/nuo-patent` (present in the tree, absent from the root). The `--eval` subprocess with `cwd` set to the deployed tree resolves from the tree's own `node_modules` chain, the same chain boot-time resolution walks.

## Consequences

The packaged desktop backend boots and prints `dsh web: http://127.0.0.1:PORT`, so the shell loads the UI again; the identical latent gap in the published npm `@deepseek-ai/dsh` package is fixed by the same dependency declarations. A future dropped peer now fails the packager (`package:desktop:*`) at prepare time with the specifier and importing files instead of reaching users as an opaque boot exit. The gate costs roughly two seconds of the prepare step. It checks `@deepseek-ai/*` imports; imports of external packages (e.g. `schemastery`, `cordis`) resolve through pnpm's normal dependency closure and are not scanned, and a bundle row referencing a plugin outside the scanned set must add its package path to `REQUIRED_BACKEND_PATHS` in the same change (the constant's comment is the maintenance contract).
