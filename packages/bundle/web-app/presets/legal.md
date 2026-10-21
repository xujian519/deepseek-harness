# Legal agent preset

English | [中文](legal.zh.md)

The `legal` agent preset composes a personal Chinese-law practice agent on the DeepSeek Harness. This bundle declares it in `presets/legal.patch.yml` and ships its content under `skills/legal/`.

## What it mounts

Beyond the standard working rows (shell, filesystem, jobs, reminders, skills, the goal command and tool, plan mode, compaction, delegation, web, and the clock row), the preset adds two deliverable rows: `@deepseek-ai/dsh-doc-template` renders Markdown/DOCX/PDF from reviewed templates, and `@deepseek-ai/dsh-document-deliver` records the delivered files and runs its deterministic document checks. The persona adds the legal identity, the citation discipline, and the delivery gate.

`tool-web` runs with `search: false` and `fetch: true`. Retrieval goes through ego lite: the model runs `ego-browser nodejs` in `tool-bash` and follows the `legal-research` skill, so a search summary never stands in for an inspected source. `web_fetch` stays as a static fallback for public pages when the browser is unavailable. No legal MCP server is mounted.

## State layout

Every writable path is inside the session workspace, which keeps all mutations under the `workspace-write` sandbox:

- `./.legal/company-profile.md` — shared personal/practice facts.
- `./.legal/practice/<domain>.md` — practice profiles for the four domains.
- `./.legal/references/` — shared references and domain law baselines.
- `./.legal/research/evidence.jsonl` — retrieval evidence.
- `./matters/<slug>/` — case workspace: `matter.md`, `input/`, `work/`, `output/`, `research/`, `audit/matter-log.md`.

Open your legal work root (for example `~/legal-workspace`) as the session workspace. `legal-setup` seeds the templates without overwriting edited profiles.

## Skills

Four imported domain libraries, namespaced so the flat catalog has no collisions:

- `legal-commercial-*` — 11 skills: NDA, vendor, SaaS/MSA, construction contract review, renewal tracking, escalation, cold start.
- `legal-litigation-*` — 19 skills: matter intake, chronology, claim chart, demand letters, legal hold, privilege log, deposition preparation, neutral hearing outline, cold start.
- `legal-employment-*` — 19 skills: hiring, termination, worker classification, wage-hour Q&A, policy drafting, internal investigations, leave tracking, cold start.
- `legal-research-*` — 5 skills: authority check, case comparison, issue memo, lecture source pack, cold start.

Five hand-written mode skills:

- `legal-setup` — seed the workspace layout.
- `legal-matter` — create, list, switch, and close cases.
- `legal-research` — ego lite retrieval with an evidence log.
- `legal-citation-check` — verify statutes, interpretations, and cases.
- `legal-quality-gate` — P0/P1 delivery gate and disclaimer.

## Deliberate omissions

`tool-plugin-market`, `present`, and `tool-plugin-manager` stay out: this is a personal composition, and installing or editing plugins is a deployment action taken through the `dsh plugin` CLI. Scheduled agents and cookbooks from the source corpus are not ported in this phase because they depend on Slack, mail, and commercial MCP integrations. Their manual skills remain available, and `tool-schedule` can create reminders; the watcher agents themselves have no running counterpart.

## Provenance and license

The imported corpus comes from [claude-for-legal-ZH](https://github.com/CSlawyer1985/claude-for-legal-ZH) 1.1.0, Copyright 陈石律师 / CSlawyer1985, licensed under the Apache License 2.0. `skills/legal/LICENSE` and `skills/legal/NOTICE` carry the license and attribution; `skills/legal/SOURCES.md` records the source version and commit. The modifications are listed in the NOTICE: namespaced skill names, rewritten paths and commands, one matter pointer, and ego lite retrieval. The surrounding bundle remains MIT.

## Windows

The mode skills include PowerShell equivalents for workspace setup and matter management; retrieval through `ego-browser` works on Windows with the `%TEMP%` request path documented in `legal-research`.

## Prerequisites

- `ego-browser` on `PATH`; run `ego-browser skill` once per installed version.
- A session workspace the user owns; profiles still containing `[PLACEHOLDER]` require the matching `legal-<domain>-cold-start-interview`.
- A DeepSeek API key for the model. Sessions are personal; enable log upload or telemetry only deliberately.
