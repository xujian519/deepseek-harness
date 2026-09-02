# Agent Note: PatentTeams IO hotspots — observer index, mailbox append, spawn outside the team lock

Status: implemented

English | [中文](2026-09-02-patent-teams-io-hotspots.zh.md)

## Problem

Three IO hotspots scaled with the wrong variable. The `agent/status` observer rescanned the whole state directory (readdir plus one team.json read per team) for every status change of every agent in the process — captains and unrelated subagents included. `appendMailbox` read and rewrote the entire JSONL mailbox per message, so total mailbox write volume grew quadratically with message count. `addMember` held the per-team lock across LLM route resolution and the `startContinuable` spawn, stalling every other team tool for the duration of a child spawn.

## Decision

- The scheduler keeps an in-process membership index (`agent id → team + member name`, `null` for agents proven to captain or lie outside every team). Only `addMember` turns a live agent into a member, so it tracks the new member right after persisting; `removeMember` and `delete` untrack. A first sighting still scans; afterwards a member's status events cost one team.json read, and captains'/strangers' events cost none. Null entries insert only when no entry exists, so a scan that resolved against pre-persist state cannot clobber the entry the spawn path just tracked.
- `appendMailbox` appends one line with a single `O_APPEND` write. A one-byte tail probe prepends `\n` when the file lacks a trailing newline, so an appended record cannot glue onto a truncated tail; a missing file starts fresh, and other open failures (for example a directory in the mailbox path) still surface.
- `addMember` validates admission inside the lock, resolves the route and spawns outside it, then revalidates and persists in a second lock window. A spawn that loses a concurrent race (team gone, name taken, cap reached, write failure) retires its orphan child (`retired-members.json` plus interrupt) before the failure surfaces.

## Alternatives considered

**Filter status events by the subagent label prefix.** Rejected: the label is provider-owned (`subagent-spawn` today, `memberProvider` configurable), so the observer would silently stop scheduling members under any provider that does not surface it on the Agent.

**Cache scan results per state root with write-through invalidation.** Rejected: every `writeTeam` would have to know which index entries changed; the membership index changes only at the four service call sites that own it.

**Keep mailbox appends atomic via temp + rename.** Rejected: rename atomicity buys nothing over one `O_APPEND` write (the replaced path never fsynced either) while costing the full-file rewrite this change removes; the read path already skips malformed lines.

**Keep the spawn inside the team lock.** Rejected: a durable child spawn is the slow part of `addMember`, and one captain adding a member would keep every member's claim/update/message call waiting on it; the revalidation-plus-orphan-retirement window covers the races the lock used to exclude.

## Consequences

- Concurrent `add_member` calls with clashing names both spawn; the loser's child is retired and the caller gets the loud admission error. The tools' own mutations were already serialized, so only out-of-band races pay for a wasted spawn.
- A status event that fires between spawn and persist caches the child as a non-member; the `addMember` track call overwrites it, so at most a few early events skip one status mirror and the next edge lands.
- Out-of-band roster edits (direct `team.json` writes) after an agent was cached are invisible to the status observer until process restart; the single-process ownership model already excludes that writer.
- The member welcome text can report a stale task count when a task is created during the spawn — cosmetic; the persona reads immutable team identity.

## Testing

`vitest run` over the package is green (291 tests): new cases pin the lock-free spawn (a `createTask` runs from inside the gated `startContinuable`), the orphan retirement when the team ends mid-spawn, the status mirror for a child that reports status during its own spawn, and the observer's no-rescan behavior for cached non-members.
