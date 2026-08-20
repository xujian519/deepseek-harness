# Agent Note: terminal-bash answers PSReadLine cursor-position queries so pwsh reaches readiness

Status: implemented

English | [中文](2026-08-20-terminal-bash-answers-pwsh-cpr.zh.md)

## Problem

pwsh sessions under terminal-bash never reached readiness in a real pwsh shell. Before rendering each prompt, PSReadLine asks the terminal for its cursor position with the escape sequence `ESC[6n` and blocks until it receives a `ESC[<row>;<col>R` report. terminal-bash never answered the query, so pwsh froze mid-prompt: submitted commands queued but never executed, the controlled `dsh> ` prompt never rendered, and every send settled on the `inferred_idle` silence fallback instead of `stdin_read`. bash and GNU readline never issue the query, so the freeze was invisible to the bash dialect.

Upstream CI never saw the failure: it runs the same tests on a self-hosted runner without pwsh, so the pwsh tests were always gated by `hasPwsh` and skipped. The fork CI runs on a standard `ubuntu-latest` image with PowerShell preinstalled, so those previously-skipped tests actually ran and exposed the freeze (`expected 'inferred_idle' to be 'stdin_read'`).

A second startup bug compounded the freeze. The pwsh startup loop broke when the retained text *contained* the prompt string anywhere; the setup command echo contains `dsh> ` inside the prompt-function body, so the loop could break while pwsh was still frozen at a cursor-position query. The same failure mode also broke the `tool-pwsh-persistent` loader-composition test, whose commands are sent through the same startup path.

## Decision

1. `LocalPtySession` answers cursor-position requests. A rolling 32-bit window scans each incoming data chunk for `ESC[6n` (`0x1b5b366e`) and writes the standard report `ESC[1;1R`. The window scan is chunk-boundary-safe (a query split across callbacks still matches), and the response is inert for bash. A failed reply is swallowed: the shell merely keeps waiting as before, and the transport-failure path owns the eventual teardown.
2. The pwsh startup loop breaks only when the controlled prompt appears at the **end** of the retained text (`endsWith`) instead of anywhere (`includes`). Only a prompt at the end of the text is a live rendered prompt; an echoed substring is not.

## Alternatives considered

- **Respond on a timer or after a silence bound.** Would race a split-chunk query and could answer stale queries. The window scan answers exactly when the query is observed.
- **Respond with a guessed row/column.** PSReadLine only needs a well-formed report to proceed; the minimum report `ESC[1;1R` is inert and correct enough for prompt layout.
- **Skip the pwsh tests on the fork CI.** Hides a real product defect and contradicts the pre-release stance that prefers the correct foundation over compatibility shims. Rejected; this is a product fix.

## Consequences

- pwsh sessions reach `stdin_read` readiness, execute commands, and render the controlled `dsh> ` prompt. The three fork-CI pwsh failures — two in `terminal-bash/tests/local.spec.ts` and the `tool-pwsh-persistent` loader-composition test — now pass.
- The loader-composition fixture now asserts cwd against `realpath` so it replays on macOS, where the temp dir is reached through the `/var` → `/private/var` symlink. Linux is unaffected (`realpath` is identity there).
- A user typing the literal bytes `ESC[6n` at a pwsh prompt would receive a spurious report, which is harmless. The window uses a fixed constant because protocol constants stay fixed.
