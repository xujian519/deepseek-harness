# Agent Note: patent-deadline as a root-scoped service

Status: implemented

English | [中文](2026-10-03-patent-deadline-service.zh.md)

## Problem

A plugin mounted at the profile root — the patent workbench, which keeps a case deadline board — needs the Chinese patent deadline computation for the cases it stores. The rules live in exactly one place, `@deepseek-ai/dsh-patent-deadline`: pure functions (`evaluateDeadlines`, `periodEnd`, `resolveDeliveryDate`, `WorkCalendar`) plus the model-facing `patent_deadlines` tool.

The package cannot be reached from where the consumer sits. The patent preset mounts it inside the agent preset's isolated realm, and an isolate's tool registry is realm-local, so a root-domain sibling cannot find the tool. The package is not published to npm, so the workbench cannot declare a dependency on it; and a consumer that reimplemented the periods would become a second authority for them — the failure the whole integration is built to avoid. The evaluator therefore has to cross the plugin boundary as a root-scoped Cordis service.

Related: [the workbench case bridge](2026-09-03-workbench-case-bridge.md) covers the other direction of the same integration (a patent-side tool writing workbench tasks).

## Decision

- `@deepseek-ai/dsh-patent-deadline` gains two optional `Config` fields: `provideService` (default `false`) and `exposeTool` (default `true`). With `provideService` on, `apply` publishes the `patentDeadline` service; with `exposeTool` off it skips tool registration. The defaults leave the preset row's behavior exactly as it was: tool only, no service.
- A deployment that needs the service registers the same package a second time at the profile root with `{ provideService: true, exposeTool: false }`. The two loader rows share one plugin name but carry distinct entry ids, and only a duplicate entry id is fatal — the root row adds no second model-facing tool, and the preset row keeps the tool inside its realm.
- `service.ts` is a pass-through to the pure functions: `evaluate(query, options?)`, `periodEnd`, `resolveDeliveryDate`, `describePatentKind`, and `calendarCoverage()`. It restates no period, delivery, or rest-day rule; `evaluate` requires the caller to supply `today`, so a report is reproducible and never depends on the host clock.
- Dates cross the boundary as `CalendarDate` (`{ year, month, day }`) — JSON-shaped, so a consumer never re-parses the calendar.
- `calendarCoverage()` returns the years the loaded holiday arrangement covers. A consumer uses it to say an end date's year is unverified instead of presenting a roll-forward that was never checked. The shipped asset covers 2025–2026.
- The consumer probes `ctx.get('patentDeadline')` and never puts it in `inject`. An absent service degrades to an explicit "deadline engine unavailable — enter deadlines by hand"; it never falls back to a second computation.

## Alternatives considered

- **A new service-only package (`@deepseek-ai/dsh-patent-deadline-service`).** The unique plugin name is the cleanest semantic, but the [adding-a-package](../../../../docs/cookbook/adding-a-package.md) checklist (TypeScript aggregate reference, README Model Experience and limitations sections, locale pair plus its translation record, per-file 100% coverage, tool-catalog regeneration) costs far more than the seam it adds, and a wrapper whose `apply` only forwards to the library carries no logic of its own. Rejected.
- **Mounting `patent-deadline` at the profile root as it is.** This publishes `patent_deadlines` to every session rather than only patent-mode ones. The `exposeTool` switch exists so the tool keeps its scope while the service becomes reachable.
- **Depending on the package from the consumer.** It is not on npm, and a copy installed beside the consumer would give the deadline rules two implementations to drift apart. Rejected.
- **Duplicating the periods in the workbench, or a translation layer between two vocabularies.** Rejected: the workbench maps its own records into the engine's input shape and nothing more, and the enums (`PatentKind`, `NoticeKind`, `DeliveryMode`, the six case stages) are byte-identical across the boundary.

## Consequences

- Tool-only deployments are unaffected: no new service, no behavior change, and the preset row's configuration stays as it was.
- A deployment that wants the service adds a second loader row for the same package. Both rows read the same calendar asset, so their coverage years agree.
- The service surface is a cross-repo contract with no shared type package. A consumer mirrors `PatentDeadlineService` / `DeadlineQuery` / `DeadlineReport` structurally and must be updated when the engine changes that shape; the package README is the reference for it.
- `evaluate` never reads the host clock: a caller that wants "today" for status and days-remaining fixes it explicitly, which is what makes a stored report's provenance meaningful.
- The consumer persists only dated results; deadlines the engine reports as `pending` (a missing grant publication date, say) have no end date, so they stay in the response instead of occupying a real-date column with a placeholder.
