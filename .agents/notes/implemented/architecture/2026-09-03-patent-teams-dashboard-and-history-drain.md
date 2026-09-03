# Agent Note: PatentTeams Teams-tab dashboard and the history drain

Status: implemented

English | [中文](2026-09-03-patent-teams-dashboard-and-history-drain.zh.md)

## Problem

Two gaps met on the same surface. First, the fixed Teams tab rendered folded teams as plain rows: no progress at a glance, no dependency relationships between tasks, no per-member task binding, and no recent-activity trail — visually far behind the upstream `@nanmicoder/dsh-agent-teams` activity panel the feature was adapted from. Second, a field report showed the tab stuck on its empty state while a team was demonstrably working: a long session opens with only the tail history window (the last 50 messages), the fold needs each team's unique `team-created` start event, and nothing on the Teams tab ever pages backwards — so every update event in the window stayed inert and the snapshot stayed empty.

## Decision

- The Teams view renders one dashboard block per team (`TeamsDashboard.tsx`): a hero with a completion ring, a segmented progress bar (completed/running/waiting from `taskSegments`), the roster with a captain strip and gradient member avatars derived from member ids, and live member states with the current-or-last task binding from `memberTaskBinding`; a task DAG laid out by dependency depth with curved edges (`teams-dag.ts`, cycle-safe longest-path layering) where hovering traces and clicking pins the dependency chain; and a capped recent-activity feed. Chat-card rendering is unchanged — the tab and the card remain projections of the same fold.
- The fold keeps a capped per-team activity feed: `applyTeamsEvent` records the newest eight task transitions and mailbox messages (`TEAMS_ACTIVITY_LIMIT`), projected newest-first as `PatentTeamsCardData.activity`. This is additive to the projection; the chat card ignores it.
- The false empty state is fixed at the view, not the data layer: `TeamsView` keeps calling the injected `loadOlder` (the Session face's page-back verb, resolved in the slot's `inject` exactly as the trajectory view resolves it) while the fold holds no team and the window has more history, bounded at 400 pages and dropping late completions after unmount. Once a start event enters the window the drain stops.
- Upstream's interaction vocabulary (segmented progress, roster, dependency DAG) is adopted deliberately; its body-portal floating layer and polled host route remain rejected — the tab still renders only what the session log replay produces.

## Alternatives considered

**Host-side projections for the team snapshot (read a session projection instead of client folding).** Rejected for now: the projection surface would duplicate the fold reducer that the chat card and the tab must share, and the drain fixes the actual failure at a fraction of the change.

**Downgrade rendering for start-less teams (build nodes from updates alone).** Rejected: member and task lists would render partially and misleadingly; the empty state plus an automatic drain is honest and self-healing.

**Auto-loading full history on session open for every view.** Rejected: it taxes every conversation open for one tab's benefit; the drain runs only while the Teams tab's fold is empty and more history exists.

## Consequences

- The Teams tab now shows live progress in long sessions without manual scrolling; the fix is user-visible and belongs to the same PR as the dashboard.
- `PatentTeamsCardData` gains a required `activity` field (constructed in one place); external producers of the projection type would need the new field at their next build.
- The DAG layout is pure and deterministic from fold order; dependency cycles in team state cannot hang it (back-edges resolve as root depth).
- Live verification against a real field session surfaced a deeper, server-side case the drain cannot cover: a session continued after a harness restart serves a reseeded journal (cursor at the seed boundary, `hasMore` false) whose seed carries only model-visible events — the ignorable `patent-teams/*` events never re-enter the journal, so the fold cannot rebuild the team no matter how much history is loaded. Closing that case needs a seed/persistence decision: carry ignorable plugin events through seeding, or give the view a host surface onto the on-disk team state (the upstream project's disk-truth route).

## Testing

`vitest run packages/client/ui-patent-teams` is green (49 cases) with the package at per-file 100% coverage: `teams-dag.spec.ts` pins layout determinism, cycle tolerance, chain closures, segment counts, and task bindings; the fold spec pins the capped newest-first activity feed and unknown-task verdicts; the client specs pin the dashboard render (hero, legend, roster bindings, DAG hot/dim states, feed kinds), the drain loop, its stop condition, and the unmount race; the plugin lifecycle case exercises the view entry's label, inject, and loud missing-binding throw.
