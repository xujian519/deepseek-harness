# Agent Note: Desktop release branding parameters

Status: implemented

English | [中文](2026-09-09-desktop-release-branding-parameters.zh.md)

## Problem

The desktop shell hardcodes the `DeepSeek Harness` product name and ships no application icon, so a deployment cannot package the same shell under another product identity without source edits. The application ID was already an environment parameter.

## Decision

`DSH_DESKTOP_PRODUCT_NAME` brands the packaged application and defaults to `DeepSeek Harness`; values beyond 64 characters or containing control characters and path separators fail packaging. `DSH_DESKTOP_ICON_DIR` points at a directory holding `icon.icns` and `icon.ico` that replace the bundled brand icons; when set, each platform target requires its own file and packaging fails otherwise, and when unset packaging ships the brand icons committed under `apps/desktop/assets/`. Update artifact names stay on the fixed `deepseek-harness-` template because branded names may contain spaces and the updater metadata plus upload paths key on that stable template. The repository assets under `apps/desktop/assets/` carry the application and tray icon set; the icon files are the default packaging inputs, overridable through the environment variable, and the tray icons are runtime assets for shell-owned tray UI.

## Alternatives considered

**Deriving artifact names from the product name.** It would push spaces and renaming churn into update metadata and storage paths for a cosmetic gain.

**Hardcoding a second application target.** A second target duplicates the release pipeline; environment parameters package one shell under any identity.

## Consequences

A release sets `DSH_DESKTOP_APP_ID` on top of the signing inputs; the name and icon parameters only ride releases that override them. Environment resolution tests cover defaults, valid values, and rejections; configuration tests pin the bundled icon default, the environment override, and the missing-file refusal; a packaged `:dir` build verifies name and icon placement without signing credentials.
