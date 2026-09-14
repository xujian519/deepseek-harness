/**
 * Projection of grouped trajectory turns into ledger records: flattening, request indexing,
 * folding, and the per-record state readers the ledger and its panels share.
 */

import type { TrajectoryTurnModel } from './layout.ts'
import { trajectoryRecordId } from './trajectory-record.ts'
import { COMPACTION_INTERRUPTED_ERROR } from './copy-codes.ts'
import type { TrajectoryTranslate } from './locales.ts'
import type { RecordState, TableRecord, TrajectoryRequestNumber } from '../types.ts'

/**
 * Flatten grouped turns into one ledger record per cell, marking each record's group and
 * turn boundaries and closing every section with a turnEnd record.
 * @param turns - Turn models in render order.
 * @returns Ledger records in render order.
 */
export function flattenRecords(turns: readonly TrajectoryTurnModel[]): TableRecord[] {
  return turns.flatMap((turn, section) => {
    let firstInSection = true
    const records = turn.groups.flatMap((group) => {
      return group.cells.map((cell, index) => {
        const turnStart = firstInSection
          && cell.requestOnly !== true
          && cell.kind !== 'system'
          && (cell.kind !== 'compacted' || turn.turn === null)
        if (turnStart) firstInSection = false
        return {
          turn: turn.turn,
          section,
          group: group.title,
          groupStart: index === 0,
          turnStart,
          cell,
          turnEnd: false,
        }
      })
    })
    const last = records.at(-1)
    if (last !== undefined) last.turnEnd = true
    return records
  })
}

/**
 * Keep only the records the current search matched and recompute their group, turn,
 * and section boundaries.
 * @param records - Flattened ledger records.
 * @param matches - Cell indexes the current search matched.
 * @returns The matching records with boundary flags recomputed.
 */
export function filterRecords(
  records: readonly TableRecord[],
  matches: ReadonlySet<number>,
): TableRecord[] {
  const filtered = records
    .filter(record =>
      record.cell.requestOnly !== true && matches.has(record.cell.index),
    )
    .map(record => ({ ...record, groupStart: false, turnStart: false, turnEnd: false }))
  const startedSections = new Set<number>()
  for (const [index, record] of filtered.entries()) {
    const previous = filtered[index - 1]
    const next = filtered[index + 1]
    record.groupStart = previous === undefined
      || previous.section !== record.section
      || previous.group !== record.group
    record.turnStart = !startedSections.has(record.section)
      && record.cell.kind !== 'system'
      && (record.cell.kind !== 'compacted' || record.turn === null)
    if (record.turnStart) startedSections.add(record.section)
    record.turnEnd = next === undefined || next.section !== record.section
  }
  return filtered
}

/**
 * Identity of the request group a record belongs to, used to key every request index.
 * @param turn - Turn number, or null for records between turns.
 * @param group - Group title within the turn.
 * @returns The composite group key.
 */
export function requestKey(turn: number | null, group: string): string {
  return `${turn}\u0000${group}`
}

/**
 * Stable identity of one request, discriminated by purpose so an assistant request and a
 * compaction at the same coordinates never collide.
 * @param request - Numbered request.
 * @returns The identity key.
 */
export function requestIdentity(request: TrajectoryRequestNumber): string {
  return request.purpose === 'compaction'
    ? `compaction\u0000${request.seq}`
    : `assistant\u0000${request.turn}\u0000${request.step}`
}

/**
 * Map each request group to the cell index where its request begins.
 * @param records - Flattened ledger records.
 * @param requestGroups - Keys of the groups that carry a request.
 * @returns The first non-user record index per group key; groups without one are absent.
 */
export function indexRequestBoundaries(
  records: readonly TableRecord[],
  requestGroups: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  const boundaries = new Map<string, number>()
  for (const record of records) {
    const key = requestKey(record.turn, record.group)
    if (!requestGroups.has(key)) continue
    if (boundaries.has(key)) continue
    if (record.cell.kind === 'user' || record.cell.kind === 'context') continue
    boundaries.set(key, record.cell.index)
  }
  return boundaries
}

/**
 * Localized section heading for a turn, or for the records between turns.
 * @param turn - Turn number, or null for records between turns.
 * @param t - Translation function for the trajectory namespace.
 * @returns The localized heading.
 */
