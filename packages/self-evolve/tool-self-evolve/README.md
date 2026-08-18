# @deepseek-ai/dsh-tool-self-evolve

English | [中文](README.zh.md)

The **`tool-self-evolve`** package is the model-facing Consumer of `ctx.selfEvolve`. It registers two tools — `self_evolve_inspect_patterns` and `self_evolve_now` — plus a stable prompt section that tells the model when to use them.

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

A prompt section that explains the self-evolve capability is experimental, instructs the model to call `self_evolve_inspect_patterns` before `self_evolve_now`, states that the base provider implements L1/L2 only and that validation is a P0 bracket smoke, and warns against fabricating patterns. The two tools appear in the tool list when the composition loads this package.

#### Token effect

Each tool call and its JSON response is rendered as a tool-result row in the conversation. The stable prompt section adds a fixed amount of text to every system prompt.

#### KV Cache effect

The stable prompt section is part of the request prefix on every turn while the consumer is loaded.
