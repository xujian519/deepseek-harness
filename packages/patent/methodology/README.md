---
description: "Function plugin porting the Sati reasoning-methodology layer into the DeepSeek Harness: the TRIZ 40 inventive principles and the classic 39x39 Altshuller contradiction matrix ship as package assets and reach the model through one `triz` tool plus a concise `tool:triz` system-prompt section. The full methodology registry (eight components, keyword matching, and prompt injection) also ships as a keyless library API for prompt-assembly consumers."
kind: "package-reference"
---

# @deepseek-ai/dsh-methodology

English | [中文](README.zh.md)

## Summary

Function plugin porting the Sati reasoning-methodology layer into the DeepSeek Harness: the TRIZ 40 inventive principles and the classic 39x39 Altshuller contradiction matrix ship as package assets and reach the model through one `triz` tool plus a concise `tool:triz` system-prompt section. The full methodology registry (eight components, keyword matching, and prompt injection) also ships as a keyless library API for prompt-assembly consumers.

## Table of Contents

- [triz tool](#triz-tool)
- [Methodology registry (library API)](#methodology-registry-library-api)
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## triz tool

`triz` is a stateless, read-only tool over the shipped data. Call it with no arguments to list the 39 classic engineering parameters and the 40 inventive principles. Call it with an `improving` and a `worsening` parameter number (each 1-39) to read that contradiction-matrix cell and receive the recommended inventive principle numbers, names, and descriptions. A diagonal cell (improving equals worsening) is a physical contradiction and returns no classical matrix entry.

## Methodology registry (library API)

The package re-exports the ported methodology layer: `MethodologyRegistry`, `DEFAULT_METHODOLOGY_COMPONENTS`, `extractMethodologyKeywords`, `injectMethodology`, and the eight components (`fiveWhys`, `mece`, `swot`, `pdca`, `fishbone`, `firstPrinciples`, `sixHats`, `triz`). These are pure, keyless rule implementations; nothing mounts them automatically — a prompt-assembly consumer decides when to match and inject a methodology prompt.

## Configuration

Schemastery configuration, every field optional.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `registerSection` | boolean | `true` | Register the always-on `tool:triz` system-prompt section. |

## Model Experience

### TRIZ system prompt section

#### What the model sees

One always-on prompt section named `tool:triz` at order 111, registered only while `registerSection` is `true` (the default). Its verbatim text is:

##### Verbatim section text

```markdown
For patent innovation, design-around, and trade-off analysis, use the triz tool when a task names a technical contradiction or conflict between two engineering parameters.
Call triz with no arguments to list the 39 classic engineering parameters and the 40 inventive principles.
Call triz with an improving and a worsening parameter number (1-39) to read that contradiction-matrix cell and its recommended inventive principles.
```

#### Token effect

Fixed three-line cost on every request while the section is enabled; disabling `registerSection` removes all three lines.

#### KV Cache effect

Prefix-stable while the section text and its order are unchanged; toggling `registerSection` inserts or removes the section and invalidates reuse from that point.

### TRIZ tool schema

#### What the model sees

One registered tool definition named `triz` with two optional integer parameters, `improving` and `worsening` (each 1-39). Its exact description and parameters are in the generated [`triz` schema](../../../docs/tool-catalog.md#deepseek-aidsh-methodology); results render as Markdown, not schema tokens.

#### Token effect

Fixed definition cost on every request while enabled; the 40-principle catalog and each matrix-cell lookup are data-dependent results resent only until compaction.

#### KV Cache effect

Append-only; newly visible result text follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Registry is a library API, not a mounted section** — the eight methodology components ship for consumers to match and inject, but nothing registers them into the system prompt; a composition must call `injectMethodology` itself.
- **Static section text** — the `tool:triz` section is fixed prose; it does not adapt to the loaded component set or a per-deployment parameter list.
- **Classical matrix data only** — the shipped 39x39 matrix is the public Altshuller transcription; empty diagonal cells (physical contradictions) and any newer or derived matrices are not included.

### Dev Note

None.

No companion is published because the triz tool writes no package-owned durable session events beyond the normal tools/result log; execution relations are owned by the tool registry it calls.
