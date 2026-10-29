/** Client registration for the DSH Patent brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Side-effect type import: declares `ctx.slots` on Context.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { PatentHeroMark, PatentSidebarMark, PatentSidebarName } from './occupants.tsx'

/**
 * Required service: the UI slot registry.
 *
 * Without this declaration the runtime refuses to activate the entry — a
 * required client entry that never activates fails the whole web boot, so this
 * is load-bearing rather than documentation.
 */
export const inject = ['slots']

/**
 * Fill the fork's brand slots.
 *
 * Unlike `ui-brand-official`, this registers unconditionally: a fork build's
 * profile is never `official`, so a profile gate here would leave the official
 * whale fallbacks in place — which is exactly what the fork must stop showing.
 * An official build loads its own package instead, and a single-occupant slot
 * takes whichever the composition registers.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.register({ name: 'sidebar.brand.mark' }, PatentSidebarMark))
  ctx.slots.inject('sidebar.brand.name', () =>
    ctx.slots.register({ name: 'sidebar.brand.name' }, PatentSidebarName))
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.mark' }, PatentHeroMark))
}
