# Agent Note: Preset personas carry identity and routing, not tool mechanics

Status: implemented

English | [中文](2026-10-12-persona-carries-identity-not-mechanics.zh.md)

## Problem

An agent preset's persona is a fixed prefix paid on every request; a bundled skill is paid when a case loads it. The `patent` persona had grown into an operations manual: of its 15,498 characters, roughly 6,000 described how to reach the cnlaw legal base (MCP call forms, REST endpoints with their query parameters, the IPC tree, the per-case decision chain), how to fall back through the retrieval channels, and which result keys a validation tool reports. A draft or a search needs that text; a case that only computes a deadline does not.

Two properties made the growth invisible. No gate measured the persona, and no recorded session replays it: the keyless snapshot lane runs the headless profile, which mounts no agent preset, so no expected output contains a persona line. The `patent-preset.spec.ts` cases that did read the persona asserted single rules (the cnlaw declaration, the evidence check, the figure route), not that the discipline set survived a rewrite.

## Decision

The persona carries identity, the nine work disciplines, the work-mode routing that chooses between single-session intent-driven execution and the opt-in team flow, the case-type routing table, the standard workflow, and the output discipline. The mechanics move to the skill each routing line already names:

- Law-base channels, REST call forms, query parameters, and citation formats move to `patent-fact-check`, which already owns "where a verified source comes from"; the graph and per-case decision-chain MCP call forms join `inventive-step-analysis`, which already documents the four-step evidence pack.
- The patent-document download chain moves to `patent-prior-art-search`, whose channel table it belongs to; the figure-tool routes and the figure index move to `patent-quality-gate` and `patent-document-polish`; the workbench bridge moves to `patent-matter`; the team-channel reason and the team-size threshold move to `patent-team-composition`.
- Deployment-varying values leave the persona entirely: the figure font floor and face size are stated as the firm's 小四/四号 requirement, and the values themselves stay in the `patent-tools` Config fields the generating and verifying tools read.

Two checks hold the placement. `scripts/preset-mode-baseline.json` gives each delivery mode a `personaMaxChars` ceiling (12,000 for `patent`), enforced by `verify-preset-mode-baseline`. `patent-preset.spec.ts` anchors each of the nine disciplines on the phrase that carries its meaning and asserts the mandatory disclaimer verbatim, so dropping a discipline fails a test instead of leaving every gate green.

## Alternatives considered

- **Keep the mechanics in the persona.** Rejected: the cost is paid on every request, including the ones that never reach a legal base, and the persona already named the skill that owns each subject.
- **Add a cnlaw channel skill.** Rejected: `patent-fact-check` already answers where a citation's source comes from; a second skill would split one subject across two load-time units and two homes.
- **Cap the persona in `scripts/doc-budgets.manifest.json`.** Rejected: that manifest budgets documentation prose, while this ceiling is part of what a delivery mode is, which is the mode baseline's subject.
- **Assert the persona's content by snapshotting it.** Rejected: the snapshot lane does not mount a preset, and an expected file holding 9 KB of prompt text would fail on every wording fix.

## Consequences

- The persona body is 10,177 characters (9,177 when this decision shipped). A request pays for the channel mechanics only after a case loads the skill that carries them; the text itself is unchanged in meaning. The work-mode routing added on 2026-10-15 is persona content under the same rule — routing stays, mechanics go — and the two decisions it reserves for the user are enforced in the plugin rather than stated here: [the team-opt-in note](../feature/2026-10-15-patent-team-opt-in-approval.md).
- The moved text keeps the rule that no model-visible patent text spells out a cnlaw endpoint literal: the skill is scanned by the same assertion as the persona, and the endpoints still come from the section `patent-law` renders from Config.
- `verify-preset-tool-refs` now resolves the moved references through the skills; the parameter and result-key names the persona gained backticks around are recorded as exempt references with the tool that owns each one.
- The discipline anchors are a hardcoded list: adding or removing a discipline means editing that list, which is the intended cost of having no other mechanical check over the persona.
