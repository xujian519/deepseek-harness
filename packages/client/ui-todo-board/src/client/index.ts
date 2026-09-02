/**
 * Browser todo-board plugin contributing one entry to the conversation view
 * slot without defining a service. The board reads the session list's
 * `todosLatest` projection column through the standard `useSessions` hook,
 * so no per-session subscription of its own exists.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row (declared by the slot's
// owning package) must be in the program for the register call to type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { BoardView, type BoardViewInjected } from './BoardView.tsx'
import { en, NS, zh } from './locales.ts'

export type { BoardViewInjected } from './BoardView.tsx'

/** Required services: the conversation slot, session open, conversation views, and the locale service. */
export const inject = ['slots', 'sessions', 'conversation', 'locale']

/**
 * Client plugin body: register the board view tab. The registration rides
 * the slot service's effect wrapper, so plugin unload removes the tab.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-todo-board: dictionaries')
  // Registration-time text (the view tab label) reads through the bound
  // translate as a thunk, so it follows the active locale without
  // re-registration.
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'board',
    order: 20,
    locale: NS,
    label: () => t('view.board'),
    inject: (sessionId: SessionId): BoardViewInjected => ({
      openSession: (target: SessionId) => {
        if (target === sessionId) return
        ctx.sessions.open(target)
        // The badge promises the session's work, so land on its Chat view
        // rather than whichever tab that session happened to leave open. The
        // target's conversation seat mounts with the switch, so the first
        // write can race the setter registration — retry until it lands.
        const landOnChat = (attempt: number): void => {
          if (ctx.conversation.setActiveView(target, 'chat') || attempt >= 10) return
          setTimeout(() => { landOnChat(attempt + 1) }, 100)
        }
        landOnChat(0)
      },
    }),
  }, BoardView))
}
