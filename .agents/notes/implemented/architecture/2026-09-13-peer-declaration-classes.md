# Agent Note: Mount specifiers stay peers; type-only service edges do not

Status: implemented

English | [中文](2026-09-13-peer-declaration-classes.zh.md)

## Problem

The 2026-09-11 sweep recorded a Client↔Host peer interlock and found it one-directional: `@deepseek-ai/dsh-client-connection` no longer peers any Host package, while Host packages still peer browser-side ones. Issue #96 named three declarations to re-characterize: the two client surfaces of [`directory-picker-auto`](../../../../packages/host/directory-picker-auto/package.json), the `connection` peer of [`frontend-static`](../../../../packages/host/frontend-static/package.json), and the DeepSeek adapter peer of [`sdk-jsonrpc-server`](../../../../packages/sdk/server/package.json).

The same issue asked the group map's `util/` row to match the group's real dependency set. It claimed "no runtime dependencies, invariant-companion peer only", while `chunked-list` carries `zod`, `http-proxy` carries `undici`, and `output-retention` and `value` carry `dsh-util-values`; no `util/` package peers `dsh-invariants` at all, and the one that names it ([`http-proxy`](../../../../packages/util/http-proxy/package.json)) does so as a test dependency.

## Decision

- **The chooser's four peers are runtime mount specifiers, and they stay.** `BACKEND_PACKAGES` and `SURFACE_PACKAGES` hold package *names*; nothing in this package imports them, and `apply` mounts the resolved pair through `ctx.loader.create({ name })`. The Loader resolves a bare specifier against the composing root's `baseUrl` (`vendor/loader/src/config/tree.ts:151-168`), not against this package's own `node_modules`, so the composition's manifest is what makes the mount resolvable — and `verify-cordis-config` extends its requirement from the chooser to all four packages (`scripts/verify-cordis-config.ts:436-437`), because keyless Linux CI only ever resolves `browse` and would otherwise hide a dropped `-native`. The peers state the same requirement from the plugin's side, next to the Host backends the package's own loader-composition suite imports for real while it mounts loader-visible stand-ins for the two client surfaces. The requirement is now recorded in the package README.
- **`frontend-static` keeps the development declaration and drops the peer.** The edge is an empty type-only import whose only job is to load the `connection` `Context` merge — declared in the connection package's host face (`packages/client/connection/src/rpc-host.ts:53`), which this package's tsconfig already references — and the service itself arrives through `inject`, never through the module. A fresh host-face declaration emit carries no mention of the package, which is why the edge needs no install-plane declaration: [published dependency faces](../process/2026-08-26-published-dependency-faces.md) puts "type-only imports … and existing metadata-only peers … only in `devDependencies`", and the two Host packages consuming the same two services, [`api/gateway`](../../../../packages/api/gateway/package.json) and [`open-in-app`](../../../../packages/host/open-in-app/package.json), already declare them dev-only. The in-source merge import gains the comment its sibling packages carry.
- **`sdk-jsonrpc-server` keeps its DeepSeek adapter peer.** `import * as LlmDeepSeek` is a real value import mounted as a plugin, and it is mounted exactly when no adapter owns the route (`packages/sdk/server/src/server.ts:150-153`): adapter selection belongs to the composition, which in the shipped profile composes its own `llm-deepseek` row (`packages/bundle/sdk-minimal/cordis.patch.yml:26-27`). Keeping the edge in `peerDependencies` leaves that choice with the composition instead of pinning an adapter into every install, and the README now states the reason beside the fallback it describes.
- **The `util/` row states the measured set.** It replaces both claims — the group registers no product service or event, and its runtime dependencies are `zod`, `undici`, and `dsh-util-values`, each inside the primitive that needs it.

## Alternatives considered

- **Sink the shared wire types into a package of their own**, the issue's second path. Rejected: the two edges are not one shape. The chooser carries no wire type, only specifier strings, and the connection edge's type is the Host-half Service Definition of a package that already publishes a host face for it; a new package would separate that definition from its provider to serve a type that never reaches an artifact.
- **Declare the chooser's mount targets as dependencies.** Rejected: they are not imports, and under pnpm's strict layout a dependency lands in this package's own `node_modules`, which is not on the resolution chain that starts at the composing root's `baseUrl` — the composition's declaration is the one that works, which is what the config gate enforces.
- **Drop the chooser's two client-surface peers to finish de-interlocking the groups.** Rejected: the four names are one mount vocabulary, and removing half of it would leave the client half declared only by the composing application while the Host half stayed declared twice.
- **Move `frontend-static`'s `host-webserver` peer along with `connection`.** Deferred: the same class applies to that peer, and to the same peer in six other packages outside the dependency policy's scope (`directory-picker-auto`, `experimental/inspector`, `experimental/webworker-runtime`, `memory/openviking`, `web/synapse`, `webhook/webhook-github`); sweeping them is a policy extension with its own blast radius, and issue #96 asks about the Client edge.

## Consequences

`frontend-static` no longer peers a browser-side package: its peers are `host-webserver` and cordis, and its published declaration never named `client-connection` to begin with, so no consumer installs anything differently. The remaining Host→Client peer edges are the chooser's two client surfaces, which are mount specifiers rather than type edges and are now documented as such in the package they belong to. The `host-webserver` peer class across seven uncovered packages stays as it is, recorded here as a candidate sweep rather than fixed in half.

No gate reads the plugin-side peer list: the composition side is enforced by `verify-cordis-config`, while a plugin that drops a mount target from its own peers stays green until a deployment mounts it. That asymmetry is the reason the four names are documented in the README instead of left to the manifest.

## Testing

A host-face declaration emit for `frontend-static` after deleting `lib/tsconfig.tsbuildinfo` and `lib/types/index.d.ts` produces an `index.d.ts` with zero occurrences of `dsh-client-connection`, so the dropped edge is provably outside the published artifact. Removing it from `peerDependencies` leaves `pnpm install --lockfile-only` reporting "Already up to date", and the one added source comment shifts that package's `Config` pointer in the generated configuration catalog from 30 to 31, mirrored in the Chinese twin and re-recorded in its pairing file. `verify-cordis-config`, the `frontend-static` and `directory-picker-auto` suites, `typecheck`, lint, `duplication`, and the documentation aggregate are the checks this change must keep green.

## Related

[Published dependency faces](../process/2026-08-26-published-dependency-faces.md) owns the dependency-section policy this ruling applies. [Cross-boundary declarations](../bug-fix/2026-09-12-cross-boundary-declarations.md) measured which type imports reach a published declaration, the measurement reused here.
