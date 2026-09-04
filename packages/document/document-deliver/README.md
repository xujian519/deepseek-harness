---
description: "Function plugin for the [document agent preset](../../preset/agent-presets/presets/document/preset.yml): one model-facing `document_deliver` tool that records the delivered files, formats, and quality-gate outcome. The tool call is session-logged like every tool call, so the [delivery studio](../../../packages/client/ui-document-studio/README.md) derives the deliverable list (paths, formats, gate state) from the log — no new session event type, no host write RPC."
kind: "package-reference"
---

# @deepseek-ai/dsh-document-deliver

English | [中文](README.zh.md)

## Summary

Function plugin for the [document agent preset](../../preset/agent-presets/presets/document/preset.yml): one model-facing `document_deliver` tool that records the delivered files, formats, and quality-gate outcome. The tool call is session-logged like every tool call, so the [delivery studio](../../../packages/client/ui-document-studio/README.md) derives the deliverable list (paths, formats, gate state) from the log — no new session event type, no host write RPC.

No runtime invariant companion is published; the tool writes no package-owned durable session events beyond the normal tool/call and tool/result log, the tool/result log is owned by the tool registry, and nothing outside this package reads the registered files.


## Table of Contents

- [What it mounts](#what-it-mounts)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## What it mounts

- **`document_deliver`** — declares `files` (`{ path, format }`, format from `markdown | html | pdf | docx | pptx | other`), `gate` (`p0` required list of verified P0 checks, optional `p1` list), and an optional `brief_ref`. It resolves each path against the calling session's workspace, fails loud when a file is missing (a ghost file is not a deliverable), and confirms the registration with the P0/P1 counts.

## Model Experience

### Tool schemas

#### What the model sees

One registered tool definition: `document_deliver` with its parameter schema (file list with formats, gate checklists, optional brief reference) and the confirmation render. The exact description and parameters are in the generated [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-document-deliver).

#### Token effect

Fixed definition cost of one tool on every request; the result confirmation is a few lines and resent only until compaction. No system-prompt section is registered, so there is no additional fixed prompt cost.

#### KV Cache effect

Prefix-stable while the registered tool set and the description are unchanged.

## Known Limitations and Deferred Work

- **Registration is a declaration, not a conversion** — the tool does not copy, render, or convert files; it only checks existence and records the declaration in the session log. PDF export still goes through the studio's print action, and `.docx`/`.pptx` conversion still needs the user-level `officecli` skill.
- **No cross-session aggregation** — the studio folds one session's log window; cross-session history, search, and batch export are the deferred document-workbench v2 (see the [workbench proposal](../../../.agents/notes/proposed/feature/2026-08-23-document-mode-workbench.md)).
- **Gate state is model-reported** — the P0/P1 items come from the model's own quality-gate run; the tool enforces that P0 is non-empty and the files exist, not that the checklist was honestly executed.

### Dev Note

None.
