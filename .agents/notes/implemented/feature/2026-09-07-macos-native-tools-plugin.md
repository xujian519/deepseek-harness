# Agent Note: macOS native tools plugin — CLI-driven model tools with risk-tiered approval

Status: implemented

English | [中文](2026-09-07-macos-native-tools-plugin.zh.md)

## Problem

Harness tools covered files, shell, and the web, but nothing let an agent act on the user's desktop: no way to open a result for the user, read or write the clipboard, post a completion notification, or switch applications. The community project `Starmadebydata/deepseek-harness-macos` proved the demand with `dsh-macos-tools`, a zero-dependency Node plugin exposing ten such operations through macOS system CLIs — but with no permission gating, hardcoded limits, and Chinese model-facing text, none of which an official package could adopt as-is.

## Decision

`@deepseek-ai/dsh-macos-tools` (desktop group) registers seven model tools that spawn absolute macOS system executables (`open`, `osascript`, `pbcopy`, `pbpaste`, `say`) with argv arrays and never a shell string: `macos_open_path`, `macos_open_url`, `macos_clipboard_get`, `macos_clipboard_set`, `macos_notify`, `macos_speak`, `macos_app`. The desktop-app bundle mounts the plugin with `disabled: !!js process.platform !== 'darwin'`, so only the official desktop app on macOS sees the tools; the web profile stays unchanged.

Effects with reach beyond the session — opening a path with its default application, reading the clipboard, launching or quitting an application — resolve one-time approval through `ctx.approval` inside `execute` before anything runs and fail closed on a missing service, an agent-less call, or any non-grant outcome, mirroring the shared sandbox-escalation sequence. Reveal, browser URLs, clipboard writes, notifications, speech, and activation run without approval; URL schemes stay pinned to http/https, paths must be absolute or `~`-rooted with an existence precheck, and AppleScript-embedded text is stripped of control characters, backslashes, and double quotes. Limits (timeouts, clipboard and text caps) are validated `Config` fields; model-facing text is English.

## Alternatives considered

**Why not absorb the community plugin verbatim?** It executes every tool immediately with the user's full permissions — a model could silently read a password-manager clipboard or launch arbitrary applications — and its `MAX_*` constants violate the no-hardcoded-tunables rule. Porting the tool set behind the harness approval seam kept the proven surface while closing the safety gap.

**Why not a Swift helper binary for these tools?** Every one of the seven operations has a first-party CLI; Vision, ScreenCaptureKit, and on-device speech are the capabilities that actually need native code, and they stay deferred until a product decision pulls them in.

**Why not mount at the web-app bundle layer?** The web layer would expose the tools to every `dsh web` session on a Mac. The desktop-app layer was chosen as the conservative first surface; moving down a layer later is a one-line bundle change.

**Why not a capability seam (Service Definition + provider)?** The package invariant rules require seam roles only when implementations can diverge; there is exactly one implementation (local system CLIs) and no remote provider on the horizon.

**Why not a declarative per-tool permission field?** `ToolDefinition` carries no policy field and the codebase precedent (bash escalation, fs sandbox escalation) resolves approval inside `execute` through `ctx.get('approval')`; inventing a new declarative surface for one package would duplicate that mechanism.

## Consequences

The desktop tool schemas grow by seven tools (prompt-token cost for every desktop session), notifications depend on the host process's notification consent, and compositions without an approval answerer see the four gated actions fail closed with an explicit error — the designed stance for unattended runs. In exchange, the agent gains safe desktop presence with per-action user consent for the risky operations, the package stays pure TypeScript with cross-platform unit tests plus a darwin-only CLI round-trip, and no native build enters the repository.

## Testing

The unit suite drives all seven tools through the real tool runtime with a fake runner, fake approval channel, and fake stat precheck, covering the argv matrix, validation failures, every approval outcome, and config rejection; per-file coverage on the three source files is 100%. A darwin-gated spec round-trips clipboard text through real `pbcopy`/`pbpaste`. The authored keyless scenario `snapshots/session/macos-tools-validation/` replays three deterministic failure paths — URL-scheme rejection, rate-range rejection, and the approval audit pair plus fail-closed clipboard denial under the `never` policy — on every platform.
