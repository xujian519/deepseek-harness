/**
 * Rendered Markdown view of one record: its source blocks, attached images, folded tool calls, and
 * the fragment wrapper around MarkdownText.
 */

import { useMemo } from 'react'
import { IconChevronRightOutlineRegular, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { RenderMessageImages } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TrajectorySourceBlock } from './trajectory-record.ts'
import type { TrajectoryTranslate } from './locales.ts'
import css from './TrajectoryTable.module.css'
import { isToolCallOnly, markdownSource } from './trajectory-record-presentation.tsx'
import type { TableRecord } from '../types.ts'
import { markdownLabels } from '../types.ts'

function MarkdownFragment({
  text,
  rendered,
  preview,
  t,
}: {
  text: string
  rendered: boolean
  preview: boolean
  t: TrajectoryTranslate
}) {
  const labels = useMemo(() => markdownLabels(t), [t])
  if (rendered) {
    return (
      <div className={preview ? css.markdownPreview : css.markdownPayload}>
        <MarkdownText text={text} labels={labels} />
      </div>
    )
  }
  return (
    <pre className={`${css.payload} ${preview ? css.payloadPreview : ''}`}>
      {text}
    </pre>
  )
}

function SourceBlocks({
  blocks,
  onOpenCall,
  renderImages,
  t,
}: {
  blocks: readonly TrajectorySourceBlock[]
  onOpenCall: (callId: string) => void
  renderImages: RenderMessageImages
  t: TrajectoryTranslate
}) {
  return (
    <div className={css.sourceBlocks}>
      {blocks.map((block, index) => (
        <section className={css.sourceBlock} key={index}>
          {block.callId !== undefined
            ? (
              <button
                type="button"
                className={css.sourceBlockJumpTarget}
                aria-label={t('block.openSummary', { index: index + 1 })}
                title={t('block.openSummaryTitle')}
                onClick={() => {
                  if (block.callId !== undefined) onOpenCall(block.callId)
                }}
              >
                <span className={css.sourceBlockLabel}>
                  {t('block.label', { index: index + 1, type: block.type })}
                </span>
                <IconChevronRightOutlineRegular className={css.sourceBlockJumpIcon} size={12} />
              </button>
            )
            : (
              <div className={css.sourceBlockHeader}>
                <span className={css.sourceBlockLabel}>
                  {t('block.label', { index: index + 1, type: block.type })}
                </span>
              </div>
            )}
          {/* The Raw view keeps model block order and granularity: one
              gallery per image block, unlike the aggregated record gallery. */}
          {block.attachment !== undefined
            ? renderImages({ images: [{ attachment: block.attachment }], align: 'start' })
            : <pre className={css.sourceBlockContent}>{block.content}</pre>}
        </section>
      ))}
    </div>
  )
}

function recordImages(
  blocks: readonly TrajectorySourceBlock[] | undefined,
): { readonly attachment: ImageAttachmentRef }[] {
  return (blocks ?? []).flatMap(block =>
    block.attachment !== undefined ? [{ attachment: block.attachment }] : [])
}

function MessageImages({
  blocks,
  preview,
  renderImages,
}: {
  blocks: readonly TrajectorySourceBlock[] | undefined
  preview: boolean
  renderImages: RenderMessageImages
}) {
  const images = recordImages(blocks)
  if (images.length === 0) return null
  return (
    <div className={preview ? `${css.messageImages} ${css.messageImagesPreview}` : css.messageImages}>
      {renderImages({ images, align: 'start' })}
    </div>
  )
}

