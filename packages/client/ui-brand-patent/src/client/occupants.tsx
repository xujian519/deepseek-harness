/** Brand-slot occupants for the sidebar and the blank-session hero. */
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
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
 * Sidebar name occupant: the product name only.
 *
 * The shell renders no build-version chip in the brand area, so neither does
 * this occupant.
 * @returns the product name.
 */
export function PatentSidebarName(_props: SidebarBrandNameOwnerProps) {
  return (
    <span className={css.root}>
      <span className={css.title}>{PRODUCT_NAME}</span>
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
