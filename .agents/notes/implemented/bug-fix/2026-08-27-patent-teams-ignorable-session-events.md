# Agent Note: Write patent-teams session events as ignorable records unconditionally

Status: implemented

English | [中文](2026-08-27-patent-teams-ignorable-session-events.zh.md)

## Problem

`appendTeamEvent` carried an interim guard from the port: it probed the harness's `KNOWN_SESSION_EVENT_TYPES` at runtime and silently dropped every `patent-teams/*` event the running build did not recognize. The guard was written before `Session.append` exposed the `ignorable: true` writer option (`012e897ace`). Inside this fork the generated vocabulary already includes all nine types, so the guard passes and the probe is dead weight; installed on an upstream harness build, the guard silently discards the entire team record from the session log, and the comments describing both facts had drifted from reality.

## Decision

`appendTeamEvent` now calls `session.append(type, data, { ignorable: true })` unconditionally and the vocabulary probe, the `skippedEventTypes` set, and the `dshSession` namespace import are gone. On-disk team state under `<workspace>/<stateDir>/` remains the authoritative source; session events are informational monitor records, which is exactly what the `ignorable` envelope field is for. A build whose vocabulary predates `patent-teams/*` (an upstream install of the published plugin) accepts the log and drops the records instead of refusing it, and a build that knows the types keeps them either way.

## Alternatives considered

**Drop the guard without `ignorable`.** Rejected: an upstream build would then refuse the whole session log on read (required-on-read default) — worse than losing informational records.

**Register plugin event types into the runtime vocabulary.** Rejected: the session-log version mechanism note explicitly rejected per-plugin vocabulary mutation because readability would depend on which plugins happen to be loaded.

## Consequences

Team events now land in the captain's session log with `ignorable: true` in every deployment. `tests/events.spec.ts` no longer mutates the live vocabulary set and asserts the marker directly. No `SESSION_FORMAT_VERSION` bump and no SDK changes: the envelope field and wire schema already exist.
