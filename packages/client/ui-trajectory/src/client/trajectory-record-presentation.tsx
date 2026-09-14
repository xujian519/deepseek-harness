/**
 * Text projection of one record: its source and parent links, its detail tabs, and the display and
 * result text the ledger lists and the Markdown renderer reuse.
 */

import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { JsonTree } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TrajectoryCellKind, TrajectoryCellProps } from './trajectory-record.ts'
import { trajectoryPreviewText } from './trajectory-preview.ts'
import type { TrajectoryTranslate } from './locales.ts'
import css from './TrajectoryTable.module.css'
import type { ParentRecords, TableRecord } from '../types.ts'
import { jsonTreeLabels } from '../types.ts'

interface ToolCallTextParts {
  name: string
  args?: string
}

export function messageSourceLabel(source: unknown, t: TrajectoryTranslate): string {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    return t('source.unknown')
  }
  const properties = source as Record<string, unknown>
  const kind = properties.kind
  if (kind === 'user') return t('source.user')
  if (kind === 'plugin') {
    const plugin = properties.plugin
    return typeof plugin === 'string' && plugin !== ''
      ? t('source.pluginNamed', { plugin })
      : t('source.plugin')
  }
  if (kind === 'goal') {
    const round = properties.round
    return typeof round === 'number' && round > 0
      ? t('source.goalRound', { round })
      : t('source.goal')
  }
  if (typeof kind !== 'string' || kind === '') return t('source.unknown')
  return `${kind[0]?.toUpperCase() ?? ''}${kind.slice(1)}`
}

export function MessageSource({ record, t }: { record: TableRecord; t: TrajectoryTranslate }) {
  const source = record.cell.messageSource
  if (source === undefined) return <p className={css.noPayload}>{t('source.notRecorded')}</p>
  const data = typeof source === 'object' && source !== null
    ? source
    : { value: source }
  return (
    <JsonTree
      data={data}
      label={t('source.messageJson')}
      labels={jsonTreeLabels(t)}
      className={css.jsonPayload}
    />
  )
}

export function isMarkdownRecord(record: TableRecord): boolean {
  return record.cell.kind === 'user'
    || record.cell.kind === 'context'
    || record.cell.kind === 'message'
}

export function parentRecords(
  records: readonly TableRecord[],
  record: TableRecord,
): ParentRecords {
  if (record.cell.kind !== 'tool' && record.cell.kind !== 'subtool') return {}
  const at = records.findIndex(candidate => candidate.cell.index === record.cell.index)
  if (at === -1) return {}
  let tool: TableRecord | undefined
  if (record.cell.kind === 'subtool') {
    for (let i = at - 1; i >= 0; i--) {
      const candidate = records[i]
      if (
        candidate === undefined
        || candidate.turn !== record.turn
        || candidate.group !== record.group
      ) break
      if (candidate.cell.kind === 'tool') {
        tool = candidate
        break
      }
    }
  }
  const parentCallId = tool?.cell.callId ?? record.cell.callId
  let message: TableRecord | undefined
  if (parentCallId !== undefined) {
    message = records.find(candidate =>
      candidate.turn === record.turn
      && candidate.cell.kind === 'message'
      && candidate.cell.sourceBlocks?.some(block => block.callId === parentCallId) === true,
    )
  }
  return { ...(message === undefined ? {} : { message }), ...(tool === undefined ? {} : { tool }) }
}

export function markdownSource(record: TableRecord): string | undefined {
  if (record.cell.kind === 'user' || record.cell.kind === 'context') {
    return record.cell.inputDetail
  }
  if (record.cell.kind === 'message' || record.cell.kind === 'compacted') {
    return record.cell.outputDetail
  }
  return undefined
}

function recordDisplayText(cell: TrajectoryCellProps, t: TrajectoryTranslate): string {
  if (isToolCallOnly(cell, t)) return ''
  if (cell.previewMarkdown !== undefined) {
    const preview = trajectoryPreviewText(cell.previewMarkdown)
    if (cell.text === '') return preview
    return preview === '' ? cell.text : `${cell.text} · ${preview}`
  }
  if (cell.text !== '') return cell.text
  const markdown = cell.kind === 'user' || cell.kind === 'context'
    ? cell.inputDetail
    : cell.kind === 'message'
      ? cell.outputDetail ?? cell.thinkingDetail
      : undefined
  return markdown === undefined ? '' : trajectoryPreviewText(markdown)
}

function recordResultText(cell: TrajectoryCellProps): string | undefined {
  return cell.resultPreviewMarkdown === undefined
    ? cell.result
    : trajectoryPreviewText(cell.resultPreviewMarkdown)
}

function toolCallTextParts(
  kind: TrajectoryCellKind,
  text: string,
): ToolCallTextParts | undefined {
  if (kind !== 'tool' && kind !== 'subtool') return undefined
  const separator = text.indexOf(' · ')
  if (separator === -1) return { name: text }
  return {
    name: text.slice(0, separator),
    args: text.slice(separator + 3),
  }
}

export function isToolCallOnly(cell: TrajectoryCellProps, t: TrajectoryTranslate): boolean {
  return cell.kind === 'message'
    && !cell.outputDetail
    && !cell.thinkingDetail
    && cell.text === t('layout.toolCallOnly')
}

interface RecordPresentationValue {
  displayText: string
  listDisplayText: string
  resultText: string | undefined
  toolCallOnly: boolean
  toolCallText: ToolCallTextParts | undefined
}

export function RecordPresentation({
  cell,
  children,
  t,
}: {
  cell: TrajectoryCellProps
  children: (value: RecordPresentationValue) => ReactNode
  t: TrajectoryTranslate
}) {
  const displayText = useMemo(
    () => recordDisplayText(cell, t),
    [
      cell.kind, cell.text, cell.previewMarkdown,
      cell.inputDetail, cell.outputDetail, cell.thinkingDetail, t,
    ],
  )
  const resultText = useMemo(
    () => recordResultText(cell),
    [cell.result, cell.resultPreviewMarkdown],
  )
  const toolCallOnly = isToolCallOnly(cell, t)
  const toolCallText = toolCallTextParts(cell.kind, displayText)
  const listDisplayText = toolCallOnly
    ? t('record.toolCallOnly')
    : toolCallText === undefined
      ? displayText
      : [toolCallText.name, toolCallText.args].filter(Boolean).join(' ')
  return children({
    displayText,
    listDisplayText,
    resultText,
    toolCallOnly,
    toolCallText,
  })
}

export function RecordListText({
  displayText,
  toolCallOnly,
  toolCallText,
  t,
}: Pick<RecordPresentationValue, 'displayText' | 'toolCallOnly' | 'toolCallText'> & {
  t: TrajectoryTranslate
}) {
  if (toolCallOnly) {
    return <span className={css.toolCallOnly}>{t('record.toolCallOnly')}</span>
  }
  if (toolCallText === undefined) return displayText || '—'
  return (
    <>
      <span className={css.toolCallNameTypeface}>
        {toolCallText.name || '—'}
      </span>
      {toolCallText.args !== undefined && (
        <span className={css.toolCallPayload}>
          {toolCallText.args}
        </span>
      )}
    </>
  )
}
