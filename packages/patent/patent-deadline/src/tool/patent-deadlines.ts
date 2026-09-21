/**
 * `patent_deadlines` tool: the statutory deadline set of a Chinese patent case.
 *
 * The current day comes from the injected clock rather than the tool input: a
 * model-chosen "today" would let a deadline report be produced against an
 * invented date, and every "urgent"/"overdue" verdict depends on it.
 * @module @deepseek-ai/dsh-patent-deadline/tool/patent-deadlines
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { formatCalendarDate, parseCalendarDate, type CalendarDate } from '../calendar.ts'
import type { DeliveryMode, DeliveryRequest } from '../delivery.ts'
import { renderDeadlineReport } from '../report.ts'
import {
  DeadlineQueryError,
  describePatentKind,
  evaluateDeadlines,
  type DeadlineQuery,
  type DeadlineReport,
  type NoticeInput,
  type NoticeKind,
  type PatentKind,
  type RestDayRule,
} from '../statutes.ts'
import type { WorkCalendar } from '../work-calendar.ts'

/** Thrown when the tool input cannot be turned into a deadline query. */
export class DeadlineToolError extends Error {
  /** Stable error code for the model and logs. */
  readonly code: string

  /**
   * @param code - stable error code.
   * @param message - what is wrong with the input.
   */
  constructor(code: string, message: string) {
    super(message)
    this.name = 'DeadlineToolError'
    this.code = code
  }
}

/** One notice as the model supplies it. */
export type PatentDeadlinesNoticeInput = {
  kind: NoticeKind
  /** Delivery mode; omitted means electronic, which the guideline dates at the dispatch date. */
  mode?: DeliveryMode
  dispatchDate?: string
  enteredDate?: string
  actualReceiptDate?: string
  handedOverDate?: string
  publicationDate?: string
  designatedMonths?: number
}

/** Input for the patent_deadlines tool. */
export type PatentDeadlinesInput = {
  patentType: PatentKind
  filingDate: string
  /** Whether the case claims priority; supplied explicitly rather than inferred. */
  claimsPriority: boolean
  priorityDate?: string
  isPctNationalPhase?: boolean
  authorizationPublicationDate?: string
  marketingApprovalDate?: string
  notices?: PatentDeadlinesNoticeInput[]
  /** `apply` (default) rolls an end date off a rest day; `omit` reports the period's own end date. */
  restDayRule?: RestDayRule
}

/** Output of the patent_deadlines tool. */
export type PatentDeadlinesOutput = {
  patentType: PatentKind
  filingDate: string
  claimsPriority: boolean
  priorityDate?: string
  asOf: string
  restDayRule: RestDayRule
  computed: DeadlineReport['computed']
  pending: DeadlineReport['pending']
}

/** Injected collaborators (tests fix the clock and the calendar). */
export type PatentDeadlinesToolOptions = {
  calendar: WorkCalendar
  /** Warn when an end date falls within this many days. */
  reminderLeadDays: number
  /** Current-day source; defaults to the host's local date. */
  now?: () => CalendarDate
}

const DESCRIPTION = [
  '- Computes the Chinese patent statutory and designated deadlines of one case: priority window and its restoration, priority-claim addition/correction, application fee, substantive-examination request, voluntary amendment, registration and divisional filing, patent term, annual fees with the six-month surcharge window, PCT national-phase entry, reexamination, office-action and invalidation responses, and term-compensation requests.',
  '- Counts periods from the delivery date. Under 专利法实施细则第4条 as revised and the 2023 审查指南, electronic delivery is the day the document enters the electronic system, presumed to be the dispatch date, so a designated period runs from the dispatch date with no 15-day extension; postal delivery is the evidenced receipt date or 15 days after dispatch, direct delivery is the hand-over day, and service by announcement is one month after publication.',
  '- Applies 专利法实施细则第5条 by default: the start day is not counted, a month/year period ends on the corresponding day (or the last day of a month that has none), and an end date on a holiday or moved rest day rolls to the next working day. Set restDayRule to "omit" for the un-rolled criterion, which reports each period\'s own end date; both dates are always returned, with rawDueDate holding the un-rolled one.',
  '- Counts the substantive-examination request from the priority date when the case claims priority, and from the filing date otherwise. Whether the case claims priority is an explicit input, not something inferred from a priority date.',
  '- Deadlines that start at a notice\'s delivery (grant, rejection, office-action, reexamination, invalidation) are reported as pending with the exact missing input until that notice\'s delivery date is supplied; they are never approximated from the filing date.',
  '',
  'Usage notes:',
  '  - Dates are YYYY-MM-DD. Supply the notices the case actually received, with how each was delivered.',
  '  - Read-only and offline; makes no network request.',
  '  - Results are decision support, not a filing instruction: verify against the notice and the current 审查指南 before acting.',
].join('\n')

