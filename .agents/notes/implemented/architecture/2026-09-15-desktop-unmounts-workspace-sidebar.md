# Agent Note: The desktop app leaves the workspace sidebar unmounted

Status: implemented

English | [中文](2026-09-15-desktop-unmounts-workspace-sidebar.zh.md)

## Problem

A desktop app reported two right Sidebars. Both were real, and both were mounted:

- The web-app bundle's own right Sidebar, `@deepseek-ai/dsh-client-ui-sidebar-right` with its file-tree tab type `@deepseek-ai/dsh-client-ui-sidebar-files`, registered by the frame's `rightbar` seat (`packages/bundle/web-app/cordis.patch.yml`).
- The workspace sidebar, `@deepseek-ai/dsh-better-sidebar`, inserted by the desktop overlay since the [remount decision](2026-09-10-desktop-workspace-sidebar-remount.md) (`apps/desktop-host/config/desktop.cordis.patch.yml`).

Each panel anchors to the frame's right edge with `position: absolute; right: 0`, so neither reserves space for the other and neither knows the other exists. Two collapsed panels both sit off-screen and read as one product; two expanded panels paint over each other, each with its own control set. The reported screenshot shows the file-tree overlap directly.

The overlap is worst on the panel content, because both own a file tree of the same workspace. The native Sidebar is a docking surface whose default page is the file tree — `ui-sidebar-files` is the only registered guide entry, so `defaultSeed` resolves to it and every first expansion lands there. The workspace sidebar's explorer draws the same session workspace through its own `/sidebar/*` routes.

A mutual-exclusion guard existed for one of the two pairs only: `better-sidebar` declines to mount while the settings namespace `aionui-panel` resolves `rightPanel: 'aionui-panel'`. The shipped desktop carries no `aionui` plugin, so that namespace is absent, `externalDisable()` is false, and the guard never fires. Nothing guarded `better-sidebar` against `ui-sidebar-right`, whose expand control is a separate entry in the conversation header's corner seat.

## Decision

The desktop overlay inserts the `better-sidebar` row disabled, and the row's comment names the reason and links here. The desktop app mounts the bundle's right Sidebar alone.

`disabled: true` on the insert rather than dropping the row: the patch then reads as an opt-out with a name attached, a row that fails to resolve warns instead of silently disappearing, and re-mounting is a one-word edit. The [archived removal note](../../archived/architecture/2026-09-10-desktop-without-workspace-sidebar.md) dropped the row outright; naming it is the one difference.

What the desktop app gives up with the row off: the code workbench (explorer, editor, per-session terminals, git panel, side chat, subagent previews, embedded browser), the `/sidebar/*` host routes, the `sidebar_open` tool and the opt-in `terminal_*` set, and the `conversation.chat.turnTail` interception that renders the `交付物` produced-file chips. The native right Sidebar keeps its own file tab, its document preview, and its expand control in the conversation header.

## Alternatives considered

- **Disable `ui-sidebar-right` instead and keep the workbench.** Rejected: document preview belongs to the native Sidebar (`ui-sidebar-documentpreview` renders files through `dsh-resource://` addresses), the workspace sidebar has no replacement for it, and the product's own right Sidebar is the surface a browser `dsh web` deployment also gets. The workbench is the smaller loss.
- **Give `better-sidebar` a guard against `ui-sidebar-right` the way it has one against `aionui-panel`.** Rejected for now: it needs a new settings namespace and a default, and the desktop composition is where this repository already decides what the desktop app carries. Two panels that must not coexist, each able to be turned on by a different owner, is a composition problem rather than a runtime one.
- **Keep both mounted and leave the choice to the user's habit of not expanding both.** Rejected: expansions are independent, the native Sidebar's first expansion seeds the file tree by default, and the reported state is exactly the one this alternative asks users to avoid.
- **Revert the transport repairs the remount made.** Rejected: the `duplex: 'half'` terminal request and the `sessionController.inspect` cwd chain fix latent defects that any mounting composition meets, browser `dsh web` included. Unmounting on desktop does not make them wrong.

## Consequences

- The desktop app draws one right Sidebar again, entered by the conversation header's expand control.
- The two transport repairs stay, and `packages/client/better-sidebar` still has a first-party consumer in `dsh web` deployments that insert the row, so the package and its 1725-test suite keep their subject.
- The row is now opt-out in both shipped compositions. A deployment that wants the workbench drops `disabled: true` from the desktop patch or inserts the row into a browser composition.
- The overlap remains reachable by anyone who re-mounts the row without disabling the native Sidebar; the comment at the row names the pair, so the next editor meets the constraint at the edit site.
- The desktop divergence from upstream for this decision is the disabled insert row, its comment, and this note.

## Testing

No recorded-session snapshot pins this change: no profile in the keyless matrix mounts the workspace sidebar, and the change is composition membership rather than model- or user-visible output. `npx vitest run apps/desktop-host` keeps the boot fixture green — `desktop-boot.spec.ts` imports the plugin directly as its route-registering fixture rather than reading the patch, so it is unaffected by the row's `disabled` value. The transport repairs the remount made keep their coverage in `npx vitest run packages/client/better-sidebar`.

The change was verified against the installed application over CDP: with the row disabled, the panel host `[data-dsh-panel-host]` carries no panel and no toggle cluster, and the frame's `rightbarCol` holds the bundle's Sidebar alone.

## Related

- [Remount the workspace sidebar on desktop](2026-09-10-desktop-workspace-sidebar-remount.md) — the mount this change reverses, and the transport repairs it keeps.
- [Desktop composition without the workspace sidebar](../../archived/architecture/2026-09-10-desktop-without-workspace-sidebar.md) — the earlier removal, which also deferred dropping `ui-sidebar-right`.
- [Adopt better-sidebar first-party](2026-08-28-adopt-better-sidebar-first-party.md) — why the package is first-party and how it reaches desktop releases.