export function sectionLabel(turn: number | null, t: TrajectoryTranslate): string {
  return turn === null ? t('section.betweenTurns') : t('turn.label', { turn })
}

/**
 * Map each request group to the session-global number the inspector shows for it.
 * @param sessionNumbers - Numbered requests in session order; absent before any exist.
 * @returns The session-global request number per group key.
 */
export function indexRequestNumbers(
  sessionNumbers: readonly TrajectoryRequestNumber[] | undefined,
): ReadonlyMap<string, number> {
  const numbers = new Map<string, number>()
  for (const request of sessionNumbers ?? []) {
    numbers.set(requestKey(request.turn, request.group), request.number)
  }
  return numbers
}

/**
 * Map each record that starts a request group to the number of request-only records the
 * group folded away ahead of it.
 * @param records - Flattened ledger records.
 * @param requestGroups - Keys of the groups that carry a request.
 * @returns The folded request-only count per group-start cell index.
 */
export function indexRequestBoundaryRuns(
  records: readonly TableRecord[],
  requestGroups: ReadonlySet<string>,
): ReadonlyMap<number, number> {
  const indexes = new Map<number, number>()
  let runLength = 0
  for (const record of records) {
    if (record.cell.requestOnly === true) {
      indexes.set(record.cell.index, runLength++)
      continue
    }
    if (
      runLength > 0
      && record.groupStart
      && requestGroups.has(requestKey(record.turn, record.group))
    ) {
      indexes.set(record.cell.index, runLength)
    }
    runLength = 0
  }
  return indexes
}

function summarizeTurn(
  records: readonly TableRecord[],
  requestGroups: ReadonlySet<string>,
  t: TrajectoryTranslate,
): string {
  const steps = new Set(
    records
      .map(record => requestKey(record.turn, record.group))
      .filter(key => requestGroups.has(key)),
  ).size
  const toolCalls = records.filter(record =>
    record.cell.kind === 'tool' || record.cell.kind === 'subtool',
  ).length
  return [
    t(steps === 1 ? 'summary.steps.one' : 'summary.steps.other', { count: steps }),
    t(toolCalls === 1 ? 'summary.toolCalls.one' : 'summary.toolCalls.other', {
      count: toolCalls,
    }),
  ].join(' · ')
}

/**
 * Replace the content of each collapsed turn with a single summary record.
 * @param records - Flattened ledger records.
 * @param collapsedTurns - Turns the user collapsed.
 * @param requestGroups - Keys of the groups that carry a request.
 * @param t - Translation function for the trajectory namespace.
 * @returns Records with every collapsed turn folded into one summary row.
 */
export function collapseTurnRecords(
  records: readonly TableRecord[],
  collapsedTurns: ReadonlySet<number>,
  requestGroups: ReadonlySet<string>,
  t: TrajectoryTranslate,
): TableRecord[] {
  const recordsByTurn = new Map<number, TableRecord[]>()
  for (const record of records) {
    if (record.turn === null) continue
    const turnRecords = recordsByTurn.get(record.turn) ?? []
    turnRecords.push(record)
    recordsByTurn.set(record.turn, turnRecords)
  }
  return records.flatMap((record) => {
    if (record.turn === null || !collapsedTurns.has(record.turn)) return [record]
    const turnRecords = recordsByTurn.get(record.turn) ?? [record]
    if (record.cell.requestOnly === true || record.cell.kind === 'system') return [record]
    const contentRecords = turnRecords.filter(candidate =>
      candidate.cell.requestOnly !== true && candidate.cell.kind !== 'system')
    if (contentRecords.length <= 1) return [record]
    if (record.cell.index !== contentRecords[0]?.cell.index) return []
    return [
      { ...record, turnEnd: false },
      {
        ...record,
        groupStart: false,
        turnStart: false,
        turnEnd: true,
        collapsedSummary: summarizeTurn(contentRecords.slice(1), requestGroups, t),
        collapsedSummaryKind: 'turn',
      },
    ]
  })
}

/**
 * The tool and subtool records that immediately follow one assistant message.
 * @param records - Flattened ledger records.
 * @param assistantIndex - Cell index of the assistant message.
 * @returns The following tool records; empty when the index is not an assistant message.
 */
