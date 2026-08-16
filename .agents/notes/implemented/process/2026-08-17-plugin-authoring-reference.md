# Agent Note: Add the plugin authoring reference

Status: implemented

English | [中文](2026-08-17-plugin-authoring-reference.zh.md)

## Problem

Plugin-authoring contracts and cautions were spread across tiers: concepts in [cordis-primer](../../../../docs/cordis-primer.md), the ordered first-plugin path in [user/develop/basic](../../../../docs/user/develop/basic/index.md), procedures in the [extension cookbook](../../../../docs/cookbook/extension-cookbook.md), and the extension-point map in [architecture](../../../../docs/architecture.md). No document served as the lookup table a plugin author must hold, and the open-source conventions dsh inherits from the Cordis ecosystem — Koishi's plugin discipline, the Cordis paper's revertible effects, Agent Skills and MCP authoring rules — had no repository home where a contributor with that background could map their mental model onto the dsh equivalents.

## Decision

- **A top-level reference document.** [docs/plugin-authoring.md](../../../../docs/plugin-authoring.md) is a lookup table of contracts and cautions, not a tutorial and not a how-to. It holds three parts: the plugin contract (A1–A8: plugin shapes, injection, config, lifecycle, events, seam authorship, session log, whole-package obligations), a caution checklist that fast-scans every Do/Don't, and a community-alignment table that maps ten upstream conventions to their dsh equivalents with a relation judgment (aligned / enhanced / distinct / not established).
- **One home per fact.** The reference links its owning tiers instead of restating them: concepts to cordis-primer, the tutorial path to user/develop, procedures to the cookbook, the extension-point map to architecture, package rules to packages/AGENTS.md. It cites real packages by path and line (tool-todo, shell, bash-local, tool-bash, timeout-policy, llm-retry) rather than synthetic skeletons.
- **Community alignment stays in the repository.** The comparison table is contributor-facing and is not projected to the documentation website; zero website changes. The upstream [cordiverse/cordis](https://github.com/cordiverse/cordis) README links its documentation at dsh's published cordis-primer, a fact the reference records.
- **No word budget.** The document is unbudgeted per [docs/AGENTS.md](../../../../docs/AGENTS.md); review governs.
- **Bilingual triplet in the same change.** `plugin-authoring.md` + `.zh.md` + `.i18n.yaml` land together; the Chinese side carries English `<a id>` anchors so in-page fragment links resolve in both languages.

## Alternatives considered

- **Merging into the extension cookbook** — rejected: the cookbook is the step-by-step how-to tier; a contract lookup table is not a procedure, and burying it there would keep it invisible to authors looking for rules.
- **Publishing to the website** — rejected: the audience is contributors and deep users of the repository; the website projects product-facing guides, and the existing `user/develop` module already covers the public tutorial path.
- **A standalone community-comparison document** — rejected: ten table rows do not stand alone; the comparison earns its place only beside the contracts it maps onto.
- **Naming it `plugin-guide` or `plugin-development`** — rejected: `guide` implies a tutorial and `development` collides with the contributor workflow document.

## Consequences

- Plugin authors have one contract home whose parts link to the tiers owning each fact; future additions to the reference must displace content to its owning tier instead of restating it.
- The contributor reference in [development.md](../../../../docs/development.md) links the new document, so the daily-workflow path reaches it.
- Upstream convention changes (a Koishi rule shift, a new community norm) update one table row in Part C instead of scattered prose.
- The bilingual pair adds a maintenance surface: edits re-record the pairing sidecar, like every other paired document.
