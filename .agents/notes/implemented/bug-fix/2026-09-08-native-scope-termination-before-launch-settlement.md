# Agent Note: Native containment settles a termination requested before the launch request is consumed

Status: implemented

English | [中文](2026-09-08-native-scope-termination-before-launch-settlement.zh.md)

## Problem

Upstream v0.1.3-alpha.2 introduced the Linux user-systemd scope launch for ordinary subprocesses and PTY terminals (`packages/subprocess/subprocess-local/src/linux-scope.ts`): `systemd-run --user --scope` starts a node bootstrap runner, the runner consumes a private launch-request file, then execve's the target. The direct launch result rejects with `subprocess scope exited before its bootstrap consumed the launch request` whenever the scope dies while that file still exists.

On a host with a working user systemd (GitHub-hosted `ubuntu-latest`), signalling the range inside that bootstrap window — an immediate `kill()`, a 50 ms abort, or a per-call timeout shorter than the bootstrap — ends `systemd-run` before the runner consumes the request, so every such call surfaced that rejection instead of the killed outcome. Seventeen fork-CI tests across seven files (`bash-local`, `pwsh-local`, `bash-sandbox`, `tool-bash`, `tool-pwsh`, `subprocess-local`) failed in this window. On hosts without user systemd, `selectContainmentMode` selects the detached direct spawn, where the signalled child reports the signal directly and the same tests pass; upstream's Linux pools pass the suite, which is only possible on that fallback path (a synthetic pty can never consume a native launch request), so the immediate-termination tests encode the fallback contract. The TERM-escalation spec in the same suite documents the adjacent hazard: "a fixed sleep is load-flaky: a slow spawn would take the SIGTERM before the trap".

The same window hung whole-fiber disposal intermittently (27% of launches under a phase-timed diagnostic on an otherwise idle 2-core runner): when the group signal ends `systemd-run` together with the runner, the user manager can keep reporting the scope `active` with no live process — the cgroup may still hold the runner as an unreaped zombie (GitHub-hosted runners do not reap reparented orphans), or the manager's unit state is simply stale — so `SystemdScopeOwner.waitForExit()` polls forever; `disposeManagedProcesses` awaits that observation, so `fiber.dispose()` never settles. The diagnostic dump showed the evidence: a `loaded active running` scope with an unconsumed `launch-request.json` and a process table with no live members (the first residue check gated on the owner's establishment flag and never fired, because the first poll marks a loaded unit established before the launcher's exit becomes visible).

A separate fork-CI failure, `reports the plugin version in lockstep with package.json`, came from the v0.1.3-alpha.2 sync bumping `@deepseek-ai/dsh-better-sidebar`'s package.json without realigning `SIDEBAR_SERVICE_VERSION`.

## Decision

`bindManagedProcess` (`packages/subprocess/subprocess-local/src/spawn.ts`) now settles the launch rejection as `{ exitCode: null, signal: <last requested signal> }` when a termination was already requested and the rejection carries the new `DSH_LAUNCH_REQUEST_UNCONSUMED` code — `unconsumedLaunchRequestError` in `packages/subprocess/subprocess-local/src/runner-protocol.ts`, thrown by both the ordinary and the terminal scope results. Every other rejection keeps rejecting, so a genuine spawn failure racing teardown still surfaces (the `disposal contains a spawn-failure rejection that races teardown` contract), and callers keep their own cancellation facts: deadline classification (`timedOut`/`aborted`) and the tool layer's structured `TOOL_ABORTED` error derive from the caller's signal, not from the outcome.

Three specs in `packages/subprocess/subprocess-local/tests/local.spec.ts` pin `internals.platform = 'darwin'` so they exercise the fallback containment selection they were written against: the two terminal bookkeeping specs that drive a synthetic node-pty (`releases a terminal after top-level exit reaches quiescence`, `retains a terminal whose automatic cleanup fails` — a synthetic pty cannot consume a native scope's launch request), and `disposal contains a spawn-failure rejection that races teardown` (on native scopes the teardown signal can legitimately settle a still-booting launch as the requested kill before the bad workdir is ever read).

`SystemdScopeOwner.rangeActive()` now settles the range when a loaded unit reports `active` but the launch never reached consumption: with the launch request still present (consumption unlinks it), the direct launcher exited, and the launcher's process group holding no live members (`linuxProcessGroupHasLiveMembers`, the same zombie-ignoring probe the fallback owner uses, wired through the `DirectRange.hasLiveMembers` closure and the `processGroupHasLiveMembers` test seam), the unit's state is residue and the observation stops. The check does not depend on the establishment flag, so a poll that marked the unit loaded before the launcher's exit became visible cannot strand the observation; established launches keep their manager-authoritative exit semantics because a consumed request fails the check.

`SIDEBAR_SERVICE_VERSION` is realigned to `0.1.3-alpha.2`.

## Alternatives considered

**Translate the rejection inside `linux-scope.ts`.** The direct layer's rejection for a signalled pre-consumption exit is asserted by `linux-scope.spec.ts` (`does not mistake pre-establishment unit absence for quiescence and settles an empty range after cancellation`), so the layer contract stays; the fallback-path equivalence belongs to the launch-result composition.

**Settle every rejection that lands after a requested termination.** Rejected: a genuine spawn failure (ENOENT from a bad workdir) that races teardown must stay a rejection, and only the unconsumed-launch marker identifies an exit our own signal caused.

**Make the immediate-termination tests wait for an output marker before killing.** Weakening the tests' contract (a kill right after start settles as killed) would hide the launch-window semantics instead of fixing them; the fallback path already satisfies the contract as written.

## Consequences

- An immediate kill, abort, or short timeout during the native bootstrap window settles as the requested signal on hosts with user systemd, matching the fallback path; hosts without it are unchanged because the direct result already resolves with the signal.
- A signalled pre-consumption scope whose cgroup holds only zombies no longer blocks `waitForExit()` or whole-fiber disposal; the leaked launch-request directories are cleaned through the normal owner cleanup.
- The pre-consumption rejection remains observable at the `linux-scope` direct layer and for exits no termination requested.
- Fork CI on `ubuntu-latest` selects the native containment path (upstream's Linux pools do not select it for these suites), so the launch window stays exercised on every fork-CI run.
