// @vitest-environment jsdom
/**
 * Plugin assembly: the host half's empty Loader entry, the client half's
 * conversation-view registration (label thunk, badge navigation, chat-landing
 * retries), and the fiber lifecycle that removes the tab with its
 * dictionaries on unload.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId, type SessionId as SessionIdOf } from '@deepseek-ai/dsh-session/types'
import { apply as hostApply } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import type { BoardViewInjected } from '../src/client/BoardView.tsx'
import { en, NS, zh } from '../src/client/locales.ts'

const sid = (id: string): SessionIdOf => SessionId(id)

/** Stub `sessions` service recording `open` calls. */
class TestSessions extends Service {
  readonly opened: SessionIdOf[] = []
  constructor(ctx: Context) { super(ctx, 'sessions') }
  open(id: SessionIdOf): void { this.opened.push(id) }
}

/** Registration options face captured from the slot register call. */
interface RegisteredView {
  id: string
  locale: string
  label: () => string
  inject: (sessionId: SessionIdOf) => BoardViewInjected
}

/** The stub context face `apply` reads at registration time. `setActiveView` shapes chat landing. */
function stubFace(setActiveView: () => boolean) {
  const register = vi.fn(() => () => undefined)
  const injectSlot = vi.fn((_name: string, callback: () => () => void) => callback())
  const dictionaries = vi.fn()
  const bind = vi.fn(() => (key: string) => key)
  const open = vi.fn()
  const landing = vi.fn(setActiveView)
  const ctx = {
    effect: (fn: () => () => void) => { fn(); return () => undefined },
    locale: { register: dictionaries, bind },
    sessions: { open },
    conversation: { setActiveView: landing },
    slots: { inject: injectSlot, register },
  }
  return { ctx, register, injectSlot, dictionaries, open, landing, view: () => (register.mock.calls[0] as unknown as [RegisteredView])[0] }
}

describe('plugin registration', () => {
  it('keeps the host half an empty Loader entry', () => {
    expect(() => { hostApply() }).not.toThrow()
  })

  it('registers the board tab and lands a badge click on the chat view immediately', () => {
    const face = stubFace(() => true)
    apply(face.ctx as never)
    expect(face.dictionaries).toHaveBeenCalledWith(NS, { zh, en })
    expect(face.injectSlot).toHaveBeenCalledWith('conversation.view', expect.any(Function))
    const options = face.view()
    expect(options).toMatchObject({ id: 'board', order: 20, locale: NS })
    // The label reads through the bound translate, so it follows the active
    // locale without re-registration.
    expect(options.label()).toBe('view.board')
    // Badge navigation opens the target session and lands on its Chat view.
    options.inject(sid('s-current')).openSession(sid('s-target'))
    expect(face.open).toHaveBeenCalledWith(sid('s-target'))
    expect(face.landing).toHaveBeenCalledTimes(1)
    expect(face.landing).toHaveBeenCalledWith(sid('s-target'), 'chat')
    // The current session's badge is a no-op.
    options.inject(sid('s-current')).openSession(sid('s-current'))
    expect(face.open).toHaveBeenCalledTimes(1)
    expect(face.landing).toHaveBeenCalledTimes(1)
  })
})

describe('chat-landing retries', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('retries every 100ms until the target seat mounts', () => {
    let calls = 0
    const face = stubFace(() => { calls += 1; return calls >= 3 })
    apply(face.ctx as never)
    face.view().inject(sid('s-current')).openSession(sid('s-target'))
    expect(face.open).toHaveBeenCalledWith(sid('s-target'))
    expect(face.landing).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(100)
    expect(face.landing).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(100)
    expect(face.landing).toHaveBeenCalledTimes(3)
    // Success stops the chain: nothing fires later.
    vi.advanceTimersByTime(1_000)
    expect(face.landing).toHaveBeenCalledTimes(3)
    expect(face.landing).toHaveBeenLastCalledWith(sid('s-target'), 'chat')
  })

  it('gives up after ten failed landings', () => {
    const face = stubFace(() => false)
    apply(face.ctx as never)
    face.view().inject(sid('s-current')).openSession(sid('s-target'))
    vi.advanceTimersByTime(10 * 100)
    expect(face.landing).toHaveBeenCalledTimes(11)
    vi.advanceTimersByTime(1_000)
    expect(face.landing).toHaveBeenCalledTimes(11)
  })
})

describe('plugin lifecycle', () => {
  it('removes the view slot and the dictionaries when the fiber unloads', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    // The locale plugin requires the connection handle, the forwarded-event
    // port, and the settings scope.
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    ctx.provide('conversation', { setActiveView: () => true } as never)
    await ctx.plugin(TestSessions).await()
    ctx.slots.register({
      name: 'root',
      children: { 'conversation.view': { kind: 'list', scope: 'session' } },
    } as never, () => null)
    await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
    const t = ctx.locale.bind(NS)
    const fiber = ctx.plugin({ inject, apply })
    await fiber.await()
    expect(ctx.slots.entries('conversation.view')).toHaveLength(1)
    expect([zh['view.board'], en['view.board']]).toContain(t('view.board'))
    const boardFace = ctx.slots.entries('conversation.view')[0]!.inject?.(sid('s-current') as never) as unknown as BoardViewInjected
    boardFace.openSession(sid('s-target'))
    expect((ctx.sessions as unknown as TestSessions).opened).toEqual([sid('s-target')])
    await fiber.dispose()
    expect(ctx.slots.entries('conversation.view')).toEqual([])
    // The dictionaries ride the fiber: after unload the key falls back to itself.
    expect(t('view.board')).toBe('view.board')
  })
})
