---
description: "The **`tool-self-evolve`** package is the model-facing Consumer of `ctx.selfEvolve`. It registers two tools — `self_evolve_inspect_patterns` and `self_evolve_now` — plus a stable prompt section that tells the model when to use them."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-self-evolve

English | [中文](README.zh.md)

## Summary

The **`tool-self-evolve`** package is the model-facing Consumer of `ctx.selfEvolve`. It registers two tools — `self_evolve_inspect_patterns` and `self_evolve_now` — plus a stable prompt section that tells the model when to use them.


## Table of Contents

- [Role](#role)
- [Tools](#tools)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Role

| Package | Role |
|---|---|
| `@deepseek-ai/dsh-self-evolve` | Service Definition: abstract `SelfEvolveEngine` + durable events |
| `@deepseek-ai/dsh-self-evolve-basic` | Service Provider: projection-driven idle-pressure policy + per-session request queue |
| `@deepseek-ai/dsh-tool-self-evolve` (this) | Consumer: model-facing tools and prompt section |

## Tools

| Tool | Purpose |
|---|---|
| `self_evolve_inspect_patterns` | Read the session's projected failure-pattern state so the model can target real patterns instead of guessing. |
| `self_evolve_now` | Queue one explicit request for the requested levels (default `L1-skill` + `L2-context`) and return the receipt `{ requestId, status, queuePosition, note }`. The run starts at the next idle boundary, and a follow-up message reports the outcome. L3-workflow and L4-harness are accepted for forward compatibility, but the base provider produces no proposals for those levels yet. |

`self_evolve_now` never runs the loop inside the tool call: the agent is still running the turn that invoked the tool, so maintenance work would be rejected. A `status: 'queued'` receipt means the request is accepted, not that a proposal exists; `status: 'coalesced'` means an identical level set is already queued and the returned `requestId` is that entry's. The receipt lives in the tool result, so the session log records who asked for what, but a request still queued at process exit is lost.

## Model Experience

### Stable self-evolve guidance and tools

#### What the model sees

A prompt section that explains the self-evolve capability is experimental, instructs the model to call `self_evolve_inspect_patterns` before `self_evolve_now`, states that the base provider implements L1/L2 only and that validation covers a fork replay, a workspace check, an LLM judge, and a held-out replay — each requiring its own prerequisite, so any dimension left without a signal rejects the proposal and an under-configured profile commits nothing — and warns against fabricating patterns. The two tools appear in the tool list when the composition loads this package. `self_evolve_inspect_patterns` returns a task-relevant projection — pattern id, level, verifier tier, summary, occurrence count, and the backing session seqs — without the owner-specific verifier payload or the internal causal signature that back the pattern.

#### Token effect

Each tool call and its JSON response is rendered as a tool-result row in the conversation. The stable prompt section adds a fixed amount of text to every system prompt.

#### KV Cache effect

The stable prompt section is part of the request prefix on every turn while the consumer is loaded.

## Known Limitations and Deferred Work

- **Bounded by the provider surface** — the tools expose the seam, but proposal breadth is limited by the loaded provider (L1/L2 today).
- **Asynchronous by construction** — `self_evolve_now` returns a queue receipt, so a caller must read the follow-up message or the `self-evolve/*` events to learn the run outcome.
- **No keyed end-to-end verification** — `self_evolve_now` queue behavior is unit-covered; a live loop run requires a keyed environment.

### Dev Note

None.
