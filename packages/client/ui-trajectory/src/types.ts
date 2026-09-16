/**
 * The package's client-side trajectory vocabulary: the record model shared by the ledger's
 * projection, panel, and payload modules, plus the locale-derived label tables and tab members
 * those modules read.
 */

import type { JsonTreeLabels, MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AssistantRequestConfig } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TrajectoryTranslate } from './client/locales.ts'
import type { TrajectoryCellProps } from './client/trajectory-record.ts'

/**
 * One ledger row: its position in the turn and section, its cell, and the group and
 * turn boundaries the table renders.
 */
export interface TableRecord {
  turn: number | null
  section: number
  group: string
  groupStart: boolean
  turnStart: boolean
  cell: TrajectoryCellProps
  turnEnd: boolean
  collapsedSummary?: string
  collapsedSummaryKind?: 'turn' | 'assistant'
}

/**
 * Inspector tab identifiers, one per panel the record inspector can show.
 */
export type DetailTab =
  | 'system-prompt'
  | 'tools'
  | 'overview'
  | 'rendered'
  | 'raw'
  | 'source'
  | 'input'
  | 'output'
  | 'schema'
  | 'options'
  | 'usage'
  | 'timing'
  | 'diff'

/**
 * Per-record lifecycle state the ledger renders as a status marker.
 */
export type RecordState = 'complete' | 'running' | 'error'

/**
 * The assistant message and tool call a record was opened from, when it has one.
 */
export interface ParentRecords {
  message?: TableRecord
  tool?: TableRecord
}

/**
 * JSON tree labels for the active locale.
 * @param t - Translation function for the trajectory namespace.
 * @returns The label set the JSON tree component requires.
 */
export function jsonTreeLabels(t: TrajectoryTranslate): JsonTreeLabels {
  return {
    copyValue: t('copy.value'),
    copyJson: t('copy.json'),
    copyPath: t('copy.path'),
    copyPrettyJson: t('copy.prettyJson'),
    copyCompactJson: t('copy.compactJson'),
    copied: t('copied'),
    copyFailed: t('copy.failed'),
    collapseNode: t('collapse'),
    expandNode: t('expand'),
    copyButtonTitle: action => t('copy.optionsHint', { action }),
  }
}

/**
 * Markdown rendering labels for the active locale.
 * @param t - Translation function for the trajectory namespace.
 * @returns The label set the Markdown component requires.
 */
export function markdownLabels(t: TrajectoryTranslate): MarkdownLabels {
  return {
    code: { copyLabel: t('copy'), copiedLabel: t('copied') },
    footnotes: t('markdown.footnotes'),
  }
}

/** Request-inspector fields shared by ordinary generation and compaction. */
interface TrajectoryRequestNumberBase {
  group: string
  number: number
  status?: 'complete' | 'running' | 'error'
  startedAt?: number
  completedAt?: number | null
  error?: string
  errorCode?: string
  retry?: number
  maxRetries?: number
  retryDelayMs?: number
  resultSeq?: number
  provider?: string
  model?: string
  requestConfig?: AssistantRequestConfig
  usage?: TrajectoryUsage
  cumulativeUsage?: TrajectoryUsage
}

/** One purpose-discriminated request identity paired with its session-global number. */
export type TrajectoryRequestNumber = TrajectoryRequestNumberBase & (
  | {
    purpose?: 'assistant'
    /** Request anchor event sequence; absent for the currently streaming request. */
    seq?: number
    turn: number
    step: number
  }
  | {
    purpose: 'compaction'
    /** Request anchor event sequence and stable compaction identity. */
    seq: number
    turn: number | null
    step: 0
  }
)

/** Disjoint provider token buckets for one request or a session prefix. */
export interface TrajectoryUsage {
  input?: number
  cacheRead?: number
  cacheWrite?: number
  output?: number
  reasoning?: number
}
