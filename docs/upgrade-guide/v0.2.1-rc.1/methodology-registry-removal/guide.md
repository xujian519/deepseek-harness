---
kind: upgrade-guide
description: "@deepseek-ai/dsh-methodology removes its unused methodology registry, injector, and generic components; only the TRIZ tool and its data API remain."
---

# Methodology package drops its unused registry

English | [中文](guide.zh.md)

## Change

`@deepseek-ai/dsh-methodology` no longer exports `MethodologyRegistry`, `DEFAULT_METHODOLOGY_COMPONENTS`, `injectMethodology`, `extractMethodologyKeywords`, the eight components (`fiveWhys`, `mece`, `swot`, `pdca`, `fishbone`, `firstPrinciples`, `sixHats`, and the TRIZ component), `detectParamNumbers`, or the methodology protocol types (`MethodologyComponent`, `MethodologyContext`, `MethodologyMatch`, and related types). No consumer in this repository used them.

The `triz` tool, its `tool:triz` system-prompt section, `createTrizTool`, and the data API remain: `loadMatrix`, `lookupMatrixCell`, `loadPrinciples`, `loadSeparations`, `ENGINEERING_PARAMS`, `paramLabel`, `principleById`, and `principleNames`. `lookupMatrixCell` now deduplicates the `(19, 9)` source transcription, and the `triz` lookup result gains a `separations` array for diagonal physical contradictions.

## Migration

1. Replace `injectMethodology(registry, goal)` with an explicit `triz` tool call when the improving and worsening parameter numbers are known. When they are not, use the domain analysis tool that reads the source text, such as `triz_contradiction_analysis`.

2. Replace `new MethodologyRegistry()` and `DEFAULT_METHODOLOGY_COMPONENTS` with direct component logic where a caller owned its own components. The shipped generic components have no replacement in this package.

3. Replace `detectParamNumbers(goal)` with parameters supplied by the model or by a domain extractor. The package no longer guesses parameter numbers from prose.

4. For a direct matrix read, keep `lookupMatrixCell(improving, worsening)` or `createTrizTool()`. Both remain exported and return the same principle numbers, deduplicated.

5. Confirm the migration: `pnpm run build` succeeds, and no production source imports the removed symbols. A repository search still finds the historical Agent Note, this guide, and the negative-export assertions in `packages/patent/methodology/tests/scaffold.spec.ts`.

Upgrade guides in this version directory remain the record of externally visible breaks; see the [methodology scope note](../../../../.agents/notes/implemented/simplification/2026-10-17-methodology-registry-scope.md) for the decision.
