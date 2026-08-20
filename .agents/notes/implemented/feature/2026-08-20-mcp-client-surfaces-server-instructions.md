# Agent Note: mcp-client surfaces server instructions as a prompt section

Status: implemented

English | [中文](2026-08-20-mcp-client-surfaces-server-instructions.zh.md)

## Problem

`@deepseek-ai/dsh-mcp-client` bridged only tools: an MCP server's `instructions` (the collaboration rules it declares in its initialize response, such as "all mutations go through tools; reply on the task thread only") were silently dropped. The AgentRQ integration documented the consequence directly — its plugin had to contribute an `agentrq:protocol` system-prompt section by hand because "the harness does not surface an MCP server's instructions to the model" — and every future MCP-based integration would have had to repeat that layer.

## Decision

`dsh-mcp-client` now surfaces a server's instructions as a prompt section:

- **Capture**: after a successful connect, `client.getInstructions()` (SDK 1.29) is read and kept as the live generation's value; a reconnect replaces it.
- **Registration**: when `surfaceInstructions` (default `true`) is enabled, the value registers as the `mcp:<serverName>:instructions` section at order 155, inside the tool-guidance band (100–199) and clear of the orders other harness packages use there (subagent 116/116.5, report 117, SDK code-mode 150).
- **Dynamic text**: the section's text is a provider that re-reads the live generation on every assembly, so a reconnect that returns different instructions is reflected without re-registration; an absent or empty value renders nothing (rendering drops empty sections).
- **Config**: `surfaceInstructions` is a validated field on both transport variants, so a deployment that states the same protocol in its own persona can turn it off.
- **Dependency**: `inject` grew from `['tools']` to `['tools', 'systemPrompt']`; `@deepseek-ai/dsh-system-prompt` joined peer and dev dependencies. `systemPrompt` is a harness core service (agent-loop requires it), so requiring it fails loud at load rather than silently rendering no section.

## Alternatives considered

**Keep the status quo and let each MCP integration contribute its own section.** Rejected: the server's own declared protocol is the canonical copy, and forcing every integration to hand-render it duplicates labor and invites drift.

**Access `systemPrompt` through `ctx.get()` and tolerate absence.** Rejected: `systemPrompt` is always present in the harness; an optional lookup would silently disable the feature instead of failing loud, and `surfaceInstructions: false` already exists for deployments that want it off.

## Consequences

- `packages/mcp/mcp-client`: `connection.ts` exposes `instructions` on the connection handle; `index.ts` registers the section; 5 new apply.spec cases cover registration, empty-value rendering, the disabled switch, disposal, and per-`serverName` namespacing. Unit (107) and real-protocol e2e (22) suites pass.
- The generated config catalog (`docs/config-catalog.md`, doc-sync) reflects `Requires: tools, systemPrompt` and the new field.
- No agent-loop, `SessionEventMap`, or session-format change, so no TS/Python SDK expected-output sync and no `SESSION_FORMAT_VERSION` bump.
- The AgentRQ plugin's own `agentrq:protocol` section stays as its rendered tool-name mapping; its server's raw instructions now arrive independently, and it can set `guidance: false` when it wants only the raw copy.
