# Agent Note: Bound Synapse session-sync POSTs

Status: implemented

English | [中文](2026-08-27-bounding-synapse-session-sync.zh.md)

## Problem

`syncSessions` in `packages/client/synapse/src/client/index.ts` POSTs `/synapse/api/sessions/sync` on every session or workspace list change, coalesced only at the microtask level:

```js
const syncSessions = () => {
  if (syncQueued) return
  syncQueued = true
  queueMicrotask(() => {
    syncQueued = false
    // ... POST /synapse/api/sessions/sync ...
  })
}
```

`ctx.sessions.list` and `ctx.workspaces.list` both subscribe `syncCurrentSession`, so the burst does not come from a single loop but from the runtime firing the subscription on every list change. A team task that spawns many subagent sessions in quick succession drives that subscription over and over; each microtask batch emits another sync POST. The backend handles each POST by running `store.syncSessions` over the full projection and returning workspace summaries, which re-arms the workspace subscription and can feed the loop. The renderer's concurrent-request budget is exhausted and Chromium surfaces `net::ERR_INSUFFICIENT_RESOURCES`, which can precede the renderer crash behind the session-map white screen.

## Decision

Replace the microtask coalescing with a trailing debounce that merges the burst into one POST:

```js
const SYNC_DEBOUNCE_MS = 300
const syncSessions = () => {
  if (syncTimer !== 0) window.clearTimeout(syncTimer)
  syncTimer = window.setTimeout(() => {
    syncTimer = 0
    const sessions = sessionRows()
    const sessionIds = new Set(sessions.map(session => session.id))
    const removedSessionIds = [...knownSessionIds].filter(id => !sessionIds.has(id))
    knownSessionIds = sessionIds
    void fetch('/synapse/api/sessions/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessions, removedSessionIds }),
    }).catch(() => {})
  }, SYNC_DEBOUNCE_MS)
}
```

The timer is cleared on dispose. `removedSessionIds` is computed from the final snapshot after the debounce window rather than from the first change that opened it, so a session that disappears and reappears within the window is not reported as removed; a session removed and not resurrected is still reported once.

## Alternatives considered

**Keep microtask coalescing; add no debounce.** Rejected because the burst spans macro tasks, not a single microtask batch: several list changes in one tick are merged, but changes across ticks each POST separately, which is exactly the team-task pattern.

**Backend batch or rate-limit.** Rejected because the burst is a front-end scheduling problem; the backend `store.syncSessions` replay is already revision-keyed and cheap.

**Raise the renderer request budget / tune Chromium.** Rejected as neither a tunable in this repo nor a fix for the closed sync→workspaces→sync feedback.

## Consequences

Sync POSTs are now bounded to roughly one per 300 ms of session/workspace churn instead of one per subscription fire, so the renderer no longer trips `net::ERR_INSUFFICIENT_RESOURCES`. The total sync payload is unchanged — the debounce still sends the final full session set. This complements, and does not replace, the earlier fetch-side batching of workspace-detail and thread-history loads: that change bounded how many detail requests were in flight, this one bounds how often the session sync is pushed.
