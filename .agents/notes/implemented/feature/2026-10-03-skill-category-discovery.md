# Agent Note: Skill discovery reaches one category below a scan root

Status: implemented

English | [中文](2026-10-03-skill-category-discovery.zh.md)

## Problem

Skill libraries organize their packs by topic — `<root>/<category>/<skill>/SKILL.md` — and the deployed `~/.agents/skills` library does exactly that: 13 category directories hold 58 skills, with 18 further skills at the root. `skill-filesystem` read only a root's direct entries, so a category directory without its own `SKILL.md` became a skill directory without a skill file, and its whole subtree disappeared in silence: no catalog entry, no warning, no log line.

The gap had three costs. A deployment that wanted those skills visible had to list every category directory by name in `customSkillDirs`, keeping a second copy of a layout the root already stated. The patent preset turned the structural gap into an obligation on the model — "whether a skill exists is decided by files, not by the `skill` directory", followed by a `glob` recipe for the skills the catalog withheld — which the window's tool-call records show the model did not follow. And a skill that was present on disk but withheld from the catalog is indistinguishable, from inside a session, from a skill that was never installed.

## Decision

`skill-filesystem` discovers skills at two levels under each scanned root:

- **Root level** — a directory bundle `<name>/SKILL.md` or a flat file `<name>.md`.
- **One category below** — for a direct child directory that has no `SKILL.md` of its own, each of its child directories that contains a `SKILL.md`.

A direct child that carries its own `SKILL.md` is a skill and is not also read as a category. A category's own flat `.md` files are notes, not flat skills: `_shared/common.md` in a skill library is shared material, and treating it as a skill candidate would drop it with a "missing YAML frontmatter" warning on every discovery. Hidden directories (a leading `.`) are repository or tooling metadata — the deployed library's `.git` and `.nuo` — and are never read as categories. Nothing below the category level is discovered.

The watch manager follows the same depth: Chokidar opens existing roots at `depth: 2`, and a category's appearance, a bundle's `SKILL.md` add/remove/change at either level, and a root-level flat `.md` add/remove all invalidate the provider. The first-party `write`/`edit` path through `fs/observed` recognizes a category bundle's `SKILL.md` and stops at four path segments.

The two preset passages that instructed the model to bypass the catalog are removed; the preset now states that a category-organized skill root lists its skills.

## Alternatives considered

**Symlink each category skill into the root (deployment-side fix, no code change).** The issue's zero-cost option: `<root>/<skill> -> <root>/<category>/<skill>`, the shape `ego-browser` already uses. It repairs one machine and leaves every other deployment to discover the same silence, keeps a second copy of the layout that must be maintained on every skill addition, and leaves the preset text telling the model not to trust the catalog. Rejected: the layout is stated by the root itself, so the provider is the side that is wrong.

**Warn instead of discover.** Keep the one-level contract, detect a category directory whose children hold `SKILL.md`, and log it. This removes the silence but not the gap: the deployed library would still need one `customSkillDirs` line per category, and the model still could not load the skill. Rejected as a fix, kept implicitly as a documented limit for depths beyond one category.

**Discover a category's flat `<name>.md` files too.** Symmetric with the root level, but the deployed library's `_shared/` holds six flat Markdown notes. Every discovery would parse them, fail the frontmatter requirement, and warn — converting a layout question into catalog noise, with no case that wanted the behavior. Rejected.

**Add a `discoveryDepth` config field.** A depth knob is a deployment-varying choice in form, but no deployment asked for depth 3, and a field whose only supported values are 1 and 2 invites configurations whose failures appear as silently missing skills. The two levels are the layout skill libraries actually use; deeper trees stay a documented limit. Rejected.

## Consequences

**A category-organized root now yields its skills with no configuration.** The deployed library's 58 category skills enter the catalog through the `~/.agents/skills` root; the `customSkillDirs` entries that existed only to work around the old depth are redundant and can be deleted (keep `includeDefaultRoots: false` if the deployment wants the library visible in every profile, which is why those entries were written).

**Same-name collisions stay governed by the registry.** A name present both at the root and inside a category, or in two categories, resolves through the registry's existing rank-then-order rule, and the loser logs a warning. Discovery order within a root is alphabetical at both levels, so the winner is stable.

**Depth beyond one category is still silent.** A skill at `<root>/<a>/<b>/<skill>/SKILL.md` is not discovered and produces no diagnostic, matching the root-level behavior for a malformed skill. The README states the limit; the issue's rejection of the warn-only alternative is why it is not a runtime diagnostic.

**Discovering a root costs one extra directory listing per non-bundle child.** A root holding a category directory reads that directory once; a hidden directory, a file, and a directory that already carries `SKILL.md` cost nothing extra. The repository's own skill roots (the patent, document, and agent-preset bundles, and the office assets) hold no second-level `SKILL.md`, so their catalogs and the recorded sessions that replay them are unchanged.

## Testing

`packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts` covers the shape directly: category bundles from two categories, a category's flat `.md` note, a third-level bundle, a hidden category, a top-level bundle whose child also holds a `SKILL.md`, and the loaded `path` and `resourceBase` of a category skill. The `fs/observed` test pins that a category bundle's `SKILL.md` invalidates the provider while a deeper resource file does not.

`packages/skill/skill-filesystem/tests/skill-filesystem-watcher.spec.ts` pins `depth: 2` and the event set: a category directory's `addDir`, a category bundle's `SKILL.md` change, and that bundle's `unlinkDir` each invalidate once, while a category's flat `.md` change and a deeper resource change do not.