const DATE = { type: 'string', description: 'Date as YYYY-MM-DD' } as const

const COMPUTED_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    label: { type: 'string', required: true },
    legalBasis: { type: 'string', required: true },
    rawDueDate: { type: 'string', required: true },
    dueDate: { type: 'string', required: true },
    daysRemaining: { type: 'number', required: true },
    status: { type: 'string', required: true, enum: ['overdue', 'urgent', 'normal'] },
    rolledForward: { type: 'boolean', required: true },
    calendarCaveat: { type: 'string' },
    triggerBasis: { type: 'string' },
    latePaymentWindow: {
      type: 'object',
      additionalProperties: false,
      properties: {
        from: { type: 'string', required: true },
        to: { type: 'string', required: true },
        legalBasis: { type: 'string', required: true },
        note: { type: 'string', required: true },
      },
    },
  },
} as const

const PENDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    label: { type: 'string', required: true },
    legalBasis: { type: 'string', required: true },
    requiredInput: { type: 'string', required: true },
    reason: { type: 'string', required: true },
  },
} as const

const NOTICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: {
      type: 'string',
      required: true,
      enum: [
        'office-action-first',
        'office-action-subsequent',
        'substantive-exam-notice',
        'rejection-decision',
        'grant-notice',
        'reexamination-notice',
        'invalidation-transfer',
      ],
      description: 'Which document was delivered',
    },
    mode: {
      type: 'string',
      enum: ['electronic', 'postal', 'personal', 'publication'],
      description: 'How it was delivered; omitted means electronic (dispatch date is the delivery date)',
    },
    dispatchDate: { ...DATE, description: 'Dispatch date on the notice (electronic/postal)' },
    enteredDate: { ...DATE, description: 'Day it entered the electronic system, when evidenced later than dispatch' },
    actualReceiptDate: { ...DATE, description: 'Actual receipt date, when evidenced' },
    handedOverDate: { ...DATE, description: 'Hand-over date for direct delivery' },
    publicationDate: { ...DATE, description: 'Announcement date for service by publication' },
    designatedMonths: { type: 'number', description: 'Months the notice itself designates' },
  },
} as const

/**
 * Build the `patent_deadlines` tool.
 * @param options - work calendar, reminder policy, and clock injection.
 * @returns a registry-ready tool definition.
 */
export function createPatentDeadlinesTool(options: PatentDeadlinesToolOptions): ToolDefinition {
  const now = options.now ?? localToday
  return defineTool({
    name: 'patent_deadlines',
    description: DESCRIPTION,
    parameters: {
      patentType: {
        type: 'string',
        required: true,
        enum: ['invention', 'utility-model', 'design'],
        description: 'Patent category',
      },
      filingDate: { ...DATE, required: true, description: 'Application date (international filing date for a PCT case)' },
      claimsPriority: {
        type: 'boolean',
        required: true,
        description: 'Whether the case claims priority, as stated by the agent or the human handling the case',
      },
      priorityDate: { ...DATE, description: 'Earliest priority date; required when claimsPriority is true' },
      isPctNationalPhase: { type: 'boolean', description: 'Whether the case is a PCT application entering the Chinese national phase' },
      authorizationPublicationDate: { ...DATE, description: 'Grant publication date (授权公告日)' },
      marketingApprovalDate: { ...DATE, description: 'Date the drug obtained marketing approval in China' },
      notices: { type: 'array', items: NOTICE_SCHEMA, description: 'Notices received, with their delivery' },
      restDayRule: {
        type: 'string',
        enum: ['apply', 'omit'],
        description: 'apply (default) rolls an end date off a rest day; omit reports the period\'s own end date',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          patentType: { type: 'string', required: true, enum: ['invention', 'utility-model', 'design'] },
          filingDate: { type: 'string', required: true },
          claimsPriority: { type: 'boolean', required: true },
          priorityDate: { type: 'string' },
          asOf: { type: 'string', required: true },
          restDayRule: { type: 'string', required: true, enum: ['apply', 'omit'] },
          computed: { type: 'array', required: true, items: COMPUTED_SCHEMA },
          pending: { type: 'array', required: true, items: PENDING_SCHEMA },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderDeadlineReport(
          { computed: value.computed, pending: value.pending, restDayRule: value.restDayRule },
          {
            kind: value.patentType,
            filingDate: value.filingDate,
            today: value.asOf,
            claimsPriority: value.claimsPriority,
            ...(value.priorityDate !== undefined ? { priorityDate: value.priorityDate } : {}),
          },
        ),
      }],
    },
    execute(args) {
      const asOf = now()
      const query = toQuery(args, asOf)
      const report = evaluateDeadlines(query, {
        calendar: options.calendar,
        reminderLeadDays: options.reminderLeadDays,
      })
      // The deadline set is pure date arithmetic, so the result is already settled.
      return Promise.resolve({
        patentType: query.kind,
        filingDate: formatCalendarDate(query.filingDate),
        claimsPriority: query.claimsPriority,
        ...(query.priorityDate !== undefined ? { priorityDate: formatCalendarDate(query.priorityDate) } : {}),
        asOf: formatCalendarDate(asOf),
        restDayRule: report.restDayRule,
        computed: report.computed,
        pending: report.pending,
      })
    },
  })
}

