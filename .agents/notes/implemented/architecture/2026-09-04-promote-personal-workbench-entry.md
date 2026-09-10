# Agent Note: Promote the personal-workbench entry into the sidebar top strip

Status: implemented

English | [中文](2026-09-04-promote-personal-workbench-entry.zh.md)

## Problem

The external `@dely0/dsh-personal-workbench` plugin injects its sidebar entry (`button[data-dsh-personal-workbench-entry]`) mid-strip, wedged between the top actions and the workspace list. With the plugin mounted alongside the scheduled-task and new-session entries, the workbench entry reads as an odd insertion rather than a peer action, and the sidebar's scheduled-task entry occupies the slot where a workbench action fits.

## Decision

The better-sidebar client shell (`packages/client/better-sidebar/src/client/Sidebar.tsx`) promotes the entry on every mount: it hides the scheduled-task button, moves the workbench entry to the slot immediately after 「新建会话」, and copies the new-session button's classes and icon sizing (14×14) so it reads as a peer. A `MutationObserver` on `#root` re-applies the placement because the plugin injects the entry after mount and the shell's subtree is swapped on boot/HMR.

The anchor is the new-session button, matched by its CSS-module class suffix (`[class*="_newSession"]`). The expanded sidebar carries two elements with `aria-label="新建会话"` (the brand shortcut and the real button), so matching the aria-label alone is ambiguous; the class suffix disambiguates without hard-coding a build-time hash. `document.querySelector` only returns connected nodes, so a found anchor is always in the DOM.

## Alternatives considered

- **Anchor on `aria-label="新建会话"`** — ambiguous: the brand shortcut carries the same label and appears first in document order, so the effect would move the entry above the logo instead of after the new-session button.
- **Hard-code the current CSS-module hash (`hT2-rG_newSession`)** — the hash changes per build, so the selector would break on the next rebuild.
- **Apply the placement in the personal-workbench plugin itself** — the plugin owns the entry source, but the entry's injected position and its coexistence with the scheduled-task entry are a sidebar-layout concern the shell already owns.

## Consequences

The better-sidebar client now composes the workbench entry consistently regardless of which plugins inject actions into the strip. The scheduled-task entry is hidden rather than reordered (its former slot is reused). Because the effect runs in the better-sidebar client bundle, both the browser `dsh web` composition and the desktop composition (which mounts the first-party `@deepseek-ai/dsh-better-sidebar`) pick it up; the desktop needs that first-party package rebuilt so its client bundle carries the change.