function AssistantToolCalls({
  blocks,
  preview,
  onOpenCall,
  t,
}: {
  blocks: readonly TrajectorySourceBlock[] | undefined
  preview: boolean
  onOpenCall: (callId: string) => void
  t: TrajectoryTranslate
}) {
  const calls = blocks?.filter(block => block.type === 'tool-call') ?? []
  if (calls.length === 0) return null
  return (
    <ul className={preview
      ? `${css.assistantToolCalls} ${css.assistantToolCallsPreview}`
      : css.assistantToolCalls}
    >
      {calls.map((call, index) => (
        <li key={call.callId ?? index}>
          <button
            type="button"
            className={css.assistantToolCallButton}
            title={t('block.openSummaryTitle')}
            onClick={() => {
              if (call.callId !== undefined) onOpenCall(call.callId)
            }}
          >
            <svg
              className={css.assistantToolCallIcon}
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className={css.assistantToolCallText}>
              <span className={css.assistantToolCallName}>
                {call.toolName ?? t('details.toolCall')}
              </span>
              {call.content !== '' && (
                <span className={css.assistantToolCallArgs}>{call.content}</span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function MarkdownRecordContent({
  record,
  rendered,
  preview = false,
  thinkingExpanded,
  onThinkingExpandedChange,
  onOpenCall,
  renderImages,
  t,
}: {
  record: TableRecord
  rendered: boolean
  preview?: boolean
  thinkingExpanded: boolean
  onThinkingExpandedChange: (expanded: boolean) => void
  onOpenCall: (callId: string) => void
  renderImages: RenderMessageImages
  t: TrajectoryTranslate
}) {
  if (record.cell.sourceBlocks?.length && record.cell.sourceBlocks.every(block =>
    block.type === 'tool-addition' || block.type === 'tool-removal')) {
    return <pre className={`${css.payload} ${css.toolUpdatePayload}`}>{record.cell.inputDetail}</pre>
  }
  if (!rendered && record.cell.sourceBlocks && record.cell.sourceBlocks.length > 0) {
    return (
      <SourceBlocks
        blocks={record.cell.sourceBlocks}
        onOpenCall={onOpenCall}
        renderImages={renderImages}
        t={t}
      />
    )
  }
  if (record.cell.thinkingDetail) {
    if (!rendered) {
      const source = [
        record.cell.thinkingDetail,
        record.cell.outputDetail,
      ].filter((value): value is string => value !== undefined && value !== '').join('\n\n')
      return <MarkdownFragment text={source} rendered={false} preview={preview} t={t} />
    }
    return (
      <div className={`${css.assistantContent} ${css.assistantContentRendered}`}>
        <div className={
          preview && !record.cell.outputDetail
            ? `${css.thinkingQuote} ${css.thinkingQuoteOnlyPreview}`
            : css.thinkingQuote
        }
        >
          <button
            type="button"
            className={css.thinkingToggle}
            aria-expanded={thinkingExpanded}
            onClick={() => { onThinkingExpandedChange(!thinkingExpanded) }}
          >
            {t('record.thinking')}
            <IconChevronRightOutlineRegular className={css.thinkingChevron} size={12} />
          </button>
          {thinkingExpanded && (
            <MarkdownFragment
              text={record.cell.thinkingDetail}
              rendered={rendered}
              preview={preview}
              t={t}
            />
          )}
        </div>
        {record.cell.outputDetail && (
          <div className={css.assistantOutput}>
            <MarkdownFragment
              text={record.cell.outputDetail}
              rendered={rendered}
              preview={preview}
              t={t}
            />
          </div>
        )}
        <AssistantToolCalls
          blocks={record.cell.sourceBlocks}
          preview={preview}
          onOpenCall={onOpenCall}
          t={t}
        />
        <MessageImages
          blocks={record.cell.sourceBlocks}
          preview={preview}
          renderImages={renderImages}
        />
      </div>
    )
  }
  const source = markdownSource(record)
  const hasImages = record.cell.sourceBlocks?.some(block => block.attachment !== undefined) === true
  const hasToolCalls = record.cell.kind === 'message'
    && record.cell.sourceBlocks?.some(block => block.type === 'tool-call') === true
  if (!source && !hasImages && !hasToolCalls) {
    const emptyLabel = isToolCallOnly(record.cell, t)
      ? t('record.toolCallOnly')
      : record.cell.text || t('record.noContent')
    return <p className={css.noPayload}>{emptyLabel}</p>
  }
  if (!rendered || (!hasImages && !hasToolCalls)) {
    return <MarkdownFragment text={source ?? ''} rendered={rendered} preview={preview} t={t} />
  }
  return (
    <div>
      {source && <MarkdownFragment text={source} rendered preview={preview} t={t} />}
      {record.cell.kind === 'message' && (
        <AssistantToolCalls
          blocks={record.cell.sourceBlocks}
          preview={preview}
          onOpenCall={onOpenCall}
          t={t}
        />
      )}
      <MessageImages blocks={record.cell.sourceBlocks} preview={preview} renderImages={renderImages} />
    </div>
  )
}
