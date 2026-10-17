---
description: "Function plugin shipping the TRIZ 40 inventive principles, the classic 39x39 Altshuller contradiction matrix, and five separation principles as package assets, reaching the model through one `triz` tool plus a concise `tool:triz` system-prompt section. The matrix, principles, and separations are also available through a keyless data API."
kind: "package-reference"
---

# @deepseek-ai/dsh-methodology

English | [中文](README.zh.md)

## Summary

Function plugin shipping the TRIZ 40 inventive principles, the classic 39x39 Altshuller contradiction matrix, and five separation principles as package assets, reaching the model through one `triz` tool plus a concise `tool:triz` system-prompt section. The matrix, principles, and separations are also available through a keyless data API.

## Table of Contents

- [triz tool](#triz-tool)
- [Data API](#data-api)
- [Configuration](#configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## triz tool

`triz` is a stateless, read-only tool over the shipped data. Call it with no arguments to list the 39 classic engineering parameters and the 40 inventive principles. Call it with an `improving` and a `worsening` parameter number (each 1-39) to read that contradiction-matrix cell and receive the recommended inventive principle numbers, names, and descriptions. A diagonal cell (improving equals worsening) is a physical contradiction and returns no classical matrix entry; it returns the five separation principles instead. The transcription also leaves cells empty off the diagonal (234 of the 273 empty cells), which the tool reports as a matrix gap rather than a contradiction. The tool reads the matrix for explicit parameter numbers only; extracting parameters or contradictions from a disclosure belongs to a domain analysis tool such as `triz_contradiction_analysis`.

## Data API

The package re-exports a keyless read API over the shipped assets: `loadMatrix`, `lookupMatrixCell`, `loadPrinciples`, `loadSeparations`, `ENGINEERING_PARAMS`, `paramLabel`, `principleById`, `principleNames`, and `createTrizTool`. `lookupMatrixCell(improving, worsening)` deduplicates the one duplicated source cell. Nothing in the package matches methodologies against a task or injects prompts automatically.

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
triz only reads a matrix cell for two explicit parameter numbers; identifying parameters or contradictions from a disclosure is outside its scope.
```

#### Token effect

Fixed four-line cost on every request while the section is enabled; disabling `registerSection` removes all four lines.

#### KV Cache effect

Prefix-stable while the section text and its order are unchanged; toggling `registerSection` inserts or removes the section and invalidates reuse from that point.

### TRIZ tool schema

#### What the model sees

One registered tool definition named `triz` with two optional integer parameters, `improving` and `worsening` (each 1-39). A lookup result carries `recommended` principles and, for a diagonal cell, five `separations`. Its exact description and parameters are in the generated [`triz` schema](../../../docs/tool-catalog.md#deepseek-aidsh-methodology); results render as Markdown, not schema tokens.

#### Token effect

Fixed definition cost on every request while enabled; the 40-principle catalog and each matrix-cell lookup are data-dependent results resent only until compaction.

#### KV Cache effect

Append-only; newly visible result text follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **TRIZ only** — the package ships the TRIZ tool and its data API; it does not include a general methodology registry or goal-text parameter detection. Callers supply explicit parameter numbers; extracting them from prose belongs to a domain analysis tool.
- **Static section text** — the `tool:triz` section is fixed prose; it does not adapt to a per-deployment parameter list.
- **Classical matrix data only** — the shipped 39x39 matrix is the public Altshuller transcription; 273 of its 1521 cells carry no recommendation (39 on the diagonal, which are physical contradictions, and 234 off it), and no newer or derived matrix is included.
- **Source data anomaly** — the `(improving 19, worsening 9)` cell is transcribed as `[8, 35, 35]` by both reference sources; the reader deduplicates it and the raw value is preserved. The source files, licenses, and the full list of known deviations are in [`assets/README.md`](assets/README.md).

### Dev Note

None.