/**
 * Turn validated tool arguments into a deadline query.
 * @param args - the tool arguments.
 * @param today - the current day from the injected clock.
 * @returns the query.
 * @throws DeadlineToolError when the priority inputs contradict each other.
 */
function toQuery(args: PatentDeadlinesInput, today: CalendarDate): DeadlineQuery {
  try {
    return {
      kind: args.patentType,
      filingDate: parseDate(args.filingDate, 'filingDate'),
      claimsPriority: args.claimsPriority,
      today,
      ...(args.priorityDate !== undefined ? { priorityDate: parseDate(args.priorityDate, 'priorityDate') } : {}),
      ...(args.isPctNationalPhase !== undefined ? { isPctNationalPhase: args.isPctNationalPhase } : {}),
      ...(args.authorizationPublicationDate !== undefined
        ? { authorizationPublicationDate: parseDate(args.authorizationPublicationDate, 'authorizationPublicationDate') }
        : {}),
      ...(args.marketingApprovalDate !== undefined
        ? { marketingApprovalDate: parseDate(args.marketingApprovalDate, 'marketingApprovalDate') }
        : {}),
      ...(args.notices !== undefined ? { notices: args.notices.map(toNotice) } : {}),
      ...(args.restDayRule !== undefined ? { restDayRule: args.restDayRule } : {}),
    }
  } catch (error) {
    if (error instanceof DeadlineToolError) throw error
    if (error instanceof DeadlineQueryError) throw new DeadlineToolError('contradictory_priority_inputs', error.message)
    throw error
  }
}

/**
 * Convert one notice argument; the date its delivery mode needs is checked when
 * the delivery date is resolved.
 * @param notice - the notice argument.
 * @returns the notice input.
 */
function toNotice(notice: PatentDeadlinesNoticeInput): NoticeInput {
  const delivery: DeliveryRequest = {
    ...(notice.mode !== undefined ? { mode: notice.mode } : {}),
    ...(notice.dispatchDate !== undefined ? { dispatchDate: parseDate(notice.dispatchDate, `${notice.kind}.dispatchDate`) } : {}),
    ...(notice.enteredDate !== undefined ? { enteredDate: parseDate(notice.enteredDate, `${notice.kind}.enteredDate`) } : {}),
    ...(notice.actualReceiptDate !== undefined
      ? { actualReceiptDate: parseDate(notice.actualReceiptDate, `${notice.kind}.actualReceiptDate`) }
      : {}),
    ...(notice.handedOverDate !== undefined
      ? { handedOverDate: parseDate(notice.handedOverDate, `${notice.kind}.handedOverDate`) }
      : {}),
    ...(notice.publicationDate !== undefined
      ? { publicationDate: parseDate(notice.publicationDate, `${notice.kind}.publicationDate`) }
      : {}),
  }
  return {
    kind: notice.kind,
    delivery,
    ...(notice.designatedMonths !== undefined ? { designatedMonths: notice.designatedMonths } : {}),
  }
}

/**
 * Parse a required date argument, attributing a bad value to its field.
 * @param value - the date string.
 * @param field - field name for the error message.
 * @returns the parsed date.
 */
function parseDate(value: string, field: string): CalendarDate {
  try {
    return parseCalendarDate(value)
  } catch (error) {
    throw new DeadlineToolError('invalid_date', `${field}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * The host's local calendar day.
 * @returns today's date in local time.
 */
function localToday(): CalendarDate {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }
}

/** Patent-kind label for reports, re-exported for consumers. */
export { describePatentKind }
