# Agent Note: patent preset prefers the cnlaw MCP tools over REST

Status: implemented

English | [中文](2026-09-15-patent-preset-cnlaw-mcp-first.zh.md)

## Problem

The shipped `patent` preset reached semantica-cnlaw one way: `curl` calls to the local REST services, spelled out endpoint by endpoint in the persona ([the cnlaw enhancement note](../../implemented/architecture/2026-09-03-patent-preset-merges-cnlaw-enhancement.md)). Meanwhile the cnlaw project shipped `cnlaw/ingest/cnlaw_mcp.py`, a FastMCP server that proxies the same `:8001` graph and case endpoints as native tools, with its own module docstring stating the intent — wire it through `@deepseek-ai/dsh-mcp-client` "so the patent mode gets these as first-class `mcp__cnlaw__*` tools instead of raw curl."

Once a deployment mounts that bridge, the preset's prompt contradicted the tool surface: the model read "curl -sG http://127.0.0.1:8001/api/cnlaw/graph/ground …" as the way to do graph navigation, while seven structured tools covering the same endpoints sat unused. The prompt is the only place the model learns a calling convention; a mounted-but-unmentioned tool loses to an explicitly instructed one.

## Decision

The persona now states **MCP first, REST as fallback**, and says so per capability rather than as a blanket rule:

- Discipline 3 (legal-citation verification) sends the model to `mcp__cnlaw__*` first and keeps `:8100 /search` as the REST path for fields the bridge does not cover.
- Graph navigation goes through `cnlaw_graph_ground(article, law, ipc, k)` and `cnlaw_graph_patent(pn)`; the `:8001` graph endpoints are no longer offered as a `curl` path.
- The case decision chain goes through `cnlaw_case_record` / `cnlaw_case_get` / `cnlaw_case_chain` / `cnlaw_case_similar`; the `:8001` case endpoints stay REST-only for a deployment without the bridge, never a parallel path to prefer.
- The persona names `cnlaw_inventive_step` as the **first** step of legal verification — one call returns the four-step evidence pack (D1 / distinguishing features / actual technical problem / technical teaching) with `source_path` per step, so the creative-step argument is built on the pack instead of assembled by hand from separate searches.
- Source labels drop the port: `cnlaw(:8100)` and `cnlaw(:8001/graph)` become `cnlaw`, so citation discipline no longer encodes which channel produced the evidence. Discipline 7 (no source, retract the claim) and the evidence-appendix requirement are unchanged.

The endpoint inventory stays in the prompt for the surfaces that have no MCP face — `:8100 /search`, `/search/decisions`, `/search/judgments`, and the `:8001` IPC routes — and as the working path for a deployment that mounts no bridge. The split is `:8001` graph/case/workflow endpoints on MCP, everything else on REST.

The preset remains optional-enhancement, not a hard dependency: a deployment that mounts no bridge sees the tools absent and the REST instructions — which the persona still carries in full — as the working path.

## Alternatives considered

- **Replace the curl instructions with the tools.** Rejected: it breaks every deployment that has no bridge (the preset's current contract is that cnlaw is optional), and it strands the `:8100` semantic-search endpoints, which have no MCP face.
- **Leave the persona alone and let the tool descriptions carry the discovery.** Rejected: the preset is where the calling convention lives; the model follows an explicit prompt over an unmentioned tool, and the 2026-09-03 note already established that the preset is the single home for this discipline.
- **Name the bridge requirement in the preset's prerequisites instead of the persona.** Rejected as the only change: the ordering between channels is a per-capability judgment (graph/case on MCP, search on REST), not a deployment prerequisite, and a prerequisite line would still leave the ordering unstated.
- **Keep the source labels as `cnlaw(:8100)` / `cnlaw(:8001/graph)`.** Rejected: the label named the channel, so the same evidence carried a different label depending on which channel fetched it — an audit trail should name the source, not the transport.

## Consequences

- A deployment that mounts the bridge gets structured arguments and structured results for graph and case work, and `cnlaw_inventive_step` collapses the creative-step evidence gathering into one call.
- A deployment without the bridge pays one failed tool call before falling back. The model sees the tool list, so the failure is legible rather than silent; the REST instructions remain complete in the same paragraph.
- The persona grows as this discipline is strengthened. The 2026-09-21 utilization audit (48 MCP calls against 202 MCP-eligible-plus-search REST commands in one window) added the case-type routing table and the explicit "do not `curl` the `:8001` graph/case endpoints" wording; the preset's persona prefix block measures 15,999 UTF-8 bytes against the 65,536-byte `agent-instructions` ceiling.
- The shipped preset and any user-root copy diverge again: a local `patent-cnlaw` snapshot taken before this date lacks the MCP-first ordering. `discoverPresets` scans shipped roots first, so the shipped preset wins the id and the divergence is inert.
- No recorded-session snapshot pins this text: the patent preset is not part of the keyless shipped-profile matrix, and `verify-agent-preset-config` validates the persona's schema (prefix/suffix) rather than its prose.
