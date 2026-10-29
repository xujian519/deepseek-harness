/** Brand-slot occupants for the sidebar and the blank-session hero. */
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { PatentMark, strokeForSize } from './Mark.tsx'
import css from './Wordmark.module.css'

/** The product name this fork presents. */
const PRODUCT_NAME = 'DSH Patent'

/**
 * Format the build metadata exactly as the shell's local-build fallback does,
 * so taking over the name slot does not change what the chip reports.
 * @returns the version string, or undefined when the build carried none.
 */
function buildVersion(): string | undefined {
  const version = process.env.DSH_CLIENT_VERSION
  if (version === undefined) return undefined
  const commit = process.env.DSH_CLIENT_COMMIT_HASH
  return version
    + (commit === undefined ? '' : `-${commit}`)
    + (process.env.DSH_CLIENT_GIT_DIRTY === 'true' ? '-dirty' : '')
}

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
  const version = buildVersion()
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
