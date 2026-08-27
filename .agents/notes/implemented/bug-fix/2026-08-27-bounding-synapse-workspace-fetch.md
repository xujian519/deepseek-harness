# Agent Note: Bound concurrent Synapse workspace detail fetches

Status: implemented

English | [中文](2026-08-27-bounding-synapse-workspace-fetch.zh.md)

## Problem

`threadsForDshWorkspace` in `packages/web/synapse/assets/app.js` resolved the threads for one dsh workspace by requesting the detail of **every** workspace summary in a single unbounded `Promise.all`:

```js
const projections = await Promise.all(state.summaries.map(summary => api(`/synapse/api/workspaces/${summary.id}`)))
```

Every time the user opened a dsh workspace, this fanned out one `GET /synapse/api/workspaces/<id>` per summary at once. With many workspaces the renderer exhausted its request budget, and Chromium surfaced `net::ERR_INSUFFICIENT_RESOURCES` across a whole burst of those requests — the renderer reported "Failed to fetch" for a large set of workspace IDs, with the same ID requested repeatedly as the function re-ran.

## Decision

Fold the fetches in bounded batches instead of one burst:

```js
const summaries = state.summaries
const projections = []
for (let i = 0; i < summaries.length; i += 5) {
  const batch = summaries.slice(i, i + 5)
  projections.push(...await Promise.all(batch.map(summary => api(`/synapse/api/workspaces/${summary.id}`))))
}
```

At most five `api` calls are now in flight at any moment; the slice order is deterministic, so the projection `flatMap` filter below is unchanged. No workspace is re-fetched within one pass, and the function no longer floods the renderer.

## Alternatives considered

**A backend batch endpoint returning every workspace in one response.** Rejected because it changes the host API surface for a view-local problem; the front-end already fetches per-id, and the fix belongs to scheduling, not to the wire contract.

**Fetch only the current workspace's detail.** Rejected because the function deliberately scans all projections to find threads that belong to the requested `sessionIds` — the threads are distributed across workspaces, so a single-detail fetch would miss them without a schema change.

**No change; tolerate the failed fetches.** Rejected because the resource exhaustion degrades the session-map surface and can precede a renderer crash.

## Consequences

The workspace-detail requests are spread over time instead of fired all at once, so the renderer no longer trips `net::ERR_INSUFFICIENT_RESOURCES`; the "Failed to fetch" toast on the session-map view is gone. The total number of requests is unchanged (the function still reads every summary), and the batch loop introduces a small sequentialization cost that is negligible next to the per-request latency.
