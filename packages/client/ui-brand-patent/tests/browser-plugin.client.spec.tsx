// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { MARK_PATHS, MARK_VIEWBOX, PatentMark, strokeForSize } from '../src/client/Mark.tsx'
import { PatentHeroMark, PatentSidebarMark, PatentSidebarName } from '../src/client/occupants.tsx'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

/** Every slot this package owns: the fork fills the name and the hero too, unlike the official set. */
const HOLES = ['sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark'] as const

/** Build a slot registry with the two holes declared (or not, to test late declaration). */
async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, declareHoles, disposeHoles }
}

/** Pull the endpoint x of a path's final command, for the centreline invariant. */
function lastPointX(path: string): number {
  const match = /L\s*(-?\d+(?:\.\d+)?)\s+-?\d+(?:\.\d+)?$/u.exec(path)
  expect(match, `path has no trailing L command: ${path}`).not.toBeNull()
  return Number(match![1])
}

describe('DSH Patent browser-brand plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the slot service it uses', () => {
    expect(inject).toEqual(['slots'])
  })

  it('fills three slots: both sidebar slots and the hero', async () => {
    // The shell fallback for each of these is the official whale or the
    // animated fish, so leaving any one unoccupied leaves official artwork on
    // screen in a fork build.
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    expect(subject.slots.entries('sidebar.brand.name')).toHaveLength(1)
  })

  it('fills both brand slots without a build-profile gate', async () => {
    // The official package returns early unless the profile is `official`; this
    // package must register under the fork's `local` profile instead, which is
    // the whole reason it exists.
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(1)
  })

  it('fills declarations made before or after apply and removes every occupant on teardown', async () => {
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    before.disposeHoles?.()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    await fiber.dispose()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)

    const after = await bench(false)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })
})

describe('mark geometry', () => {
  it('keeps both hook tips past the centreline so the halves interlock', () => {
    // The design decision: tips crossing x = 32 is what makes the two halves
    // read as one object rather than as two brackets. Moving them back to stop
    // short of the centreline would silently undo it.
    const centre = MARK_VIEWBOX.width / 2
    expect(lastPointX(MARK_PATHS.left[1])).toBeGreaterThan(centre)
    expect(lastPointX(MARK_PATHS.right[1])).toBeLessThan(centre)
  })

  it('draws four strokes: a body and a tip per hook', () => {
    expect(MARK_PATHS.left).toHaveLength(2)
    expect(MARK_PATHS.right).toHaveLength(2)
  })

  it('switches to the heavier stroke below 32 px', () => {
    // Below 32 px the 6-unit stroke thins until the crossing tips disappear,
    // mirroring the mark.svg / mark-small.svg split in brand/assets/.
    expect(strokeForSize(16)).toBe(8)
    expect(strokeForSize(31)).toBe(8)
    expect(strokeForSize(32)).toBe(6)
    expect(strokeForSize(128)).toBe(6)
  })
})

describe('occupants', () => {
  it('renders the sidebar mark at the requested size with the small-size stroke', () => {
    const view = render(<PatentSidebarMark size={24} />)
    const svg = view.container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('24')
    expect(svg?.getAttribute('height')).toBe('24')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 64 64')
    // 24 < 32, so every stroke path carries the heavier weight.
    for (const path of view.container.querySelectorAll('path')) {
      expect(path.getAttribute('stroke-width')).toBe('8')
    }
  })

  it('renders the hero mark at 34 px with the standard stroke and forwards the host class', () => {
    const view = render(<PatentHeroMark size={34} className="heroMark" />)
    const svg = view.container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('34')
    expect(svg?.classList.contains('heroMark')).toBe(true)
    for (const path of view.container.querySelectorAll('path')) {
      expect(path.getAttribute('stroke-width')).toBe('6')
    }
  })

  it('paints the right hook through the theme token and the left through currentColor', () => {
    const view = render(<PatentMark size={64} />)
    const strokes = [...view.container.querySelectorAll('path')].map(path => path.getAttribute('stroke'))
    expect(strokes.slice(0, 2)).toEqual(['currentColor', 'currentColor'])
    expect(strokes.slice(2)).toEqual([
      'var(--dsw-alias-state-business-primary)',
      'var(--dsw-alias-state-business-primary)',
    ])
  })

  it('renders the product name and the build version chip', () => {
    vi.stubEnv('DSH_CLIENT_VERSION', '0.2.2-alpha.2')
    vi.stubEnv('DSH_CLIENT_COMMIT_HASH', 'abc1234')
    const view = render(<PatentSidebarName />)
    expect(view.container.textContent).toContain('DSH Patent')
    expect(view.container.textContent).toContain('0.2.2-alpha.2-abc1234')
  })

  it('omits the version chip when the build carried no version', () => {
    vi.stubEnv('DSH_CLIENT_VERSION', undefined)
    const view = render(<PatentSidebarName />)
    expect(view.container.textContent).toBe('DSH Patent')
  })

  it('marks the version chip dirty when the build had uncommitted changes', () => {
    vi.stubEnv('DSH_CLIENT_VERSION', '0.2.2-alpha.2')
    vi.stubEnv('DSH_CLIENT_COMMIT_HASH', 'abc1234')
    vi.stubEnv('DSH_CLIENT_GIT_DIRTY', 'true')
    const view = render(<PatentSidebarName />)
    expect(view.container.textContent).toContain('0.2.2-alpha.2-abc1234-dirty')
  })

  it('marks the artwork decorative so the wordmark owns the accessible name', () => {
    const view = render(<PatentMark size={64} />)
    expect(view.container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })
})
