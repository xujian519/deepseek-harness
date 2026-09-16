/**
 * The detail-tab vocabulary shared by the ledger entry and its record inspector: the tab lists a
 * record or a session request exposes, and the member tables those lists are built from.
 */

import type { DetailTab, TableRecord } from '../types.ts'
import type { TrajectoryKey } from './locales.ts'
import { codeProgram } from './code-program.ts'
import { isMarkdownRecord } from './trajectory-record-presentation.tsx'

/** One inspector tab and the locale key naming it. */
export interface DetailTabItem {
  id: DetailTab
  labelKey: TrajectoryKey
}

const SYSTEM_PROMPT_TABS: readonly DetailTabItem[] = [
  { id: 'system-prompt', labelKey: 'tab.systemPrompt' },
  { id: 'tools', labelKey: 'tab.tools' },
]

const SYSTEM_UPDATE_TABS: readonly DetailTabItem[] = [
  { id: 'diff', labelKey: 'tab.diff' },
  ...SYSTEM_PROMPT_TABS,
]

const REQUEST_TABS: readonly DetailTabItem[] = [
  { id: 'overview', labelKey: 'tab.summary' },
  { id: 'options', labelKey: 'tab.options' },
  { id: 'usage', labelKey: 'tab.usage' },
  { id: 'timing', labelKey: 'tab.timing' },
]

/**
 * Tabs one record exposes in the inspector, by its kind and the details it carries.
 * @param record - Ledger record the inspector is showing.
 * @returns The ordered tabs for that record.
 */
export function detailTabs(record: TableRecord): readonly DetailTabItem[] {
  if (record.cell.kind === 'system') {
    if (record.cell.promptDetail === undefined && record.cell.systemPromptDetail !== undefined) {
      return SYSTEM_PROMPT_TABS.filter(tab => tab.id === 'system-prompt')
    }
    return record.cell.previousPromptDetail === undefined
      ? SYSTEM_PROMPT_TABS
      : SYSTEM_UPDATE_TABS
  }
  if (record.cell.kind === 'compacted') {
    return [
      { id: 'overview', labelKey: 'tab.summary' },
      { id: 'raw', labelKey: 'tab.rawOutput' },
    ]
  }
  if (isMarkdownRecord(record)) {
    return [
      { id: 'overview', labelKey: 'tab.summary' },
      { id: 'rendered', labelKey: 'tab.preview' },
      { id: 'raw', labelKey: 'tab.raw' },
      ...(record.cell.messageSource === undefined
        ? []
        : [{ id: 'source', labelKey: 'tab.source' } as const]),
    ]
  }
  return [
    { id: 'overview', labelKey: 'tab.summary' },
    ...(record.cell.inputDetail ? [{
      id: 'input', labelKey: codeProgram(record.cell) === undefined ? 'tab.payload' : 'code.source',
    } as const] : []),
    ...(record.cell.outputDetail || codeProgram(record.cell) !== undefined
      ? [{ id: 'output', labelKey: 'tab.result' } as const] : []),
    { id: 'schema', labelKey: 'tab.schema' },
    { id: 'timing', labelKey: 'tab.timing' },
  ]
}

/**
 * Tabs one selected session request exposes.
 * @param hasOptions - Whether the request carried a request configuration.
 * @returns The request tabs, without the options tab when there is nothing to show there.
 */
export function requestDetailTabs(hasOptions: boolean): readonly DetailTabItem[] {
  return REQUEST_TABS.filter(tab => tab.id !== 'options' || hasOptions)
}
