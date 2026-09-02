/**
 * BoardView: the cross-session todo board in the conversation view ring.
 * Three status columns over the current workspace's sessions; each card
 * carries a session badge that navigates back to the owning session. An
 * empty board renders a dashed ghost preview so a first-time reader sees
 * the shape real todos will land in. All data arrives through the
 * framework-standard `useSessions`/`useWorkspaces` hooks; the fold lives in
 * board-model.ts.
 */

import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { BOARD_COLUMNS, boardCardCount, boardTags, filterBoard, projectBoard } from './board-model.ts'
import type { TodoBoardKey } from './locales.ts'
import { NS } from './locales.ts'
import css from './BoardView.module.css'

/** Business callbacks injected by the plugin body. */
export interface BoardViewInjected {
  /** Open the badge's session in the conversation. */
  openSession: (sessionId: SessionId) => void
}

/** Stable per-tag hue (0-359) so a tag paints the same color everywhere on the board. */
function tagHue(tag: string): number {
  let hash = 0
  for (let index = 0; index < tag.length; index++) {
    hash = (hash * 31 + tag.charCodeAt(index)) | 0
  }
  return ((hash % 360) + 360) % 360
}

/** Inline custom property carrying the tag's hue to the chip styles. */
function tagStyle(tag: string): CSSProperties {
  return { '--tag-hue': String(tagHue(tag)) } as CSSProperties
}

/** Ghost-preview card copy per column, keyed like the real columns. */
const PREVIEW_KEYS = {
  pending: 'empty.preview.pending',
  in_progress: 'empty.preview.inProgress',
  completed: 'empty.preview.completed',
} as const satisfies Record<(typeof BOARD_COLUMNS)[number], TodoBoardKey>

/** Column label keys, indexed by the shared column order. */
const COLUMN_LABEL_KEYS = {
  pending: 'column.pending',
  in_progress: 'column.inProgress',
  completed: 'column.completed',
} as const satisfies Record<(typeof BOARD_COLUMNS)[number], TodoBoardKey>

export function BoardView({
  openSession, t, useSessions, useWorkspaces,
}: ConvViewProps
  & InjectFace<BoardViewInjected>
  & PropsLocale<typeof NS>) {
  const list = useSessions(s => s)
  const workspaces = useWorkspaces(s => s.items)
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const columns = useMemo(() => projectBoard(list, workspaces), [list, workspaces])
  const tags = useMemo(() => boardTags(columns), [columns])
  // A tag that vanished from every card (the owning list was rewritten) filters
  // nothing: render the unfiltered board while the selection is stale.
  const effectiveTag = activeTag !== null && tags.includes(activeTag) ? activeTag : null
  const visible = useMemo(() => filterBoard(columns, effectiveTag), [columns, effectiveTag])
  const total = boardCardCount(columns)

  const toggleTag = (tag: string): void => {
    setActiveTag(current => (current === tag ? null : tag))
  }

  if (total === 0) {
    return (
      <div className={css.empty}>
        <div className={css.emptyTitle}>{t('empty.title')}</div>
        <div className={css.emptyHint}>{t('empty.hint')}</div>
        <div className={css.preview} aria-hidden="true">
          {BOARD_COLUMNS.map(column => (
            <div key={column} className={css.previewColumn}>
              <div className={css.previewHead}>{t(COLUMN_LABEL_KEYS[column])}</div>
              <div className={css.previewCard}>
                <span className={css.previewChip} title={t('empty.previewTooltip')}>
                  {t('empty.preview')}
                </span>
                {' '}
                {t(PREVIEW_KEYS[column])}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={css.root} role="region" aria-label={t('board.aria')}>
      {tags.length > 0 && (
        <div className={css.filterBar} role="group" aria-label={t('filter.aria')}>
          <button
            type="button"
            className={effectiveTag === null ? css.filterChipActive : css.filterChip}
            onClick={() => { setActiveTag(null) }}
          >
            {t('filter.all')}
          </button>
          {tags.map(tag => (
            <button
              key={tag}
              type="button"
              style={tagStyle(tag)}
              className={effectiveTag === tag ? css.filterChipActive : css.filterChip}
              onClick={() => { toggleTag(tag) }}
              aria-label={t('filter.tag', { tag })}
              aria-pressed={effectiveTag === tag}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
      <div className={css.grid}>
        {BOARD_COLUMNS.map((column) => {
          const cards = visible[column]
          return (
            <section key={column} className={css.column}>
              <div className={css.columnHead}>
                <span>{t(COLUMN_LABEL_KEYS[column])}</span>
                <span className={css.columnCount}>{cards.length}</span>
              </div>
              <div className={css.columnBody}>
                {cards.map((card, index) => (
                  <div key={`${card.sessionId}:${index}`} className={css.card}>
                    <div className={css.cardContent}>{card.content}</div>
                    {card.tags.length > 0 && (
                      <div className={css.cardTags}>
                        {card.tags.map(tag => (
                          <span key={tag} style={tagStyle(tag)} className={css.cardTag}>{tag}</span>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      className={css.cardBadge}
                      onClick={() => { openSession(card.sessionId) }}
                      aria-label={t('card.jump', { session: card.sessionTitle, content: card.content })}
                      title={card.sessionId}
                    >
                      {card.sessionTitle}
                    </button>
                  </div>
                ))}
                {cards.length === 0 && <div className={css.columnEmpty}>{t('column.empty')}</div>}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
