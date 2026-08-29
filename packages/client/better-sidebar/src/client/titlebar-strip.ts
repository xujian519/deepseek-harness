/**
 * The title-bar strip resolution chain — the ONE place that decides how
 * many pixels the sidebar yields at the top. Standard signals first, then
 * the user's chosen scheme; never a per-shell branch:
 *
 *   0. `web` scheme — EXPLICIT "DSH official web": never adapt, not even
 *      standard WCO geometry (the user declares the plain web UI).
 *   1. Window Controls Overlay real geometry (standard API, authoritative
 *      when present — even 0, e.g. the overlay is hidden while maximized).
 *   2. The `dsh-desktop-titlebar-inset` URL contract parameter (a shell
 *      declares the exact pixels it reserves).
 *   3. The active shell preset's strip (scheme `preset` — opt-in data).
 *   4. The legacy manual `titleBarStripPx` (scheme `custom`).
 *   5. 0 — plain-browser semantics, nothing modified.
 *
 * The result drives `--dsh-title-bar-strip` + `body[data-dsh-title-bar-compat]`
 * exactly like the legacy boolean did; only the VALUE source changed.
 */
import type { DesktopEnv } from './desktop-env.ts'
import type { TitleBarScheme } from '../prefs-shared.ts'
import type { WcoSnapshot } from './wco.ts'
import { presetStripFor, type ShellPreset } from './shell-presets.ts'

/**
 * Resolve the title-bar strip in px through the precedence chain (web → WCO
 * geometry → shell inset URL parameter → preset → manual → 0).
 * @param env - detected desktop environment (owns the inset URL parameter).
 * @param wco - current Window Controls Overlay snapshot.
 * @param scheme - the user's title-bar compatibility scheme.
 * @param preset - the active shell preset, or undefined when none applies.
 * @param customStripPx - the legacy manual strip value (scheme `custom`).
 * @returns the strip in px the sidebar yields at the top.
 */
export function computeTitleBarStrip(
  env: DesktopEnv,
  wco: WcoSnapshot,
  scheme: TitleBarScheme,
  preset: ShellPreset | undefined,
  customStripPx: number,
): number {
  if (scheme === 'web') return 0
  if (wco.present) return wco.height
  if (env.titlebarInset > 0) return env.titlebarInset
  if (scheme === 'preset') return presetStripFor(preset, env) ?? 0
  if (scheme === 'custom') return customStripPx
  return 0
}
