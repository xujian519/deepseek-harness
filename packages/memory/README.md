# memory/ — external memory and context-database integrations

English | [中文](README.zh.md)

Plugins that give the harness long-lived memory backed by an external context
database. Each integration owns a foreign data plane (retrieval, capture,
commit, tool surface) and remains a consumer of the in-process lifecycle and
prompt extension points; no `agent-loop` code changes here. All packages are
opt-in unless a group README says otherwise.

| Package | Role | ctx key |
|---|---|---|
| [`openviking/`](openviking/README.md) | OpenViking context-database integration: auto-recall, session capture/commit, and the OpenViking tool surface | `ctx.openviking` (planned) |

External services keep their own contracts: the group README links the
upstream implementation and the wire endpoints it consumes.
