# Agent Note: Desktop composition without the workspace sidebar

Status: implemented
Archived: 2026-09-10

English | [中文](2026-09-10-desktop-without-workspace-sidebar.zh.md)

## Problem

The desktop application's conversation header carried three panel controls: two buttons pinned at the viewport's top-right corner (the bottom-panel toggle and the right-panel toggle, both from `@deepseek-ai/dsh-better-sidebar`'s toggle cluster) and one in the header corner past them (the `@deepseek-ai/dsh-client-ui-sidebar-right` expand control, rendered only while that right Sidebar is collapsed). Clicking the right-panel toggle opened the sidebar's `文件` workbench — explorer, editor, terminal, git, side-chat, subagent, and browser tabs.

The two cluster buttons were reported as chrome the desktop product does not want. They cannot be hidden on their own: they are the only entry to the panels they open, and the panels' own close controls exist only while a panel is open, so a product that hides the toggles keeps panels that nothing can reopen.

## Decision

The desktop composition (`apps/desktop-host` plus the `desktop.cordis.patch.yml` overlay over the `web-app` bundle) no longer inserts `@deepseek-ai/dsh-better-sidebar`; the row is deliberately absent from the patch, and the omission site carries a comment naming that the absence is intentional plus this note's path.

- The desktop app no longer mounts the sidebar: no bottom panel, no right workbench panel, no `/sidebar/*` host routes, and none of the agent tools its host half registers (`sidebar_open`, plus the opt-in `terminal_*` set). The `交付物` produced-file chips fall back to the default deliverables behavior, because the sidebar's `conversation.chat.turnTail` interception is no longer registered.
- `apps/desktop-host/package.json` keeps upstream's declaration of `@deepseek-ai/dsh-better-sidebar` unchanged: the portless-seam boot test (`apps/desktop-host/tests/desktop-boot.spec.ts`) still imports the plugin as its route-registering fixture, and the desktop package set installs it anyway, because the set is the union of the production closures rooted at `@deepseek-ai/dsh` and `@deepseek-ai/dsh-desktop-host` and `apps/cli`'s manifest carries it. Installed and unmounted, it contributes no UI.
- The `ui-sidebar-right` expand control stays. It belongs to a different package, whose right Sidebar carries the docking surface and the document-preview and workspace-file tab types; the report identified the sidebar's own pair, and that control is a separate product decision.
- The portless webServer stays load-bearing. The host dispatch sends `/api/*` to the connection handler directly and every other path through `PortlessWebServer`'s route table, where `@deepseek-ai/dsh-client-modules` registers its `/plugins` prefix route.
- This repository maintains the official desktop app (`apps/desktop` over `apps/desktop-host`) and follows upstream's composition otherwise. The omitted row is its one deliberate divergence.

## Alternatives considered

**Hide the two toggle buttons in the desktop app and keep the plugin mounted.** Rejected: with the toggles gone, the bottom and right panels have no entry at all (their own close controls only exist while a panel is open), so the panels become unreachable except by flipping the "open by default" preference in the sidebar's settings page.

**Disable the row from a profile patch (`- id: better-sidebar` with `disabled: true`).** Rejected: the desktop profile is installation-owned state under `$DSH_HOME/profiles/desktop` that release activation replaces from the seed, so an opt-out written there is not shipped product behavior. The composition overlay is where this repository defines what the desktop app carries.

**Remove the package from the repository.** Rejected: the report asked for these panels not to appear in the desktop app, not for the capability to disappear from the codebase; the package, its tests, and its Web-side value are unaffected by desktop composition membership.

**Drop `ui-sidebar-right` in the same change.** Deferred: the report's arrow and its follow-up screenshot (clicking the right-panel toggle opened the `文件` workbench) identify the sidebar's pair, and the expand control belongs to a package whose right Sidebar owns document preview. Removing it is its own decision with its own evidence.

## Consequences

- The left nav loses the sidebar client's strip work: the promotion that moves the external personal-workbench entry to the slot after 「新建会话」 and hides the scheduled-task entry now runs in the mounted sidebar shell (`@deepseek-ai/dsh-client-ui-sidebar`), so the desktop app keeps that placement.
- No shipped composition registers a streaming route on the portless surface any more: all three registrations were the sidebar's. `PortlessWebServer.registerStream` and the gateway's held upgrade route stay, because a composition plugin may register either.
- The divergence from upstream for this decision is four things: the omitted row, its comment, the retitled boot test, and this note. `apps/desktop-host/package.json` and `pnpm-lock.yaml` stay upstream-identical, so an upstream sync meets a small conflict surface and has to decide the omission again.
- The capability given up is a code workspace inside the desktop app: reading and editing produced files, running commands, inspecting git state, and opening side conversations and subagents without leaving the session. Reintroducing it means inserting the row again in `apps/desktop-host/config/desktop.cordis.patch.yml`.

## Testing

No test asserts the desktop composition's row set: a full composition boot is impossible in a unit test, because the profile's plugin set is hoisted only into a pnpm-deployed project while `packages/bundle/*` are separate workspaces. `apps/desktop-host/tests/desktop-boot.spec.ts` continues to cover the portless seam with the sidebar as its fixture plugin, so the seam's dispatch, streaming, and route-disposal behavior stay pinned. The shipped absence itself is observable only in a built application's header.

## Related

- [Adopt better-sidebar first-party](2026-08-28-adopt-better-sidebar-first-party.md) — why the package is first-party and how it reaches desktop releases.
- [Desktop portless webServer seam](2026-09-09-desktop-portless-webserver-seam.md) — the seam that served the sidebar's routes.
- [Promote the personal-workbench entry into the sidebar top strip](2026-09-04-promote-personal-workbench-entry.md) — the strip placement, now owned by the mounted sidebar shell.
