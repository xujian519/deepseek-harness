# Agent Note: Workbench case bridge (workbench_link_patent_case)

Status: implemented

English | [中文](2026-09-03-workbench-case-bridge.zh.md)

## Problem

The patent workbench (patent preset + `packages/patent/*`) has no task/calendar surface, while the separately mounted personal-workbench plugin (`@dely0/dsh-personal-workbench`) owns a mature one over its own `case.db`. Linking a patent case into that surface needs a writer on the workbench's data, but the external package exports no data layer (exports are only `.` / `./client` / `./package.json`) and its host half provides no Cordis service — importing its internals or opening its SQLite directly would create a second writer beside the plugin, and the case audit trail (`_matter-log.md`, the single source of truth) must never become writable from the task side.

## Decision

- `@deepseek-ai/dsh-patent-tools` registers a 27th model tool, `workbench_link_patent_case`: an idempotent bridge that talks to the workbench only through its loopback HTTP API (`/api/workbench/*`). Base URL resolution: Config `workbenchBaseUrl` → the in-process `webServer` service port (web compositions) → absent means the tool fails at execute with `setup_required` (non-web profiles have no workbench to talk to).
- The bridge ensures six `type` dictionary entries (`patent_case`, `patent_stage_l1..l5`) via `POST /api/workbench/dictionaries`, finds or creates the root task (title = case number, `source='patent'`, `workspace_path` = the case directory) plus the five L1–L5 stage subtasks, and projects stage progress onto subtask statuses. All writes are idempotent: find-or-create, PATCH only when the status actually changes.
- Projection is one-way, `_matter-log.md` → task statuses. The parse is a line-level heuristic: a line carrying `\bL[1-5]\b` plus a completion word (完成/通过/✅/已交付/归档) marks `done`, a progress word (进行/开始/推进/启动) marks `doing`, later lines override earlier ones; an explicit `stages` input outranks the heuristic. The reverse direction (workbench → case files) is not implemented; the tool never writes inside the case directory.
- The root task's status is never PATCHed: the workbench's status PATCH cascades completion to open children, so the bridge only PATCHes stage subtasks and leaves the root untouched.
- `tasks.source='patent'` marks bridged tasks: the column is free text, not dictionary-validated, so no upstream change is needed alongside `manual` / `nl` / `recurring`.
- Prompt split (one home per fact): the plugin's injected guide keeps the generic workbench collaboration rules (draft confirmation, acceptance loop, shared memory, scheduling proposals — `announceToAgent` stays on so standard sessions keep the guidance); the patent preset persona gains a "个人工作台协作" section carrying only the patent delta — bridge usage, `_matter-log.md` as the single source of truth, no reverse writes.

## Alternatives considered

- Merging the two prompt sections into one: a mechanical merge would leave standard sessions without any workbench guidance and would restate the plugin's rules — rejected for the one-home-per-fact rule.
- An `agent/status`-idle automatic pull (the design doc's second trigger): needs session-event wiring plus `task_sessions` binding queries for little gain — the tool call itself is the only trigger (pull model); recorded as deferred work in the design doc.
- Importing the external package's data layer or writing its SQLite directly: the exports map and the missing `ctx.provide` make both a second-ledger hazard — the HTTP path keeps one writer (the `dsh web` host running the plugin).

## Consequences

- `case.db` keeps exactly one writer process (the web host); the bridge is just another API client, so workbench upgrades that keep the HTTP surface cannot desync the bridge.
- Case progress appears in the workbench UI only after someone (the model, on the persona's instruction) calls the bridge; the workbench never reacts to case-directory changes on its own.
- patent-tools gains a peer/dev dependency on `@deepseek-ai/dsh-host-webserver` for the `webServer` service declaration merge.

## Testing

- Unit (`packages/patent/patent-tools/tests/workbench-link-patent-case.spec.ts`, 15 cases): heuristic parsing (last-wins, multi-stage lines, no match); an in-memory workbench simulator covers first link, idempotent relink, progress pull, explicit override, dryRun zero-write, read-only case dir, and fail-closed paths (empty case number `invalid_tool_input`, missing base URL `setup_required`, HTTP failure and malformed wire rows `tool_execution_failed`). `registration.spec.ts` now asserts the exact 27-tool set.
- Live end-to-end on the `web-wb` profile (real plugin + real `~/.dsh/workbench/case.db`): a fresh case number creates root + five stages with the projection landed (L1=done, L2=doing in the DB), a relink writes nothing, and the workbench UI's task tree shows the stages and statuses after expanding the case row. The run is recorded in the Phase 5 checklist of `docs/dsh-workbench-integration-design.md`.
