---
description: "The browser plugin that restores the PatentTeams monitor to the Web UI: one durable team card in the chat stream and the fixed Teams conversation view. Both surfaces fold the nine `patent-teams/*` Session events owned by [`dsh-patent-teams`](../../patent/patent-teams/README.md); the upstream `@nanmicoder/dsh-agent-teams` activity panel (a body-portal floating layer over a polled host route) was deliberately not re-implemented — this package replays the session log instead, with no polling and no new host surface."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-patent-teams

English | [中文](README.zh.md)

## Summary

The browser plugin that restores the PatentTeams monitor to the Web UI: one durable team card in the chat stream and the fixed Teams conversation view. Both surfaces fold the nine `patent-teams/*` Session events owned by [`dsh-patent-teams`](../../patent/patent-teams/README.md); the upstream `@nanmicoder/dsh-agent-teams` activity panel (a body-portal floating layer over a polled host route) was deliberately not re-implemented — this package replays the session log instead, with no polling and no new host surface.

## Table of Contents

- [Durable state and replay](#durable-state-and-replay)
- [Presentation and navigation](#presentation-and-navigation)
- [Composition](#composition)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Durable state and replay

`patent-teams/team-created` opens one Context per team keyed by `teamId`; member additions and removals, task creations, status transitions, contract verdicts, gate rejections, mailbox messages, and team deletion update that Context in log order. Both the chat Definition and the view-source Definition run the same reducer from `teams-model.ts`, so the card and the Teams tab are two projections of one fold and cannot disagree. A history tail containing only updates stays pending until an older page supplies the unique start; prepend, complete replay, and live append converge to the same state. A later valid contract verdict clears an earlier degraded one — the latest verdict owns the task view. `patent-teams/team-deleted` marks the team disbanded but keeps its record for review, mirroring the host's on-disk archive.

The Teams tab reads the `patentTeams` view snapshot through a per-session `ConversationViewBuilder` that preserves team-creation order across incremental upserts. Sessions without team records show an empty state; the tab itself is a fixed entry in every session view (order 30, after Trajectory and Document).

## Presentation and navigation

The card is a controlled disclosure: an active team mounts expanded, completed and disbanded teams mount collapsed, and the row toggles with the full header. The collapsed tail is a member count, a done/total task count, and a state dot plus status copy; the expanded body lists members (name, role, and live activity) and tasks (status, assignee, dependencies, contract-missing and gate-rejected flags). Task statuses outside the closed host vocabulary render as their raw string. A member opens its subagent Session only while every current fact agrees — running, in the ordinary Session list, `origin: 'subagent'`, parented to this Session — the same proof `ui-workflow-run` applies, so a stale fold never becomes a dead button. The Teams view renders one block per team with the same row lists.

## Composition

The package registers two Conversation Node Definitions, one view Definition, its locale dictionary, the keyed `patent-teams` Chat renderer, and the `teams` conversation view as Cordis effects. Removing the client entry retracts all contributions. The shipped Web bundle includes the plugin after `ui-workflow-run`; the desktop app inherits it through the same roster.

## Model Experience

None, as this package renders durable Session facts for humans and adds no prompt, tool schema, request content, or model-visible result.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- Live member activity comes from the ordinary Session list share; a member whose list row has not arrived yet renders idle, and no manual refresh action is offered.
- `patent_teams_*` tool calls still render through the generic tool card; keyed toolviews are deferred until the ui-tool row pattern can be reused without forking its chrome.
- The view lists only teams whose events are in this Session's log window; a cross-session team aggregator needs a new host query surface.
- No auto-switch to the Teams tab on team creation: the conversation service exposes no per-session snapshot read to gate the switch yet.

### Dev Note

None.
