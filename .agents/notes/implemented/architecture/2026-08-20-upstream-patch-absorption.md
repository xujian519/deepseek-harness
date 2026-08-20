# Agent Note: Absorb four upstream community patches

Status: implemented

English | [中文](2026-08-20-upstream-patch-absorption.zh.md)

## Problem

The community desktop project (deepseek-harness-desktop) carries five patches against upstream packages. Source-level verification against rc.8 showed four of them fix defects upstream still has; the fifth (a workspace drop-target attribute) is superseded by rc.8's own in-app drop handling, and the electron-builder notarization patch is third-party tooling, not upstream.

## Decision

Absorb the four live patches into upstream, each with its owning tests:

- **`dsh-app-boot` `parsePatchList`** treats an empty or comment-only patch file as zero patches instead of failing loud. A bundle ships `cordis.patch.yml` unconditionally; a release may have nothing to patch. Non-array non-null content still throws.
- **`dsh-client-ui-directory-picker-browse`** gains host-agnostic `pickNativeDirectory`/`validateDirectory` props and a native-picker button wired to a desktop preload's `window.__DSH_DESKTOP_PICK_DIRECTORY__`/`__DSH_DESKTOP_VALIDATE_DIRECTORY__`. The Windows-gated bridge itself stays with the desktop shell; the picker package only defines the seam.
- **`dsh-llm-deepseek` streaming translation** treats an empty wire tool-call id/name as absent, so deltas no longer emit empty name fields.
- **`dsh-sandbox-windows-acl`** hides the restricted child's console window (`STARTF_USESHOWWINDOW | SW_HIDE`) in both spawn paths, with an ABI round-trip test for the struct offsets.

## Consequences

Empty patch files are a valid "no patches" state; the directory browser can call a system chooser when a host provides one; tool-call deltas carry no empty identity fields; and the Windows sandbox no longer flashes a console. The drop-target attribute and the electron-builder patch are documented as out of scope rather than ported.

## Alternatives considered

- Porting the drop-target attribute: rejected — rc.8 `WorkspaceBrowser` already has functional drop handling; the attribute was a community styling hook.
- Porting the Windows preload bridge into the picker package: rejected — the props stay host-agnostic; the preload contract belongs to the desktop shell.
