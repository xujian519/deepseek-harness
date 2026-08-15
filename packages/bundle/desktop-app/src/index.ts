/**
 * @deepseek-ai/dsh-desktop-app — the desktop-surface bundle's runtime glue
 * plugin plus the bundle patch (`cordis.patch.yml`, declared by the
 * `dsh.bundle.patch` manifest field). The plugin occupies the
 * `desktop-runtime` row; desktop shell services (menu, tray, dialogs,
 * shortcuts, notifications, drag-and-drop) are mounted by `packages/desktop/*`
 * plugins once the shell bridge lands.
 * @module @deepseek-ai/dsh-desktop-app
 */

import type { Context } from '@deepseek-ai/cordis'

/** Stable Cordis plugin name. */
export const name = 'desktop-app'

/**
 * Mount the desktop-surface glue.
 * @param ctx - the booted root context.
 */
export function apply(_ctx: Context): void {}
