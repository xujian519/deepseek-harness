# Agent Note: Desktop release branding parameters

Status: implemented

English | [中文](2026-09-09-desktop-release-branding-parameters.zh.md)

## Problem

The desktop shell hardcodes the `DeepSeek Harness` product name and ships no application icon, so a deployment cannot package the same shell under another product identity without source edits. The application ID was already an environment parameter.

## Decision

`DSH_DESKTOP_PRODUCT_NAME` brands the packaged application and defaults to `DeepSeek Harness`; values beyond 64 characters or containing control characters and path separators fail packaging. `DSH_DESKTOP_ICON_DIR` points at a directory holding `icon.icns` and `icon.ico`; when set, each platform target requires its own file and packaging fails otherwise, and when unset the release keeps the default Electron icon. Update artifact names stay on the fixed `deepseek-harness-` template because branded names may contain spaces and the updater metadata plus upload paths key on that stable template. The repository assets under `apps/desktop/assets/` carry the application and tray icon set; the icon files are packaging inputs selected through the environment variable, and the tray icons are runtime assets for shell-owned tray UI.

## Alternatives considered

**Deriving artifact names from the product name.** It would push spaces and renaming churn into update metadata and storage paths for a cosmetic gain.

**Hardcoding a second application target.** A second target duplicates the release pipeline; environment parameters package one shell under any identity.

## Consequences

Branded releases set three environment variables (`DSH_DESKTOP_APP_ID`, `DSH_DESKTOP_PRODUCT_NAME`, `DSH_DESKTOP_ICON_DIR`) on top of the signing inputs. Environment resolution tests cover defaults, valid values, and rejections; a packaged `:dir` build verifies name and icon placement without signing credentials.
