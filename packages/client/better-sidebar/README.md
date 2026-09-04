---
description: "VSCode-like right sidebar for the dsh web GUI: explorer, editor, terminal, git, side chat, subagent, and browser tabs isolated per conversation session, mounted by default in the desktop composition and extendable by other client plugins through the ctx.betterSidebar tab and file-viewer registry."
kind: "package-reference"
---

# @deepseek-ai/dsh-better-sidebar

English | [中文](README.zh.md)

## Summary

`dsh-better-sidebar` gives the dsh web GUI a VSCode-like right workspace: a file explorer, a CodeMirror editor, per-session terminals, a git panel, side-chat child conversations, live subagent previews, and an embedded browser, all scoped to the conversation that is open. Every file, git, and terminal operation runs against the open session's working directory through host routes fenced like the `/api` gateway, so switching conversations switches the whole workspace; terminals, tabs, and drafts stay with their own session. The package is dual-face: the host half mounts the fenced `/sidebar/*` routes with node-pty terminals and opt-in `terminal_*` tools, and the browser half renders the panel and publishes a client service other client plugins use to register sidebar tabs and file viewers. The desktop composition mounts the plugin by default; a browser `dsh web` composition does not. The package was adopted first-party from the MIT-licensed `dsh-better-sidebar` 0.17.1 by omdsh-dev, and the MIT LICENSE file is preserved.

No runtime invariant companion is published; the sidebar owns no service state or event protocol of its own — every route is mounted under the host's webServer fence, and the pty lifecycle, store semantics, and route fence are each observed through their seams.


## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The sidebar is a desktop default: the [desktop composition patch](../../bundle/desktop-app/cordis.patch.yml) inserts the `better-sidebar` row, and the panel appears beside the conversation with no wiring. Compositions that want it elsewhere insert the same row themselves; a deployment that does not want it on desktop disables that row from its own profile patch.

### When to choose it

Choose the sidebar when a workspace beside the conversation helps: reading and editing produced files, running commands, inspecting git state, or opening a side conversation without leaving the session. Skip it in headless compositions (it registers nothing without the web GUI) and when another right panel owns the slot: selecting the `aionui-panel` provider in its settings namespace keeps the sidebar unmounted.

### Minimal configuration

The desktop default needs no configuration. A browser or custom composition mounts the plugin with an insert row, and a profile can disable the desktop default, which applies after the desktop-app layer:

```yaml
# Mount in a composition without the desktop bundle:
- insert:
    - id: better-sidebar
      name: '@deepseek-ai/dsh-better-sidebar'

# Opt out of the desktop default from a profile patch:
- id: better-sidebar
  disabled: true
```

Host limits ride the row's `config` block:

| Field | Default | Meaning |
|---|---|---|
| `readLimit` | 512 KiB | Read cap of one text file (bytes); larger files return truncated |
| `mediaLimit` | 20 MiB | `/sidebar/file` media cap (bytes); larger binaries are refused |
| `uploadLimit` | 128 MiB | `/sidebar/upload` cap (bytes); larger files are refused |
| `listLimit` | `1000` | Explorer rows per directory level |
| `terminalsPerSession` | `3` | Terminal tabs per conversation session |
| `reconnectGraceMs` | `30000` | How long a disconnected terminal survives awaiting a reconnect |
| `shell` | `''` (auto) | Terminal shell for UI tabs and `terminal_*` tools; empty auto-resolves per platform |
| `shellArgs` | `[]` | Extra shell arguments; non-empty replaces the platform defaults |

The generated [configuration catalog](../../../docs/config-catalog.md) is the exhaustive source for every accepted field.

