# Agent Note: Converge the two divergent patent presets into the shipped canonical

Status: implemented

English | [中文](2026-08-25-patent-preset-convergence.zh.md)

## Problem

Two divergent `patent` agent presets coexisted. The tracked/shipped one at `apps/cli/config/agent-presets/patent/` carried 8 skills, mounted `dsh-patent-teams`, and taught `patent-team-composition`. A user-home copy at `~/.dsh/.agent-presets/patent/` carried 11 skills, used the generic `agent_teams_*` backend plus a thin `patent-team-workflow` skill, and additionally held the case-management and double-gate skills (`patent-matter`, `patent-fact-check`, `patent-compliance-review`) plus the docx-delivery and HITL gate rules. Because the desktop profile-boot configures the shipped preset root first and the roster is first-root-wins per id, the shipped preset shadowed the user-home copy — so the stage-2/3 work the user validated lived only in the inert, shadowed copy. The pair also disagreed on the team backend (`dsh-patent-teams` vs generic agent-teams) and on the team state directory (`.agent-teams/` vs `.patent-teams/`).

## Decision

One canonical preset at `apps/cli/config/agent-presets/patent/` (tracked; deployed by `package:desktop`), carrying the union of the two and discarding the shadowed copy:

- **Team backend**: keep `dsh-patent-teams` (`patent_teams_*`, `ctx.patentTeams`) + skill `patent-team-composition`, as recorded in [the wiring note](2026-08-23-wire-patent-teams-into-preset.md). The generic agent-teams + `patent-team-workflow` route is dropped.
- **Merged into the canonical preset**: `patent-matter`, `patent-fact-check`, `patent-compliance-review` (new in `skills/`); `patent-quality-gate` gains items 8 (HITL 放行, ask_user before delivery) and 9 (docx: md-drafted, tracked-changes revisions, original unmodified) plus the ask_user-confirm flow and the patent-fact-check cross-reference; `patent-workspace-layout` gains the `_matter-log.md` and `.patent-teams/` lines (`.patent-teams/` replaces the generic `.agent-teams/`); the persona's「输出纪律」gains the md→docx→tracked-changes delivery rule.
- **Unit of count**: the workspace convention is seven business subdirectories (`00-交底书`/`01-检索`/`02-对比文件`/`03-分析`/`04-撰写`/`05-答复`/`99-知识库`) plus the `_case-registry.md` and `_matter-log.md` tracking files; the older "八级" wording is corrected to this.
- **Archived**: `~/.dsh/.agent-presets/patent/` moved under `~/.dsh/.agent-presets-archive/patent-<timestamp>/`, out of the user preset root so it no longer shadows.

## Alternatives considered

**Keep the user-home preset as canonical (generic agent-teams + patent-team-workflow).** Rejected: it is not tracked, the app loads the shipped root first (so it is shadowed and inert), and it forgoes the domain-scoped `patent_teams_*` session events and the seven-scenario `patent-team-composition` model the design document specifies.

**Keep both presets and make precedence explicit.** Rejected: the user wants one set; two coexisting `patent` ids with different team backends and state directories is exactly the ambiguity this converges away.

**Merge into the desktop resources artifact rather than `apps/cli`.** Rejected: `apps/desktop/resources/**` is gitignored (packaging output), so the durable source must live in the tracked `apps/cli/config/agent-presets/patent/` that `package:desktop` deploys.

## Consequences

- The canonical preset now has 11 skills and mounts `dsh-patent-teams` behind `isolate.patentTeams`; the stage-2 case-management/double-gate skills and the docx/HITL delivery rules reach the running app, which on a fresh deploy loads this preset.
- The user-home divergent copy is archived (preserved, not deleted) under `~/.dsh/.agent-presets-archive/`; `verify-cordis-config` continues to be the composition gate for the single remaining preset.
- The previously noted `fetch: false` regression (design's defense #2 cannot open source pages via `web_fetch`) is left as a separate follow-up, not changed here.
- `patent-team-workflow` is no longer taught anywhere; `patent-matter`'s state machine is the case-management authority and `patent-team-composition` the team-composition authority, cross-referenced by the workspace-layout skill.
