# Agent Note: Promote the personal-workbench entry into the sidebar top strip

Status: implemented

English | [中文](2026-09-04-promote-personal-workbench-entry.zh.md)

## Problem

The external `@dely0/dsh-personal-workbench` plugin injects its sidebar entry (`button[data-dsh-personal-workbench-entry]`) mid-strip, wedged between the top actions and the workspace list. With the plugin mounted alongside the scheduled-task and new-session entries, the workbench entry reads as an odd insertion rather than a peer action, and the sidebar's scheduled-task entry occupies the slot where a workbench action fits. The plugin also styles that entry as a plain nav row in its own injected stylesheet.

## Decision

The mounted sidebar shell (`packages/client/ui-sidebar/src/client/SidebarRoot.tsx`) promotes the entry: it hides the scheduled-task trigger, moves the workbench entry to the slot immediately after 「新会话」, and gives it that button's class, label class and icon size (14 wide, 18 in the rail) so it reads as a peer. A `MutationObserver` on `#root` re-applies the placement because the plugin injects the entry after mount and the shell's subtree is swapped on boot/HMR.

The promotion lives in the shell that renders the strip, which is the one every composition mounts. The plugin's own stylesheet lands in `<head>` after the bundle, so the entry's surface comes from the shell rule keyed on the new-session class AND the entry attribute (`SidebarRoot.module.css`): equal-specificity rules there would lose the tie, while the entry's own `:hover` and `[data-active]` rules keep it and still win by order.

The anchor is the shell's own new-session button, matched by the module class the shell renders (the expanded column carries two `session.new.label` buttons — the brand shortcut and the real one — so the label alone is ambiguous). The scheduled-task trigger is matched by its own class (`button.dshc-trigger`), not by its `aria-label`, which the owning plugin localizes.

## Alternatives considered

- **Anchor on `aria-label="新建会话"`** — ambiguous: the brand shortcut carries the same label and appears first in document order, so the effect would move the entry above the logo instead of after the new-session button.
- **Hard-code the current CSS-module hash (`hT2-rG_newSession`)** — the hash changes per build, so the selector would break on the next rebuild; importing the module's own class name keeps the anchor resolved at build time.
- **Apply the placement in the personal-workbench plugin itself** — the plugin owns the entry source, but the entry's injected position and its coexistence with the scheduled-task trigger are a sidebar-layout concern the shell already owns.
- **Keep the promotion in the better-sidebar client** — the desktop composition omitted that shell when this decision was made ([removal note](../../archived/architecture/2026-09-10-desktop-without-workspace-sidebar.md)), so the effect never ran and the desktop showed the plugin's raw entry; a shell that later carries the promotion can own it again ([remount note](2026-09-10-desktop-workspace-sidebar-remount.md)).
- **Set the surface inline from the effect** — inline styles would also block the plugin's `:hover` and `[data-active]` feedback, which the class-and-attribute rule leaves intact.

## Consequences

The workbench entry renders as a peer of New Session wherever the sidebar shell is mounted, desktop included. The scheduled-task trigger is hidden rather than reordered (its former slot is reused), so the scheduled-task panel loses that entry for the session it is hidden in. The promotion is a shell concern now: a composition that mounts no sidebar shell (and therefore no strip) has nothing to promote.