User-facing "Side card" preferences (open-by-default, width, auto-open switches, terminal font, the `agentTerminalTools` and `agentOpenTools` tool switches) live in the `dsh-better-sidebar` settings namespace. The sidebar's own settings page renders and persists them; the browser reaches the namespace through the plugin's fenced `settings.get`/`settings.update` routes rather than the allowlisted settings RPC domain.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the two halves are built; observable behavior is covered in [Use this package](#use-this-package).

### Dual-face design

The host half (`apply` in [`src/index.ts`](src/index.ts), injecting `webServer`, `sessions`, `webRuntime`, and `tools`) mounts every route under `/sidebar/*` behind the same trust fence the `/api` gateway derives from — Host-header loopback or the web runtime's `trustedHosts`, re-read per request. The browser half is a `dsh.client` bundle served through the client-modules roster like every client plugin; its lazy feature chunks are separate scripts fetched from the plugin's own `/sidebar/bundle` route and materialized from the `globalThis.__dshChunks__` registry, so CodeMirror, xterm, and mermaid load on first use.

### Session scoping and the workspace fence

Every request carries a `sessionId`; the authoritative working directory resolves from the session header, then the caller, then the persistence index, and only then the process cwd. File reads, writes, uploads, and previews pass real-path workspace guards anchored at that directory, so the sidebar can never address files outside the open session's workspace. UI terminals are keyed by `${sessionId}:${tab}` under a per-session quota, and a `park` frame keeps a terminal alive while its conversation is merely switched away.

### Terminals and the model-facing tools

node-pty loads lazily: a missing or broken native install degrades the plugin — terminal tabs show a repair command fetched from `terminal.deps`, and the tools stay unregistered — instead of failing the boot. One shell resolution feeds both terminal surfaces. The `terminal_*` tools (create, list, send, read, wait_for, resize, signal, close) operate on an agent-owned pty registry keyed by uuid; the `sidebar_open` tool queues open requests that connected sidebar views apply as editor, folder, or browser tabs. Both groups register only while their Side card switches are on, and a settings commit unregisters them and releases what they created.

### Side chat

A side conversation is a child session the plugin creates itself, seeded with the parent session's full event log up to the click; an in-flight parent turn is frozen with synthetic closers, and a boundary prompt delivered as the child's first user message marks everything before it as inherited reference. Context-injection messages carry the `dsh-better-sidebar` plugin marker so the transcript recognizes them structurally.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Host half: `/sidebar/api`, upload, media, preview, and WebSocket routes, pty lifecycle, tool gates |
| [`src/config.ts`](src/config.ts) | `Config` schema, defaults, and the `dsh-better-sidebar` prefs namespace schema |
| [`src/pty-manager.ts`](src/pty-manager.ts) + [`src/agent-pty.ts`](src/agent-pty.ts) | UI-tab terminal manager and the agent-owned terminal registry |
| [`src/tools.ts`](src/tools.ts) + [`src/agent-opens.ts`](src/agent-opens.ts) | `terminal_*` tools and the `sidebar_open` delivery registry |
| [`src/sidechat-core.ts`](src/sidechat-core.ts) + [`src/sidechat-routes.ts`](src/sidechat-routes.ts) | Side-chat seed construction and routes |
| [`src/bundle-route.ts`](src/bundle-route.ts) + [`src/client/chunk-loader.ts`](src/client/chunk-loader.ts) | Lazy chunk serving and materialization |
| [`src/client/index.tsx`](src/client/index.tsx) + [`src/client/service.ts`](src/client/service.ts) | Client apply, panel mount, and the `ctx.betterSidebar` registry |
| [`tsdown.config.ts`](tsdown.config.ts) | Host ESM build, client CJS factory bundle, and the chunk bundles |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the package contract is not enough: the composition that mounts it, the roster that serves its client bundle, and the group this package belongs to.

- [Desktop composition patch](../../bundle/desktop-app/cordis.patch.yml) — the insert row that makes the sidebar a desktop default.
- [Client modules](../modules/README.md) — how the `dsh.client` bundle and its externals are composed and served.
- [Client group map](../README.md) — the browser half this package belongs to.
- [Desktop packaging](../../../scripts/desktop-package.ts) — the deploy-tree completeness list that carries the package.

-----

<a id="model-experience"></a>
## Model Experience

### Opt-in terminal and open tools

#### What the model sees

Nothing by default: no tool is registered until the user turns a Side card switch on. With `agentTerminalTools` enabled the session gains `terminal_create`, `terminal_list`, `terminal_send`, `terminal_read`, `terminal_wait_for`, `terminal_resize`, `terminal_signal`, and `terminal_close` over an agent-owned terminal set; `agentOpenTools` adds `sidebar_open`, which opens files, folders, or URLs as sidebar tabs.

#### Token effect

Zero while the switches are off. While on, the tool declarations join every request's tool list for the session, and the transcripts `terminal_read` and `terminal_wait_for` return add output tokens the way any tool result does.

#### KV Cache effect

The declarations sit in the request's stable tool prefix for as long as a switch stays on; toggling a switch changes the tool list and invalidates provider cache from that request onward. Side-chat children seed from the parent's log and then maintain their own prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the sidebar does not do today. They are current package constraints, not a task backlog.

- **Desktop default only** — a browser `dsh web` composition does not mount the sidebar; opting in or out is a patch row, not a setting.
- **Terminals need a healthy node-pty** — a missing or broken native install leaves the plugin degraded: terminal tabs show a repair command and the `terminal_*` tools stay unregistered, while `sidebar_open` keeps working.
- **One right panel at a time** — when the `aionui-panel` settings namespace selects itself as the right-panel provider, the sidebar does not mount.
- **zh/en copy only** — the sidebar ships bilingual zh/en dictionaries; further locales are external work, and upstream's third-party dictionaries were not carried.
- **Workspace-fenced I/O** — file, upload, and preview routes resolve only inside the open session's workspace; reaching content outside it is not a supported capability.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The `dsh-better-sidebar` settings namespace and the side-chat injection marker intentionally keep their historical names: both persist in user settings and session logs shared across profiles, so they were not rescoped with the package name. The adoption decision and everything it gave up are recorded in the [adoption Agent Note](../../../.agents/notes/implemented/architecture/2026-08-28-adopt-better-sidebar-first-party.md).

</details>
