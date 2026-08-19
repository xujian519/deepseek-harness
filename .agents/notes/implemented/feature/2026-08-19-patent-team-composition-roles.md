# Agent Note: Patent preset durable-team roles extended with technical-expert and applicant-counsel

Status: implemented

English | [中文](2026-08-19-patent-team-composition-roles.zh.md)

## Problem

The `patent` agent preset's durable-team practice (dsh-agent-teams, verified in phase 4 of patent-workbench-tasks.md) used three members — researcher / drafter / adversarial-reviewer. Two real-world positions were missing for prosecution: technical-expert (verifies embodiment facts, effect-data reproducibility, domain plausibility) and applicant-counsel (argues for maximal claim scope against the reviewer's contraction). Beyond prosecution, the invalidation and infringement-litigation procedures add positions the template did not model at all: the petitioner (attacker), the patentee (defender/plaintiff), the adjudicating panel/court, the accused infringer's counsel, and the court's neutral technical fact-finding (technical investigator / expert assessor). Real procedures (CNIPA invalidation with oral hearing and evidence rules; Beijing IP Court technical-investigator practice; IP-court "four-in-one" technical fact-finding of investigator + expert assessor + lay assessor + appraiser) require paired adversarial positions plus a neutral adjudicator, not single-party review. Surveying the full lifecycle also showed two procedure-heavy scenarios with no modeled positions at all: case intake (disclosure receipt → preliminary search → feedback loop until the disclosure is sufficient) and formal correction (CNIPA correction notice for formal defects, 2-month limit plus 15-day deemed-service rule).

## Decision

`patent-team-composition` (`apps/cli/config/agent-presets/patent/skills/patent-team-composition/SKILL.md`) is restructured into seven scenario role packs covering the full lifecycle, each within the plugin's `maxMembers` default of 8:

- **Case intake (4):** case-manager, researcher, technical-expert, drafter — disclosure registration, preliminary search and patentability screening, quality assessment, feedback loop to the applicant until the disclosure is sufficient, intake sign-off.
- **Drafting (5):** researcher, drafter, adversarial-reviewer, technical-expert, applicant-counsel.
- **Office-action response (5):** the same five as drafting; the drafting team continues without rebuilding.
- **Correction (2):** drafter, formal-examiner — defect-list parsing, correction sheet / replacement pages, defect-elimination verification.
- **Reexamination (5):** researcher, drafter, adversarial-reviewer, applicant-counsel, adjudicator — the adjudicator simulates the pre-examination by the original examining division (which may withdraw the rejection) and the panel review with oral hearing.
- **Invalidation (6):** researcher, drafter, technical-expert, invalidity-petitioner, patentee-defender, adjudicator.
- **Infringement litigation (6–7):** researcher, drafter, technical-expert, patentee-defender, defendant-counsel, adjudicator, plus optional tech-investigator for high-value cases.

Two roles are added to the roster (10 → 12): `case-manager` (process-neutral intake and deadline monitoring) and `formal-examiner` (preliminary-examination viewpoint for correction verification). Each pack fixes a task DAG; paired positions (petitioner × patentee; patentee × defendant) converge on a neutral adjudicator task that simulates oral hearing / trial, weighs evidence, and predicts the outcome; the captain consolidates and keeps the HITL checkpoints. The design doc §8.4 fold note: the old one-shot `subagent_fork` "无效反方" role is merged into the patentee-defender position in the template. Roles are realized purely through `agent_teams_add_member`'s free-form `role` field — no plugin change. This is the preset-layer configuration adaptation already decided in patent-workbench-tasks.md phase-4 checklist item 3 (install the original plugin, adapt at preset layer, do not fork).

## Alternatives considered

**One flat team with all twelve roles.** Rejected: the plugin's `maxMembers` defaults to 8, and a single team with every position would mix incompatible stances (the prosecution applicant-counsel's expansion goal contradicts the invalidation patentee's narrowing-for-survival goal) and bloat each member briefing.

**Modeling intake and correction inside the drafting pack.** Rejected: intake is a feedback-loop process with its own sign-off criterion (disclosure sufficient for drafting) and correction is a lightweight two-member defect-verification loop; both would distort the drafting DAG if merged.

**Directly editing the archived team `patent-team-202311060998`.** Rejected: archives are immutable runtime records; the change must live in the reusable template, not a finished case.

**Forking the plugin to add role plumbing or multi-team support.** Rejected: the plugin's `role` string already carries arbitrary roles, and one active team per captain is an accepted boundary; the template needs no plugin work.

## Consequences

- `pnpm run verify-cordis-config`: 135 config files passed (modified `agent.cordis.yml` parses and composes).
- `pnpm run verify-translation-pairing` for the preset README and this note: pairs consistent, hashes re-recorded.
- `pnpm run verify-agent-note-format`: 570 notes conform.
- Skill metadata gates (`verify-skill-invocation-metadata`) do not cover `apps/cli/config/agent-presets/*/skills/`, so the SKILL.md is outside that gate.
- On deployments without the dsh-agent-teams plugin the persona line instructs a fallback to single-session `subagent_fork` expert review; the team tools only exist where the plugin is mounted.
