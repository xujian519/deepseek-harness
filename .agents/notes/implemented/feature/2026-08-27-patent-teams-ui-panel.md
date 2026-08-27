# Agent Note: Restore the PatentTeams monitor as a chat card and the fixed Teams view

Status: implemented

English | [中文](2026-08-27-patent-teams-ui-panel.zh.md)

## Problem

Porting `dsh-patent-teams` from the upstream `@nanmicoder/dsh-agent-teams` plugin deliberately dropped the upstream Web activity panel (v1 was tools + service only), so the desktop app — which renders the web-app bundle UI — lost its only window onto multi-agent patent teamwork. The upstream panel was a body-portal floating layer over a host snapshot route polled every second, with an independent 1.5s poll for its chat card; both bypassed the slot system because the shell offered no corner seat.

## Decision

Rebuild the monitor on the repository's durable-replay path instead of porting the polling architecture. `patent-teams/*` events were already in the generated session vocabulary and (after the companion fix in this stack) land as ignorable informational records, and `event-types.ts` was already a zero-import type face reserved for a browser program. The new `dsh-client-ui-patent-teams` package registers two `ConversationNodeDefinition`s over the same reducer in `teams-model.ts` — one targeting `chat` (the keyed `patent-teams` card, the `ui-workflow-run` pattern) and one targeting a `patentTeams` view source — plus one `ConversationViewDefinition` whose per-session builder keeps team-creation order. The fixed entry is a `conversation.view` list entry (`id: 'teams'`, order 30), so every session view — desktop included, which inherits the web roster — carries the tab with an empty state when no team exists. Live member activity reuses the ordinary Session-list share with the same navigation proof as the workflow-run panel; no new host surface, no polling, no portal.

## Alternatives considered

**Port the upstream panel shape (corner overlay + state route + polling).** Rejected: the fork already persists the events, the Conversation Node fold is deterministic across restarts where a poll loop is not, and the body-portal/`<html data-*>` yield hack exists only because the upstream shell lacked a slot — ours does not.

**A `shell.overlay` corner panel.** Deferred: the data is per-captain-session, and a session-scoped tab plus an in-stream card keep the ownership model simple; a global corner aggregator wants a cross-session host query first.

**Keyed `patent_teams_*` toolviews in this PR.** Dropped after investigation: the shipped toolview rows live inside `ui-tool` (their chrome is package-internal), the four candidate tools' value over the generic card is marginal next to the turn-anchored team card, and the status tool's open-schema result would force brittle parsing. Recorded as deferred work in the package README.

**Auto-switch to the Teams tab on team creation.** Dropped: the conversation service exposes no per-session snapshot read to gate the switch, so the trigger would either misfire on teamless sessions or need a new service face.

## Consequences

The chat stream shows one durable card per team (members, tasks, verdicts, progress, disband state), the Teams tab shows the same fold session-wide, and both survive restarts from the log. A later valid contract verdict clears an earlier degraded one. The desktop app needs zero changes. Tests: fold/lifecycle specs through the real assembler, jsdom component specs, and a keyless web e2e (`apps/web/tests/patent-teams-panel.e2e.ts`) seeding the event family into a session log and snapshotting both surfaces.
