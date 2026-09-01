# Agent Note: Fail fast on long-running tool results and hint backgrounding

Status: proposed

English | [中文](2026-09-01-tool-run-fail-fast-and-background-hint.zh.md)

## Problem

In `dsh-session-463b73d4` the agent paid wall-clock on tool calls that had already decided their own outcome. Three foreground `bash` calls stopped the scheduler at exactly their default 60s timeout and were SIGTERM'd (a `curl` download and two render commands), and two `job_output` calls with `wait: true` ran their full `wait` (138s and 144s) even though the background job had already exited with a `Traceback`. The model only switched to `run_in_background` plus polling after about three minutes of white-waiting.

The available signals were present but unused: the background job's terminal output and exit state existed well before the `wait` timed out, and the foreground commands exceeded a timeout the harness did not help the model bound in advance.

## Proposal

Two changes on the tool-result timing surface.

First, when a foreground command will likely outrun a short default timeout, the harness should make that visible at request time: a `bash` command that carries an explicit `timeout_ms`, or one the harness can already see is long-running, should have its result note that longer work should use `run_in_background` plus `job_output` polling, rather than blocking a step. The existing `run_in_background`/`job_output` flow is the documented escape hatch; the result should say so instead of leaving the model to rediscover it after the timeout.

Second, `job_output` with `wait: true` should return as soon as the background process has exited — terminal exit state or a completed result — instead of waiting out the full timeout. The returned payload carries the captured output and error so the caller sees the traceback immediately, not at the deadline.

## Alternatives considered

- **Keep waiting to the deadline.** Simple, but a dead process still costs the full `wait`, as the session shows.
- **Only add the hint, not early return.** Improves the next attempt but still strands an already-dead `job_output` wait.
- **Only add early return, not the hint.** Fixes `job_output` but leaves foreground timeouts silently SIGTERM'd without guidance.
- **Abort long foreground commands automatically.** Too aggressive; some work legitimately exceeds the default and would be lost.

## Acceptance criteria

- A `bash` result that reached its timeout describes `run_in_background` plus `job_output` as the path for longer work.
- A `job_output` wait over an already-exited process returns with the captured exit state and output well before the timeout.
- A `job_output` wait over a still-running process keeps waiting (no premature return).
- Keyless tests cover both the exited and still-running cases and the foreground timeout message.

## Risks

Returning on process exit must distinguish a clean exit from a process that is still producing output; a long-lived streaming job should not be cut off early on a transient idle. The hint text must not become a hard rule for genuinely bounded foreground work that merely exceeds one default.
