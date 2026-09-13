# Agent Note: PTY seam failure classification and the required close reason

Status: implemented

English | [中文](2026-09-13-terminal-failure-classification.zh.md)

## Problem

`TerminalErrorCode` is documented as "machine-routable PTY service failures", but three session states were reported outside it, and one failure family used two error classes. `TerminalSessionService.startSend` refused a closing session with a bare `Error` on the line above an `SEND_ACTIVE` `TerminalError`; [terminal-bash's session](../../../../packages/terminal/terminal-bash/src/session.ts) refused sends and signals on a closing session and sends on an exited shell with bare `Error`s. A consumer could tell "wait for the quiescent close to finish" from "the shell is gone" only by matching message text. Empty caller arguments (`backend.type`, `request.name`) also threw bare `Error`s that no consumer can distinguish from service state, and the backend-type message read `pty` where the rest of the seam reads `PTY`.

`kill(owner, id, reason = 'model request')` hardcoded a label the seam cannot know: it states how the call was made rather than what the seam observed. Its JSDoc said only "diagnostic cleanup reason", so the text reaching a backend's `PTY cleanup failed (…)` report was invisible to the caller reading the signature. Only `tool-terminal`'s `terminal_close` relied on the default; `tool-bash-persistent` and `tool-pwsh-persistent` already passed labels of their own.

Issue #100 records this family as ledger item L4. Its premise that sibling packages consistently prefix their messages did not survive checking: bare messages outnumber prefixed ones in every sibling (`terminal-bash` 12/7, `subprocess-local` 31/5, `tool-terminal` 6/1, `fs-local` 0/1), so the seam that prefixes nothing is not the outlier, and the prefix deliverable was dropped.

## Decision

- **The failure class follows who can act on it.** A session or service state a consumer routes on carries `TerminalError` plus a `TerminalErrorCode` member; an argument the caller supplied fails with `TypeError`; a caller's own cancellation keeps the caller's value. `SESSION_CLOSING` and `SESSION_EXITED` join the closed union, so a refusal now names the state that caused it instead of only describing it.
- **`kill()` requires its reason.** The parameter is now mandatory and its JSDoc states that a backend failing its own cleanup reports the text verbatim. `tool-terminal` passes `'model request'` explicitly, which keeps the diagnostics of the model-facing close tool byte-identical while moving the decision to the caller that knows it.

## Alternatives considered

- **Prefix every seam message with the package name.** Rejected: the premise is false, and acting on it would have rewritten roughly forty bare messages across the sibling packages to make one seam match a convention none of them follows.
- **Keep the `'model request'` default and document it in the JSDoc.** Rejected: it hides a caller-specific fact inside the seam, so the next non-model caller silently reports the wrong reason. Only one production call site relied on it, and that site's own label is already the accurate one.
- **Report a closing or exited session as `SEND_ACTIVE`.** Rejected: the two conditions need different recovery. A second send while one is active settles on its own and the caller retries, while a closing session must be awaited through the idempotent `kill()` and an exited shell needs a new session.
- **Add a `state` field or a second error class instead of union members.** Rejected: the seam already publishes one coded error type with a closed union, and a parallel carrier would duplicate every existing code.
- **Fix only `TerminalSessionService`, leaving the backend's own refusals.** Rejected: the closing and exited refusals a consumer meets in practice are thrown by the backend session, so the seam's registry would have been inconsistent with the errors its consumers actually catch.

## Consequences

Every PTY refusal is now routable, and the closing family reads the same in the registry and in the backend. `kill()` gained a required argument, a source break for a pre-stable seam; all five production call sites and every test call site were updated in the same change. Empty-argument failures are `TypeError`s, which no longer look like session state, and the backend-type message matches the seam's `PTY` spelling. Two hand-written backend doubles in the persistent-shell tool suites now throw the coded `SESSION_EXITED` the real backend throws, so a suite that documents itself as behaving "exactly like the real backend" keeps that claim. The prefixing item is recorded as dropped on #100 rather than left open.

## Testing

`packages/terminal/terminal`, `packages/terminal/terminal-bash`, and `packages/terminal/tool-terminal` cover the retyped refusals: the two empty-argument cases assert `TypeError` with their message, and the closing and exited cases assert `SESSION_CLOSING` and `SESSION_EXITED` through `toThrow(expect.objectContaining({ code }))`. The idempotent-kill case now asserts that the caller's own reason reaches the backend instead of asserting the removed default. Full `pnpm run typecheck`, `pnpm run lint`, and the two persistent-shell tool suites pass.

## Related

[Persistent PTY sessions](../feature/2026-07-16-persistent-pty-sessions.md) owns the spawn, publication, and disposal lifecycle this classification reports on.
