---
description: "The **`tool-self-evolve`** package is the model-facing Consumer of `ctx.selfEvolve`. It registers two tools — `self_evolve_inspect_patterns` and `self_evolve_now` — plus a stable prompt section that tells the model when to use them."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-self-evolve

English | [中文](README.zh.md)

## Summary

The **`tool-self-evolve`** package is the model-facing Consumer of `ctx.selfEvolve`. It registers two tools — `self_evolve_inspect_patterns` and `self_evolve_now` — plus a stable prompt section that tells the model when to use them.

No runtime invariant companion is published; the tool consumer adds a prompt section and two tools, owning no event sequence or mutable data, and the seam owns the loop bracket.


## Table of Contents

- [Role](#role)
- [Tools](#tools)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Role

| Package | Role |
|---|---|
| `@deepseek-ai/dsh-self-evolve` | Service Definition: abstract `SelfEvolveEngine` + durable events |
| `@deepseek-ai/dsh-self-evolve-basic` | Service Provider: projection-driven idle-pressure policy |
| `@deepseek-ai/dsh-tool-self-evolve` (this) | Consumer: model-facing tools and prompt section |

## Tools

| Tool | Purpose |
|---|---|
| `self_evolve_inspect_patterns` | Read the session's projected failure-pattern state so the model can target real patterns instead of guessing. |
| `self_evolve_now` | Start one explicit self-evolve loop for the requested levels (default `L1-skill` + `L2-context`). L3-workflow and L4-harness are accepted for forward compatibility, but the base provider produces no proposals for those levels yet. |

## Model Experience

### Stable self-evolve guidance and tools

#### What the model sees

A prompt section that explains the self-evolve capability is experimental, instructs the model to call `self_evolve_inspect_patterns` before `self_evolve_now`, states that the base provider implements L1/L2 only and that proposal validation requires the held-in dual verifier (whose workspace half is active only when the profile configures `workspaceVerifier.buildCommand`; without it the loop degrades to the conservative weak path and no commits occur), and warns against fabricating patterns. The two tools appear in the tool list when the composition loads this package. `self_evolve_inspect_patterns` returns a task-relevant projection — pattern id, level, verifier tier, summary, occurrence count, and the backing session seqs — without the owner-specific verifier payload or the internal causal signature that back the pattern.

#### Token effect

Each tool call and its JSON response is rendered as a tool-result row in the conversation. The stable prompt section adds a fixed amount of text to every system prompt.

#### KV Cache effect

The stable prompt section is part of the request prefix on every turn while the consumer is loaded.

## Known Limitations and Deferred Work

- **Bounded by the provider surface** — the tools expose the seam, but proposal breadth is limited by the loaded provider (L1/L2 today).
- **No keyed end-to-end verification** — `self_evolve_now` runs are unit-covered; a live loop run requires a keyed environment.

### Dev Note

None.
