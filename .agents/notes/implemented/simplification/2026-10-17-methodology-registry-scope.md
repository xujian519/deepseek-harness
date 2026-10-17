# Agent Note: Methodology package scope

Status: implemented

English | [中文](2026-10-17-methodology-registry-scope.zh.md)

## Problem

`@deepseek-ai/dsh-methodology` exported a full reasoning-methodology registry beside its TRIZ tool: `MethodologyRegistry`, `DEFAULT_METHODOLOGY_COMPONENTS`, `injectMethodology`, `extractMethodologyKeywords`, eight generic components, and a deterministic parameter-detection path. No package, preset, skill, or test outside the package called any of them. The package README described the registry as a library API for prompt-assembly consumers, but no such consumer exists.

The unused surface also carried maintenance cost and a known quality gap: `detectParamNumbers` matched short substrings, so `提高能力` hit parameter 10 (force), `降低应力` hit both 10 and 11, and `提高强度同时减轻重量` matched both moving- and stationary-weight parameters. The only caller was the registry's TRIZ component, which cross-producted every detected parameter in both directions and injected contradictory lookup lines into its prompt.

## Decision

The package ships the TRIZ capability only:

- the `triz` tool and the `tool:triz` system-prompt section;
- the matrix, principle, and separation assets under `assets/`;
- the read API over those assets: `loadMatrix`, `lookupMatrixCell`, `loadPrinciples`, `loadSeparations`, `ENGINEERING_PARAMS`, `paramLabel`, `principleById`, `principleNames`, and `createTrizTool`;
- the TRIZ types.

The methodology registry, injector, keyword matcher, eight components, methodology protocol types, `detectParamNumbers`, and the `match` field on `TrizParameter` are removed. A caller that supplies explicit improving/worsening parameter numbers uses `triz` or `lookupMatrixCell`; extracting parameters or contradictions from prose is left to the domain tools that own it, such as `triz_contradiction_analysis`.

Reintroduce a methodology registry only with a real prompt-assembly consumer that also owns semantic parameter extraction. A registry without that consumer is not a library API; it is an unexercised code path.

## Alternatives considered

**Keep the registry as a library API.** This preserves the ported Sati surface and avoids a breaking package change. It leaves code with no consumer, tests that verify only themselves, and a parameter detector that would mislead the first caller. The repository rule against exported-but-unconsumed APIs applies.

**Wire the registry into prompt assembly.** Adding a Config-controlled `autoInject` would create the missing consumer and give the components product use. It also turns the lossy detector into a product path that needs synonym tables, direction parsing, and movement/stability disambiguation before it can be trusted. No current product requirement justifies that scope.

**Move the components to `packages/experimental/`.** This keeps the code available while marking it non-product. The package still needs an owner for the detector and its tests, and moving a public export between packages is still a breaking change. Deletion has the same migration cost and less surface.

## Consequences

The published package entry point loses `MethodologyRegistry`, `DEFAULT_METHODOLOGY_COMPONENTS`, `extractMethodologyKeywords`, `injectMethodology`, `fiveWhys`, `mece`, `swot`, `pdca`, `fishbone`, `firstPrinciples`, `sixHats`, the TRIZ component, `detectParamNumbers`, and the methodology protocol types; `TrizParameter` loses its `match` field. The [upgrade guide](../../../../docs/upgrade-guide/v0.2.1-rc.1/methodology-registry-removal/guide.md) states the migration. The TRIZ tool, its schema, its prompt section, and the data-read API remain exported. Their behavior changes in this release: the matrix gains 58 filled cells, `lookupMatrixCell` deduplicates the `(19, 9)` source cell, lookup output gains `separations`, and the prompt section gains one routing line.

Deleting the detector removes the direction-loss defect instead of fixing it: explicit parameter numbers are now the only supported input, and the model or a domain tool supplies them. The package no longer claims to identify methodologies from a goal, and the README no longer advertises a registry.
