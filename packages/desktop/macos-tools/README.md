---
description: "Model-facing **macOS native tools**: open/reveal paths, open browser URLs, read/write clipboard text, post notifications, speak text, and launch/activate/quit applications — all driven through system CLIs with argv-array spawns, with host effects beyond the session gated by one-time approval."
kind: "package-reference"
---

# @deepseek-ai/dsh-macos-tools

English | [中文](README.zh.md)

## Summary

Model-facing **macOS native tools**: open/reveal paths, open browser URLs, read/write clipboard text, post notifications, speak text, and launch/activate/quit applications — all driven through system CLIs with argv-array spawns, with host effects beyond the session gated by one-time approval.

Every tool spawns an absolute system executable (`/usr/bin/open`, `osascript`, `pbcopy`, `pbpaste`, `say`) with an argument array and never a shell string, so model text reaches the system only as one argv element or stdin bytes. Actions with reach beyond the session — opening a path with its default application, reading the clipboard, launching or quitting an application — resolve one-time approval through `ctx.approval` before anything runs and fail closed when no approval channel answers; the remaining actions run directly. The desktop bundle mounts this package on darwin only.

No runtime invariant companion is published; the package owns no independently divergent observations — its effects are one-shot system commands whose outcomes the tool results already record, and approval behavior is owned by `@deepseek-ai/dsh-user-approval`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

Mount the plugin where agents should see the macOS tools; the desktop bundle gates the row to darwin (`disabled: !!js process.platform !== 'darwin'`):

```yaml
- id: macos-tools
  name: '@deepseek-ai/dsh-macos-tools'
```

Configuration (all fields optional; invalid values fail plugin load):

| Field | Default | Meaning |
| --- | --- | --- |
| `commandTimeoutMs` | `15000` | Timeout for every system-CLI invocation. |
| `clipboardReadMaxChars` | `20000` | Character cap for one clipboard read. |
| `clipboardWriteMaxChars` | `1000000` | Character cap for one clipboard write. |
| `speakMaxChars` | `4000` | Character cap for one spoken text. |
| `notifyMaxChars` | `4000` | Character cap for a notification title plus message. |

## Understand the implementation

`src/index.ts` validates and defaults the config, wires the production seams, and registers the tools. `src/tools.ts` defines the seven tools, the approval gate, and the argument validation; `src/runner.ts` is the `execFile`-based runner carrying timeout, abort-signal, and stdin wiring.

| Tool | System call | Approval |
| --- | --- | --- |
| `macos_open_path` | `open [-R] <path>` | opening: yes; reveal: no |
| `macos_open_url` | `open <url>` | no |
| `macos_clipboard_get` | `pbpaste` | yes |
| `macos_clipboard_set` | `pbcopy` (stdin) | no |
| `macos_notify` | `osascript -e 'display notification …'` | no |
| `macos_speak` | `say [-r N] [-v voice] <text>` | no |
| `macos_app` | `open [-a] <name>` / `tell application … to activate/quit` | launch and quit: yes; activate: no |

The approval gate mirrors the sandbox escalation sequence: a missing approval service, an agent-less call, or any non-grant outcome throws before the command runs, and the tool registry turns the throw into that call's error result. Paths must be absolute or `~`-rooted and pass an existence precheck; URLs are limited to `http`/`https` (bare hosts default to `https`); text embedded in AppleScript literals is stripped of control characters, backslashes, and double quotes. Relative paths are rejected so a model-provided string can never resolve against the backend process's working directory.

## Model Experience

### Tool schemas

#### What the model sees

The model sees the generated [`macos_*` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-macos-tools) whenever the plugin is mounted: seven English tool descriptions with canonical JSON outputs. Approval-gated calls surface their denial as the call's error result, so the model learns the outcome without a separate prompt.

#### Token effect

Fixed schema cost per request where the plugin is mounted; the seven schemas enter every desktop-profile request on darwin.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **darwin only** — the plugin registers tools on every platform it mounts on, but the bundle row gates it to darwin because every executable is macOS-specific; the CLI runner itself has cross-platform tests over `/bin/echo`, `/bin/cat`, and `/usr/bin/false`.
- **Notifications need system consent** — `display notification` banners arrive only when macOS allows notifications from the host process (terminal, Electron app, or `dsh` binary); without consent the command succeeds silently.
- **Fail-closed without an approval channel** — in compositions that mount no approval answerer (for example unattended headless runs), the four gated actions deny with an explicit error instead of running; this is the designed behavior, not a defect.
- **Clipboard reads are privacy-sensitive** — every read asks for one-time approval because the clipboard can hold passwords or tokens; the read is capped by `clipboardReadMaxChars`.
- **Deferred** — screenshots (Screen Recording TCC is bound to the host process and the tool would need image content blocks), Apple Music control, and volume control are deliberately out of scope for this first version.

### Dev Note

None.
