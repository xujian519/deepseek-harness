/** Brand-slot occupants for the sidebar and the blank-session hero. */
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { localBuildVersion } from '@deepseek-ai/dsh-client-ui-primitives'
import { PatentMark, strokeForSize } from './Mark.tsx'
import css from './Wordmark.module.css'

/** The product name this fork presents. */
const PRODUCT_NAME = 'DSH Patent'

/**
 * Sidebar mark occupant.
 * @param props.size - requested square edge in px.
 * @returns the DSH Patent mark at that size.
 */
export function PatentSidebarMark({ size }: SidebarBrandMarkOwnerProps) {
  return <PatentMark size={size} stroke={strokeForSize(size)} />
}

/**
 * Sidebar name occupant: the product name over the build-version chip.
 *
 * It keeps the version chip the shell fallback shows, because a local fork
 * build is exactly what that chip is for. It drops the fallback's
 * click-to-copy affordance: that pairs a clipboard write with the sidebar's own
 * toast, and reaching across packages for both would couple this presentation
 * package to sidebar state for one affordance.
 * @returns the product name and, when the build carried one, its version.
 */
export function PatentSidebarName(_props: SidebarBrandNameOwnerProps) {
  const version = localBuildVersion()
  return (
    <span className={css.root}>
      <span className={css.title}>{PRODUCT_NAME}</span>
      {version === undefined ? null : <span className={css.version}>{version}</span>}
    </span>
  )
}

/**
 * Blank-session hero mark occupant.
 *
 * Unlike the official occupant this does not animate: the hero fish's swim
 * morph deforms the whale outline, and the two hooks have no equivalent
 * deformation that keeps the coupling readable at 34 px.
 * @param props.size - requested square edge in px.
 * @param props.className - host class preserving the surrounding mark geometry.
 * @returns the DSH Patent mark at that size.
 */
export function PatentHeroMark({ size, className }: HeroBrandMarkOwnerProps) {
  return <PatentMark size={size} className={className} stroke={strokeForSize(size)} />
}
