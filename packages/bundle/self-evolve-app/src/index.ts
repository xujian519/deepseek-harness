/**
 * @deepseek-ai/dsh-self-evolve-app — the self-evolve opt-in bundle's runtime
 * glue plugin plus the bundle patch (`cordis.patch.yml`, declared by the
 * `dsh.bundle.patch` manifest field). The patch mounts the capability seam
 * (`self-evolve-basic` provider and `tool-self-evolve` consumer) as rows an
 * opting-in profile enables; without this bundle the seam stays dormant and
 * the host plane holds no tools.
 * @module @deepseek-ai/dsh-self-evolve-app
 */

import type { Context } from '@deepseek-ai/cordis'

/** Stable Cordis plugin name. */
export const name = 'self-evolve-app'

/**
 * Mount the self-evolve bundle glue.
 * @param ctx - the booted root context.
 */
export function apply(_ctx: Context): void {}
