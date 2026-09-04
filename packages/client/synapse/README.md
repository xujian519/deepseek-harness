---
description: "Browser half of the Synapse session map for `dsh web`: the **对话/会话地图** view switch and the full-surface iframe at `/synapse/`, bridged to the client session and workspace services. From the map you can browse, fork, continue, and create sessions without leaving the canvas; the native chat follows the current session in both directions."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-synapse

English | [中文](README.zh.md)

## Summary

Browser half of the Synapse session map for `dsh web`: the **对话/会话地图** view switch and the full-surface iframe at `/synapse/`, bridged to the client session and workspace services. From the map you can browse, fork, continue, and create sessions without leaving the canvas; the native chat follows the current session in both directions.

The host half (`@deepseek-ai/dsh-host-synapse`) owns the canvas page and projection; this package only renders chrome and forwards bridge messages.

No runtime invariant companion is published; the browser half only renders a view switch and an iframe host, owns no registry or observation stream of its own, and every session relationship it reads comes through the client sessions/workspaces services, which enforce their own contracts.


## Table of Contents

- [Registration](#registration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Registration

The web bundle mounts this package as `dsh.client` row `synapse-client` (node half is an empty Loader entry). The map switch appears on the chat surface once the host row `synapse` is also mounted; without it the iframe shows nothing.

## Model Experience

None, as the browser half never touches a model request; it reads client-side session/workspace snapshots and live partials only after the host commits them.

#### KV Cache effect

None: it sends no model requests and mutates no request headers.

## Known Limitations and Deferred Work

- The map runs inside an iframe with its own DOM/Markdown stack; it is not part of the React slot system, so theme tokens and accessibility conventions of the host chrome do not apply inside the canvas.
- The exposed bridge surface (create/fork/send/open/activate) is a deliberate minimal RPC contract with the canvas; adding verbs means extending both `src/client/index.ts` and the canvas app.

### Dev Note

None.