export function assistantToolCalls(
  records: readonly TableRecord[],
  assistantIndex: number,
): readonly TableRecord[] {
  const at = records.findIndex(record => record.cell.index === assistantIndex)
  if (at === -1 || records[at]?.cell.kind !== 'message') return []
  const calls: TableRecord[] = []
  for (let i = at + 1; i < records.length; i++) {
    const record = records[i]
    if (record === undefined) break
    if (record.cell.kind !== 'tool' && record.cell.kind !== 'subtool') break
    calls.push(record)
  }
  return calls
}

function summarizeAssistantTools(
  records: readonly TableRecord[],
  t: TrajectoryTranslate,
): string {
  const names = [...new Set(records.map((record) => {
    const separator = record.cell.text.indexOf(' · ')
    return separator === -1 ? record.cell.text : record.cell.text.slice(0, separator)
  }).filter(name => name !== ''))]
  const count = records.length
  const summary = t(count === 1 ? 'summary.toolCalls.one' : 'summary.toolCalls.other', { count })
  return names.length > 0 ? `${summary} · ${names.join(', ')}` : summary
}

/**
 * Replace the tool calls after each collapsed assistant message with a single summary record.
 * @param records - Flattened ledger records.
 * @param collapsedAssistants - Record ids the user collapsed.
 * @param t - Translation function for the trajectory namespace.
 * @returns Records with every collapsed tool call run folded into one summary row.
 */
export function collapseAssistantRecords(
  records: readonly TableRecord[],
  collapsedAssistants: ReadonlySet<string>,
  t: TrajectoryTranslate,
): TableRecord[] {
  const out: TableRecord[] = []
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (record === undefined) continue
    out.push(record)
    if (
      record.cell.kind !== 'message'
      || !collapsedAssistants.has(trajectoryRecordId(record.cell))
    ) continue
    const calls: TableRecord[] = []
    for (let j = i + 1; j < records.length; j++) {
      const candidate = records[j]
      if (
        candidate === undefined
        || candidate.collapsedSummary !== undefined
        || (candidate.cell.kind !== 'tool' && candidate.cell.kind !== 'subtool')
      ) break
      calls.push(candidate)
    }
    if (calls.length === 0) continue
    const last = calls.at(-1)
    out[out.length - 1] = { ...record, turnEnd: false }
    out.push({
      ...record,
      groupStart: false,
      turnStart: false,
      turnEnd: last?.turnEnd ?? false,
      collapsedSummary: summarizeAssistantTools(calls, t),
      collapsedSummaryKind: 'assistant',
    })
    i += calls.length
  }
  return out
}

/**
 * Lifecycle state of one record: error when its cell failed, running while its output is
 * still open, complete otherwise.
 * @param record - Ledger record.
 * @returns The record's state.
 */
export function stateOf(record: TableRecord): RecordState {
  if (record.cell.isError) return 'error'
  if (record.cell.kind === 'compacted' && record.cell.timeSeconds === null) return 'running'
  if (
    (record.cell.kind === 'tool' || record.cell.kind === 'subtool')
    && record.cell.outputDetail === undefined
  ) return 'running'
  return 'complete'
}

/**
 * Localized status label for a record state.
 * @param state - Record state.
 * @param t - Translation function for the trajectory namespace.
 * @returns The localized label.
 */
export function statusLabel(state: RecordState, t: TrajectoryTranslate): string {
  if (state === 'error') return t('status.failed')
  if (state === 'running') return t('status.pending')
  return t('status.completed')
}

/**
 * Failure text to display for a request. The auth hint and the compaction-interrupted
 * marker are localized; any other message passes through as the provider sent it.
 * @param request - Request fields carrying the error.
 * @param t - Translation function for the trajectory namespace.
 * @returns The message to display, or undefined when the request did not fail.
 */
export function requestErrorMessage(
  request: Pick<TrajectoryRequestNumber, 'error' | 'errorCode'>,
  t: TrajectoryTranslate,
): string | undefined {
  if (request.errorCode === 'AUTH') return t('details.failure.auth')
  if (request.error === COMPACTION_INTERRUPTED_ERROR) return t('layout.compactionInterrupted')
  return request.error
}
