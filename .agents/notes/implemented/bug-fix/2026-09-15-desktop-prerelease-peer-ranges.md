# Agent Note: Desktop plugin validation admits prerelease peer ranges

Status: implemented

English | [中文](2026-09-15-desktop-prerelease-peer-ranges.zh.md)

## Problem

`validateDesktopPluginGraph` compared every enabled plugin's peer ranges with the host package versions using default semver comparison. Default semver admits a prerelease version into a range only when a comparator in that range carries a prerelease on the same major.minor.patch tuple, so a Desktop release whose host packages are prereleases rejected any plugin written against another prerelease of the same line. `@dely0/dsh-personal-workbench` declares `@deepseek-ai/dsh-host-webserver`, `@deepseek-ai/dsh-system-prompt`, and `@deepseek-ai/dsh-tools` as peers at `^0.1.0-rc.6`, and the packaged 0.1.5-rc.2 host threw:

```
desktop profile: @dely0/dsh-personal-workbench requires @deepseek-ai/dsh-host-webserver@^0.1.0-rc.6, found 0.1.5-rc.2
```

Startup reconciliation and every plugin mutation run that validation, so enabling such a plugin failed profile preparation instead of loading it, and the application reported a startup failure rather than an uninstalled plugin.

## Decision

`validateDesktopPluginGraph` compares peer ranges with `satisfies(version, range, { includePrerelease: true })`.

Prerelease versions count as candidates within the host package's installed versions, so a prerelease host release satisfies a prerelease peer range that covers it while a range that excludes that version still fails. The option widens prerelease admission alone: `^0.1.0-rc.6` admits `0.1.5-rc.2`, and `^0.2.0` still refuses it.

## Alternatives considered

**Rewrite the peer ranges of each third-party plugin before installing it.** A repacked tarball carrying `^0.1.5-rc.2` passes the default comparison. Rejected: it needs one repack per plugin and per dsh prerelease, and the desktop install path accepts registry specs only, so the repacked artifact cannot be installed through the plugin window.

**Require plugin authors to declare the exact prerelease they were built against.** Rejected: each dsh prerelease would invalidate every installed plugin, and `^0.1.0-rc.6` already states the compatibility its author intends — the same line, any later prerelease or release.

**Accept every peer range.** Rejected: the check still has to refuse a plugin built for another major or minor line, and its diagnostic is the only place that names the offending range.

## Consequences

A plugin whose peers name the packaged host packages installs and activates across prerelease builds of the same line, which is the versioning this repository's own prereleases produce.

A plugin declaring a range that excludes the host version still fails profile preparation with the same diagnostic, so a genuinely incompatible plugin is caught before the host starts.

Validation admits a prerelease host into a release range such as `^0.1.0`: the comparison proves the range covers the installed version, not that the version is final.

## Testing

`apps/desktop/tests/profile-packages.spec.ts` pins acceptance against a prerelease host release and the continued rejection of a prerelease range that excludes it. The remaining cases in that file pin the untouched ownership and layout rules.
