# Agent Note: Queryable team archives and state-helper cleanup

Status: implemented

English | [中文](2026-09-02-patent-teams-archive-tool.zh.md)

## Problem

`patent_teams_delete` archives the team directory under `archive/` "for later review", but nothing could read the archive back: `readArchivedTeam` and `listArchivedTeamIds` had no runtime consumer. Four more `state.ts` helpers were dead: `readTeamSync` lost its only caller when the v0.1.2-alpha.4 sync moved member routing onto the creation request's durable descriptor, `removeTeamDir` was superseded by archive-on-delete, and `taskVisualState`/`taskDepthsById` projected the upstream activity panel that the client port deliberately did not re-implement.

## Decision

- Close the archive loop with an eleventh read-only tool, `patent_teams_archive`: without arguments it lists every archived team of the caller's workspace (id, name, member and task counts); with `team_id` it returns that team's archived members and tasks. Any calling agent may read (the archive is workspace-scoped); no session events are appended because the read mutates nothing, and the render truncates task output to 300 characters like `patent_teams_status`.
- Delete the four dead helpers and their tests. Test fixtures that simulated a vanished team through `removeTeamDir` now call `rm` from `node:fs/promises` directly.
- The captain usage section names the tool and states that deleted teams stay reviewable read-only.

## Alternatives considered

**Delete the archive readers too and downgrade the README promise.** Rejected: archive-on-delete is documented and rendered by `patent_teams_delete`; a read seam over two existing functions is smaller than withdrawing a shipped promise.

**Expose archived teams through `patent_teams_status`.** Rejected: status is participant-scoped on an active team; archived teams have no participants, so the query would need a different authorization path anyway.

**A Web UI archive browser.** Deferred with the existing cross-session aggregator limitation: it needs a new host query surface, while the tool answers the review need now.

## Consequences

- Eleven `patent_teams_*` tools; the generated tool catalog, both README languages, and the usage-section verbatim text updated together, pairing re-recorded for `docs/tool-catalog` and the package README.
- The fixed usage section grows to approximately 2.4 KB; the README previously claimed 0.9 KB for an already-longer text, and the number now matches measurement.
- Archived team records carry no deletion timestamp; `created_at` is the only timestamp an archive row reports.
- No recorded-session snapshot exists for any `patent_teams_*` tool yet; this change is covered by package tests and inherits that known gap rather than adding the first recorded case.

## Testing

`vitest run` over the package is green (287 tests): new archive cases in `service.spec.ts` (list, detail, unknown id, empty workspace), tool routing and render cases in `tools.spec.ts`, roster updates in `index.spec.ts` and `loader-composition.spec.ts`; `gen-tool-catalog` regenerated both catalog languages and the pairing hashes were re-recorded.
