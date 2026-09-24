---
description: "Function plugin for the [document agent preset](../../bundle/web-app/presets/document.patch.yml): one model-facing `document_deliver` tool that records the delivered files, formats, and quality-gate outcome, and reads those files to report its own deterministic document checks beside the model's declaration. The call is session-logged, so the [delivery studio](../../../packages/client/ui-document-studio/README.md) derives the deliverable list and both gate columns from the log and the result metadata — no new session event type, no host write RPC."
kind: "package-reference"
---

# @deepseek-ai/dsh-document-deliver

English | [中文](README.zh.md)

## Summary

Function plugin for the [document agent preset](../../bundle/web-app/presets/document.patch.yml): one model-facing `document_deliver` tool that records the delivered files, formats, and quality-gate outcome, and reads those files to report its own deterministic document checks beside the model's declaration. The call is session-logged, so the [delivery studio](../../../packages/client/ui-document-studio/README.md) derives the deliverable list and both gate columns from the log and the result metadata — no new session event type, no host write RPC.

## Table of Contents

- [What it mounts](#what-it-mounts)
- [Deterministic checks](#deterministic-checks)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## What it mounts

- **`document_deliver`** — declares `files` (`{ path, format }`, format from `markdown | html | pdf | docx | pptx | other`), `gate` (a required `p0` list of passed checks, an optional `p1` list), an optional `brief_ref`, an optional `style` name, and an optional `char_budget` in characters. It resolves each path against the calling session's workspace, fails loud when a file is missing (a ghost file is not a deliverable), reads each delivered file for the deterministic checks, and confirms the registration with the P0/P1 counts, the style it checked against, and one check report per file.

<a id="deterministic-checks"></a>
## Deterministic checks

The tool reads the delivered bytes rather than trusting the declaration. Markdown and HTML are read as text; a `.docx` package is projected to text through [`@deepseek-ai/dsh-docx-kit`](../docx-kit/README.md) under the configured `maxArchiveEntries` and `maxUncompressedBytes` budgets; a format with no text reader (`pdf`, `pptx`, `other`) is reported as `unchecked` with the reason instead of a pass. A package that exceeds a read budget is reported `unreadable` with `too-large` in its reason, never truncated.

| Check | Reported when | Level |
| --- | --- | --- |
| `placeholder` | A residual `{{variable}}`, `[TBD]`, `[REPLACE]`, `Lorem ipsum`, or `待补充` remains | `block` outside quoted text, `warn` inside a code fence or an inline code span |
| `anti_pattern` | The selected style lists the word as forbidden | the style's own `block` or `warn` severity |
| `empty_section` | A heading's section holds no content before the next heading | `warn` |
| `broken_anchor` | A `](#fragment)` or `href="#fragment"` names a fragment the document declares no id, named anchor, or heading slug for | `warn` |
| `length_budget` | A declared `char_budget` is missed by more than the configured `lengthTolerance` (shipped default 20%) | `warn` |

A `block` finding throws: the registration is refused and the error names the file, the check, and the line, so the model fixes the document instead of registering it. A `warn` finding is recorded and the registration proceeds, because each has a reading a reviewer may accept. The style comes from `defaultStyle` and the budget tolerance from `lengthTolerance`, both named in the tool description; a style name no loaded style carries fails the call and lists the loaded names. Every finding is capped at five per check, with the remainder summarized rather than dropped.

## Model Experience

### Tool schemas

#### What the model sees

One registered tool definition: `document_deliver` with its parameter schema (file list with formats, gate checklists, optional brief reference, style name, character budget) and the confirmation render, which carries the model-reported P0/P1 counts, the deterministic outcome per file, and each warning line. The exact description and parameters are in the generated [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-document-deliver).

#### Token effect

Fixed definition cost of one tool on every request; the result is the confirmation plus one line per warning, resent only until compaction. No system-prompt section is registered, so there is no additional fixed prompt cost. The configurable style guide is injected by [`@deepseek-ai/dsh-doc-template`](../doc-template/README.md), which owns the style assets this package also checks against.

#### KV Cache effect

Prefix-stable while the registered tool set and the description are unchanged.

## Known Limitations and Deferred Work

- **Registration is a declaration, not a conversion** — the tool does not copy, render, or convert files; it checks existence and content and records the declaration in the session log. PDF export still goes through the studio's print action, and slide/exotic Office conversion still needs the user-level `officecli` skill.
- **No cross-session aggregation** — the studio folds one session's log window; cross-session history, search, and batch export are the deferred document-workbench v2 (see the [workbench proposal](../../../.agents/notes/proposed/feature/2026-08-23-document-mode-workbench.md)).
- **The reported checks are not a review** — they cover the mechanically decidable part of the quality gate (placeholders, the style's forbidden words, section emptiness, same-document fragments, a declared length budget) and say nothing about sourcing, correctness, or accessibility. The P0/P1 items stay the model's own statement; the tool reports its findings beside them rather than validating them, and the studio shows both columns.
- **Only the configured style's words are enforced** — a deployment whose documents must avoid words outside the loaded style's list adds them to that style asset (or points `styleDirs` at its own directory). A per-call waiver would let a forbidden word through with no record of why, so the tool has none.
- **The anchor check is heuristic** — it accepts a fragment declared by an `id`/`name` attribute or by a heading slug under GitHub's rule, so a renderer with a different slug convention can produce a `broken_anchor` warning that is not broken. That check is a warning for exactly that reason.
- **The size cap skips, it does not truncate** — a deliverable larger than `maxCheckBytes` (shipped default 4 MiB) is read no further and reported `unreadable` with its reason; the checks run over nothing rather than over a head that would pass.
- **The DOCX read budget is a deployment budget** — a package that declares more entries than `maxArchiveEntries` or expands past `maxUncompressedBytes` is reported `unreadable` with `too-large`; a deployment that delivers very large repetitive documents raises the cap in `cordis.yml` rather than getting a partial check.

### Dev Note

The deterministic checks are original to this package, not a port: they read the forbidden words of the ported style assets ([`@deepseek-ai/dsh-doc-style`](../doc-style/README.md)) and the placeholder conventions of the ported template engine ([`@deepseek-ai/dsh-doc-template`](../doc-template/README.md)). The `document_deliver` tool itself, its argument validation, and its existence check are unchanged from the original plugin.

No runtime invariant companion is published: the tool writes no package-owned durable session events beyond the normal tool/call and tool/result log, the tool/result log is owned by the tool registry, and nothing outside this package owns the checks it reports.
