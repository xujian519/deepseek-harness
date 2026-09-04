---
description: "Host half of the Synapse session map: the `/synapse` canvas page, its static assets, and the `/synapse/api` JSON API, mounted on the existing DSH Web Server; plus the projection store that turns committed DSH session events into canvas cards (workspaces, thread nodes, fork anchors, folded tool process)."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-synapse

English | [中文](README.zh.md)

## Summary

Host half of the Synapse session map: the `/synapse` canvas page, its static assets, and the `/synapse/api` JSON API, mounted on the existing DSH Web Server; plus the projection store that turns committed DSH session events into canvas cards (workspaces, thread nodes, fork anchors, folded tool process).

The canvas is derived, reconstructable UI state: the DSH SessionStore stays the source of session truth. This package reads only committed session logs and never contributes to a model request.

No runtime invariant companion is published; the canvas graph is derived, reconstructable UI state whose truth lives in the DSH SessionStore, which enforces its only owned relationships at mutation time, and the projection replays committed logs rather than publishing an independent raw-event stream.


## Table of Contents

- [Registration](#registration)
- [Configuration](#configuration)
- [Canvas data](#canvas-data)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Registration

The web bundle mounts this package as row `synapse`, and `@deepseek-ai/dsh-client-synapse` as row `synapse-client` (the 对话/会话地图 switch). A profile can disable either row by id.

## Configuration

| Key | Default | Description |
|---|---|---|
| `dataFile` | `$DSH_HOME/synapse/workspaces.json` | Canvas metadata persistence path |
| `autoProjection` | `true` | Project committed DSH session events into canvas cards |
| `projectionWorkspaceTitle` | `DSH 任务` | Title of the projection workspace for sessions without a cwd |
| `trustedHosts` | `[]` | Extra authorities the `/synapse` Host check accepts; loopback is always allowed |

## Canvas data

- The canvas baseline replays cold restored sessions from `SessionPersistence` (revision-keyed, cheap repeats) plus the live `session/created`/`session/event` stream and the browser's session sync; a fork child skips its inherited seed prefix, a root session replays from seq 0 (`session/end-seed` is the persistence snapshot boundary there, not a lineage cut).
- Only human prompts become question cards: user-role injections (workspace instructions, skill catalogs, runtime-context snapshot) are recognized by their `source.kind` and stay off the canvas; blank sessions (no human question) are skipped.
- `GET /synapse/api/sessions/<id>/history` pages the detail-view message list (`?limit`/`?beforeSeq`; the default opens the most recent messages and loads earlier ones on request). It never truncates, folds tool process, and marks injected context `context`, from `SessionPersistence.inspect`.
- The map document is served with a restrictive `Content-Security-Policy` (same-origin script/style, `frame-ancestors 'self'`), and every `/synapse` response carries `X-Content-Type-Options: nosniff`.
- A second `dsh web` instance writing the same `workspaces.json` is never clobbered silently: the file mtime moving since our last read reloads the disk state and drops the local delta with a loud warning (projection rebuilds from session logs; manual layout is the loss).

## Model Experience

None, as the package reads committed session events and renders them; it adds no system-prompt prose, tool schemas, or request-context content to any model request.

#### KV Cache effect

None: it never changes request headers, system prompts, or tool registries, so an already-reusable KV prefix stays reusable.

## Known Limitations and Deferred Work

- The map UI is a static browser script (`assets/app.js`) inside an iframe: it renders with its own mini markdown renderer, not the repo's React stack, and is not covered by the client snapshot gates.
- The history endpoint pages the session log (`?limit`/`?beforeSeq`): the detail view opens with the most recent messages and loads earlier ones on request, so a very long conversation no longer loads in full.
- Two `dsh web` instances sharing one profile still race at the same instant; the mtime conflict check serializes on the lock window, and a losing local delta is dropped with a warning rather than merged.
- Legacy v3 data migrates tool cards by order (each call paired with the next result); live events pair by `callId`.

### Dev Note

None.
