---
description: "The dsh self-evolve opt-in bundle. [`cordis.patch.yml`](cordis.patch.yml) stacks over [`dsh-base`](../base/README.md): it inserts the `self-evolve-basic` provider and the `tool-self-evolve` consumer rows. A profile that wants the capability seam mounts this bundle; without it the seam stays dormant and the host plane holds no tools."
kind: "package-bundle"
---

# `@deepseek-ai/dsh-self-evolve-app`

English | [中文](README.zh.md)

## Summary

The dsh self-evolve opt-in bundle. [`cordis.patch.yml`](cordis.patch.yml) stacks over [`dsh-base`](../base/README.md): it inserts the `self-evolve-basic` provider and the `tool-self-evolve` consumer rows. A profile that wants the capability seam mounts this bundle; without it the seam stays dormant and the host plane holds no tools.

The base bundle deliberately does not carry these rows: `tool-self-evolve` registers its tools on the mount context, so a base-level row would leak them into the host plane and every agent (the minimal preset's two-tool contract and the "host plane holds no tools" invariant both depend on that). The standard and minimal presets therefore stay unchanged; opting in is an explicit composition step.

No runtime invariant companion is published; the bundle patch and glue plugin hold no mutable state of their own, and every contribution lands in an owning registry.


## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Model Experience

Indirectly, through the mounted consumer: this bundle inserts the `tool-self-evolve` row, whose prompt section and `self_evolve_*` tools are the only model-visible surface; the bundle's own glue plugin contributes no prompt text, tool schema, or result of its own. See [`@deepseek-ai/dsh-tool-self-evolve`](../../self-evolve/tool-self-evolve/README.md) for the consumer contract.

#### KV Cache effect

None, as the glue plugin holds the composition seat without assembling or sending a provider request.

## Known Limitations and Deferred Work

- **Opt-in only** — nothing enables the seam by default; the `self-evolve-app` bundle must be mounted by the profile.
- **Provider breadth** — `self-evolve-basic` targets L1-skill and L2-context proposals; L3-workflow and L4-harness requests produce no proposals yet.
- **No keyed end-to-end verification** — proposal effects are reversible commits covered by unit tests; a live `dsh --profile` loop run requires a keyed environment.

### Dev Note

None.
