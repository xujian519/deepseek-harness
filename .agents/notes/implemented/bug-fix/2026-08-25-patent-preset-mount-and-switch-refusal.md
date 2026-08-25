# Agent Note: Mount the patent preset behind an isolate realm and surface preset-switch refusal

Status: implemented

English | [中文](2026-08-25-patent-preset-mount-and-switch-refusal.zh.md)

## Problem

Two defects kept the desktop user from reaching the patent preset. First, `apps/cli/config/agent-presets/patent/agent.cordis.yml` declared `patent-rule` as a standalone row, and `dsh-patent-rule` provides the `patentRuleGate` service, so that service published into the root realm as process-global. `dsh-agent-presets` rejects any row that leaks a service out of an isolate realm, so the preset failed to mount and every `agentPresets.select('patent')` refused — from a blank session and a started session alike. Second, the new-session chip picked a preset while the current session had already started: `AgentPresetSeatController.apply()` early-returned and silently dropped the stage, so the click read as doing nothing.

## Decision

`agent.cordis.yml` now nests `patent-rule` inside the existing `patent` group and adds `patentRuleGate: true` to its `isolate` map, so the service lands in that standing mount's private realm where `patent-teams` (`ctx.get('patentRuleGate')`) already resolves it. The group's tool/guard registrations still reach the host registries because only the declared service is isolated. `seat-store` keeps the no-round-trip early return but no longer drops silently: on a started session it sets the semantic `SEAT_PRESET_LOCKED` error and snaps the label back to the preset the session runs, and the chip renders a locale line (`seatLocked`) telling the user to start a new session.

## Alternatives considered

**Ask the host for every pick.** Rejected: the chip already knows a started session is refused, so a round-trip would add a request and a failure the client can predict.

**Keep the silent drop.** Rejected: a silent drop reads as a broken click, and the user cannot tell why the switch did not happen.

**Move the gate service to the host composition instead.** Rejected: the preset owns its agent plane; lifting the service host-plane would weaken per-preset encapsulation without changing the mount failure.

## Consequences

The patent preset now mounts and `agentPresets.select('patent')` succeeds on a blank session; a started-session pick shows the `seatLocked` message instead of nothing. The `SEAT_PRESET_LOCKED` marker is translated only in the chip and never reaches the wire. Locale parity is maintained for `seatLocked` in en/zh.
