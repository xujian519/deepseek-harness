---
description: "The self-evolve group map: campaign-based self-evaluation and plugin evolution — a durable evolution service, a basic provider wired to the agent loop, the SWE-bench-style benchmark runner, and the model-facing tools."
kind: "package-group"
---

# packages/self-evolve

English | [中文](README.zh.md)

## Summary

The self-evolve family lets the harness evaluate and improve its own plugin composition from recorded evidence. `self-evolve` declares the durable evolution service, `self-evolve-basic` implements it against the agent loop's lifecycle events (request runs, pre-step, and errors feed the evolution record), `self-evolve-benchmark` runs reproducible campaign runs with fixed subset seeds, scoring, interval, and recorded decision I/O, and `tool-self-evolve` exposes the model-facing control surface. Campaign state lands in the session log and the evaluation artifacts stay out of the workspace build.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | Service |
|---|---|---|
| [`self-evolve/`](self-evolve/README.md) | Evolution service definition and lifecycle. | `selfEvolve` |
| [`self-evolve-basic/`](self-evolve-basic/README.md) | Basic provider over the agent loop's lifecycle events. | (provider) |
| [`self-evolve-benchmark/`](self-evolve-benchmark/README.md) | SWE-bench-style campaign runner: subset seeds, scoring, decision records. | — |
| [`tool-self-evolve/`](tool-self-evolve/README.md) | Model-facing evolution control tools. | (registers on `ctx.tools`) |

## Related documentation

- [Self-evolve subsystem](../../docs/subsystems/self-evolve.md) — campaign, evaluation, and evolution contracts.

## Dev Note

None.
