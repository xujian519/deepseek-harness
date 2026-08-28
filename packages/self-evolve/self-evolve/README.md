---
description: "The **`SelfEvolveEngine`** (`ctx.selfEvolve`) defines WHAT self-improving plugins do — observe verifier-grounded failure patterns and propose narrow edits to skills, prompt sections, workflows, or harness packages — without saying HOW."
kind: "package-reference"
---

# @deepseek-ai/dsh-self-evolve

English | [中文](README.zh.md)

## Summary

The **`SelfEvolveEngine`** (`ctx.selfEvolve`) defines WHAT self-improving plugins do — observe verifier-grounded failure patterns and propose narrow edits to skills, prompt sections, workflows, or harness packages — without saying HOW.

This package owns the Service Definition role of the self-evolve capability, split so each role can evolve (and be swapped) independently:

| Package | Role |
|---|---|
| `@deepseek-ai/dsh-self-evolve` (this) | Service Definition: abstract service + `self-evolve/*` events + `FailurePattern` vocabulary + projection-unit contract |
| `@deepseek-ai/dsh-self-evolve-basic` | Service Provider: idle-pressure trigger, rate limits, L1/L2 proposals, and reversible effect commits |
| `@deepseek-ai/dsh-tool-self-evolve` | Consumer: model-facing tools and prompt section over `ctx.selfEvolve` |

## Table of Contents

- [Service API (`ctx.selfEvolve`)](#service-api-ctxselfevolve)
- [Events](#events)
- [Failure-pattern projection](#failure-pattern-projection)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Service API (`ctx.selfEvolve`)

| Member | Semantics |
|---|---|
| `evolveIfNeeded(agent, trigger, signal, levels?)` | Consider an evolution loop for the given trigger. Returns `null` when policy decides no run is needed. |
| `evolveNow(agent, signal, levels?)` | Explicitly run one evolution loop now, regardless of pressure policy. |
| `readPatterns(sessionId)` | Read the latest projected failure-pattern state for a session. |

The four edit surfaces, narrowest to widest, are `L1-skill`, `L2-context`, `L3-workflow`, and `L4-harness`. A backend owns trigger policy, rate limiting, the proposer model route, verifier grounding, and held-in/held-out regression execution.

## Events

The `self-evolve/*` events extend `SessionEventMap` via declaration merging. They are session events, not cordis `Events`, and are all log-only. The bracket pair `self-evolve/start` → `self-evolve/end` shares a run identity across `mined`, `proposed`, `validated`, and `commit` events.

## Failure-pattern projection

Weakness mining reads from the durable session log through the `failure-patterns` projection unit (`SessionProjectionMap['failure-patterns']`). The projection folds `tool/result` failure surfaces (shell exit/signal markers or tool errors, named via the paired `tool/call` identity), `agent/request-error`, `compaction/end`, and `self-evolve/end` events into verifier-grounded patterns keyed by `(level, verifierTier, causalSignature)`.

## Model Experience

None, as the Service Definition only declares the abstract lifecycle and durable event vocabulary; providers and tool consumers own every model-facing effect.

#### KV Cache effect

No direct request changes; consumers own any prompt-section or tool registrations.

## Known Limitations and Deferred Work

- **Scaffold-stage seam** — the Service Definition declares the abstract lifecycle and the durable event vocabulary; trigger policy, rate limits, proposals, and effect commits are owned by the provider, and no provider implements the L3-workflow or L4-harness proposal levels yet.
- **Projection scope** — `failure-patterns` folds only the documented event surface (tool results, agent request errors, compaction ends, `self-evolve/end`); non-verifier signals stay outside the pattern vocabulary.

### Dev Note

None.
