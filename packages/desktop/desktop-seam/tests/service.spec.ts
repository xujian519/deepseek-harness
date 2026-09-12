/**
 * Tests for the `ctx.desktop` Service Definition.
 */

import { describe, expect, expectTypeOf, it } from 'vitest'
import type { Events } from '@deepseek-ai/cordis'
import { DesktopError, MenuId, NotificationId, type DesktopMenuItem } from '../src/index.ts'

describe('DesktopError', () => {
  it('carries a closed business code', () => {
    const error = new DesktopError('bridge-disconnected', 'test')
    expect(error.code).toBe('bridge-disconnected')
    expect(error.message).toBe('test')
    expect(error.name).toBe('DesktopError')
  })
})

describe('desktop bridge identities', () => {
  it('brands the identities the bridge reports', () => {
    // The ids cross the Electron bridge as JSON, so the payload that returns
    // them must not be interchangeable with unrelated strings.
    expectTypeOf<Parameters<Events['desktop/menu-activated']>[0]>().toEqualTypeOf<{ menuId: ReturnType<typeof MenuId> }>()
    expectTypeOf<Parameters<Events['desktop/notification-clicked']>[0]>().toEqualTypeOf<{ notificationId: ReturnType<typeof NotificationId> }>()
    expectTypeOf<DesktopMenuItem['id']>().toEqualTypeOf<ReturnType<typeof MenuId>>()
  })

  it('brands without changing the value', () => {
    expect(MenuId('open')).toBe('open')
    expect(NotificationId('notification-1')).toBe('notification-1')
  })
})
