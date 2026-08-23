# OpenDesign knowledge assets

English | [中文](README.zh.md)

A **default-off overlay** that mounts an [OpenDesign](https://github.com/nexu-io/open-design) checkout's Agent-Skills directories into DSH's model-facing skill catalog: `skills/` (over one hundred functional design skills) and `design-templates/` (the render-template catalog — prototype, deck, dashboard, image, and more). This is the lightest integration surface: no OpenDesign daemon, no MCP server, no network. The files already on disk are the asset.

## What DSH does

DSH scans the two configured directories, parses each `SKILL.md` frontmatter (`name` and `description` are required; unknown fields such as OpenDesign's `triggers` are ignored), and publishes the winners through the shipped skill catalog. The model sees the OD skills listed among `<available_skills>` and loads one with the `skill` tool; design-template skills carry resource hints so `assets/` and `references/` resolve against the skill directory.

DSH does **not** clone OpenDesign, install it, run its daemon, spawn an agent runtime, or preview artifacts. `design-systems/` (the `DESIGN.md` brand contracts) is not a skill root; when a template skill asks for the active design system, read `<OPEN_DESIGN_DIR>/design-systems/<brand>/DESIGN.md` with the filesystem tools.

## Prerequisite

An OpenDesign checkout with `OPEN_DESIGN_DIR` pointing at its root:

```sh
git clone https://github.com/nexu-io/open-design.git
export OPEN_DESIGN_DIR="$PWD/open-design"
```

## Enable

```sh
dsh web --patch "$PWD/examples/opendesign/cordis.yml"
```

To keep the selection across runs, merge the file's single `insert` patch into a user patch layer — `$DSH_HOME/profiles/<name>/cordis.patch.yml` for one profile, or `$DSH_HOME/cordis.patch.yml` for every profile on the machine. Do not copy over an existing file: it may already contain unrelated user patches.

Without `OPEN_DESIGN_DIR` the provider registers with no roots — an explicit empty catalog, not a silent skip.

## How the overlay is wired

The overlay adds one isolated `@deepseek-ai/dsh-skill-filesystem` instance. `providerName: open-design` keeps it distinct from the profile's default filesystem provider (a duplicate provider name would fail the registry), and `includeDefaultRoots: false` confines it to the OpenDesign roots. The skill registry and the model-facing catalog come from the shipped skill capability, which the default profiles already mount.

Discovery is one level deep (`<root>/<name>/SKILL.md`), so a skill dropped directly under a root without its own directory is not seen. OD skills retain their cross-references (for example `web-prototype` reading `references/layouts.md`), which resolve relative to the skill directory.

## License

OpenDesign is Apache-2.0. This overlay adds no OpenDesign content — it only points DSH at the user's own checkout.
