# Agent Note: Adopt better-sidebar first-party

Status: implemented

English | [中文](2026-08-28-adopt-better-sidebar-first-party.zh.md)

## Problem

The web GUI's VSCode-like workspace sidebar — explorer, editor, per-session terminals, git, side chat, subagent previews, browser — existed only as the external MIT npm plugin `dsh-better-sidebar` (omdsh-dev, 0.17.1) consumed through profile layers. That arrangement failed three desktop requirements:

- Packaged desktop releases must ship every mounted plugin inside the deployed backend tree, offline. A profile-layer plugin requires a `pnpm install` against the profile at deployment time, which a packaged desktop app cannot do.
- The upstream dependency ranges moved per release (node-pty, the optional `@huanlin` better-locale peer), so a packaged tree pinned against upstream could break independently of this repository.
- The harness could not own fixes, contracts, or tests for code it did not carry.

## Decision

The plugin is adopted first-party as `@deepseek-ai/dsh-better-sidebar` at `packages/client/better-sidebar` on the source plane: all peers resolve from the workspace, ending the per-release npm peer-range churn, and the upstream MIT LICENSE file is preserved.

The desktop composition mounts it by default: the `dsh-desktop-app` bundle patch (`packages/bundle/desktop-app/cordis.patch.yml`) inserts the `better-sidebar` row; a browser `dsh web` composition mounts nothing, and any deployment opts out with a `- id: better-sidebar, disabled: true` row in its own profile patch, which applies after the desktop-app layer.

The packaged desktop deploy tree carries the package in the same change: `@deepseek-ai/dsh-better-sidebar` is an `apps/cli` production dependency, and `REQUIRED_BACKEND_PATHS` in `scripts/desktop-package.ts` requires `node_modules/@deepseek-ai/dsh-better-sidebar/package.json`, so an incomplete deploy tree fails the packaging check instead of booting short.

node-pty stays locked to the workspace-pinned `1.2.0-beta.15` — the exact range `@deepseek-ai/dsh-subprocess-local` declares — so pnpm resolves one physical native binding for both consumers, and the plugin's contract test compares its declaration against `dsh-subprocess-local`'s own `package.json`.

Data-plane identifiers keep the historical name on purpose: the settings namespace `dsh-better-sidebar` and the side-chat context-injection marker `dsh-better-sidebar` persist in user settings and session logs shared across profiles, so they were not rescoped even though the package name was.

## Alternatives considered

- **Keep consuming the upstream npm plugin through profile layers.** Lost: per-release peer-range churn, a distribution channel this repository does not operate, and no offline path for packaged desktop releases.
- **Rescope the data-plane identifiers together with the package name.** Lost: the namespace and marker live in durable user settings and session logs shared across profiles; renaming would orphan existing settings sections and mislabel historical side-chat injections.
- **Vendor the upstream AGPL-3.0 office-preview extension alongside.** Lost: license incompatibility with the first-party tree; it stays external and unmounted, reachable only as a separately installed external plugin.
- **Carry upstream's 19 third-party locale dictionaries and the optional `@huanlin` better-locale peer.** Lost: this repository's client UI copy convention is bilingual zh/en; extra locales remain external work.
- **Port upstream's artifact-plane chunk-artifact spec and Playwright e2e lane.** Lost: the source-plane rule — the artifact plane it describes belongs to upstream's bundler; here the client bundle pipeline and the plugin's `/sidebar/bundle` route own chunk delivery, and behavior specs own verification.

## Consequences

The durable consequence is the deployment one: desktop releases ship the sidebar offline, with no profile `pnpm install` and no dependence on upstream npm state. The sidebar became a desktop default that any profile can disable with one patch row, while browser `dsh web` compositions stay sidebar-free unless they insert the row themselves.

The upstream-only channels are gone by construction: distribution happens only through composition rows, and the dropped surface — the plugin-registry channel (`dsh.plugin.json` + `client-registry.js` bundle), third-party locale dictionaries, and the AGPL office extension — can return only as deliberate first-party or external work, not as upstream drift.
