# Agent Note: Aggregate configs seed face configs, never package-root solutions

Status: implemented

English | [中文](2026-08-29-aggregate-configs-seed-face-configs.zh.md)

## Problem

Adopting better-sidebar added its package-root `tsconfig.json` — a solution referencing both face configs — to the root `tsconfig.host.json`. `tsc -b` builds the transitive closure of references, so the host face compiled the plugin's client face and, through its references, the api client faces. On a clean tree the api client code imports its own `./remote` subpath, which resolves to the typert-generated `lib/typert.remote-client.d.ts` that only the host bundling stage emits later, so every `ClientResult` collapsed to `unknown` and CI's typecheck step failed. Local incremental state (an existing `lib/` tree) masked the failure completely: only a cold build reproduced it.

## Decision

**Repository aggregate configs (`tsconfig.host.json`, `tsconfig.client.json`) reference face-specific leaf configs only.** A package-root solution config that references multiple faces is an editor and tooling convenience; it must never enter a build graph. Each aggregate compiles exactly one face, and the generated artifacts the client face resolves against (`lib/typert.remote-client.d.ts`, `lib/invariant.js`) exist by the time the client aggregate runs, because the host pass always precedes it.

Registering a new client service in the generated catalogs carries the same face discipline end to end: the service needs a subsystem page, a doc-graph role classification, catalog type-link classifications, and complete export JSDoc before any generator accepts it, and its node-half lib bundle must run in the Client pass exactly as the shared preset's face contract does.

## Consequences

Aggregates compile one face per invocation, so a cold `typecheck` costs two passes where one closure previously appeared to suffice; in exchange every pass stays under the artifact ordering it can rely on. A new dual-face package that seeds an aggregate with its root config reproduces the CI failure class immediately instead of silently compiling half the client graph into the host program.

## Alternatives considered

**Teach the build to tolerate the ordering gap** (lazy `/remote` resolution or building typert artifacts first). Rejected: it widens the host program to the whole client graph and makes the host build depend on client-face well-formedness, so any client regression blocks the host pass with an unrelated-looking error.

**Restrict package-root solution configs to a single face reference.** Rejected: the two-face solution is genuinely useful for editor tooling, and the failure was the aggregate seeding the wrong node, not the solution existing.


## Verification

With every `lib/` tree removed, `pnpm run typecheck` passes with the face-seed fix and fails without it, reproducing the CI signature (the api client-face `TS2307`/`TS18046` cluster) exactly. The catalog, graph, pairing, JSDoc, and hygiene gates pass on the branch.
