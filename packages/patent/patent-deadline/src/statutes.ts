/**
 * The Chinese patent statutory and designated deadline set.
 *
 * The periods are an external specification (专利法, 专利法实施细则, 专利审查指南),
 * not a deployment preference, so each one lives in code beside its article. What
 * a deployment may vary — how far ahead to warn — is a validated configuration
 * field, not a period.
 *
 * Every entry is either computed from dates the caller supplied or reported as
 * pending together with the exact input still missing. A period that depends on
 * delivery of a notice is never guessed from the filing date: the grant,
 * rejection, and office-action periods start at delivery, so the report names
 * the missing notice instead of substituting a fixed number of years.
 * @module @deepseek-ai/dsh-patent-deadline/statutes
 */

import {
  addCalendarMonths,
  compareCalendarDates,
  daysBetween,
  formatCalendarDate,
  type CalendarDate,
} from './calendar.ts'
import { resolveDeliveryDate, type DeliveryRequest } from './delivery.ts'
import { periodEnd, type Period } from './period.ts'
import { WorkCalendarCoverageError, type WorkCalendar } from './work-calendar.ts'

/** Patent category, which selects the applicable period lengths. */
export type PatentKind = 'invention' | 'utility-model' | 'design'

/**
 * Whether rest-day roll-forward (细则第5条) is applied to the reported end dates.
 *
 * `apply` is the statutory reading and the default. `omit` reports each period's
 * own end date with no roll-forward, for records whose subject is the period
 * itself rather than an act to perform on the last day.
 */
export type RestDayRule = 'apply' | 'omit'

/** A notice issued in the case that starts a designated or statutory period. */
export type NoticeKind =
  | 'office-action-first'
  | 'office-action-subsequent'
  | 'substantive-exam-notice'
  | 'rejection-decision'
  | 'grant-notice'
  | 'reexamination-notice'
  | 'invalidation-transfer'

/**
 * Notice kinds a case may receive more than once, each starting its own period.
 *
 * A case commonly receives several 后续审查意见通知书, and a reexamination may produce
 * more than one 复审通知书; each is a separate starting event, so the report carries one
 * entry per notice. Every other kind is issued once in a case, and a second record is a
 * data error that would silently hide the first — it is rejected instead.
 */
const REPEATABLE_NOTICE_KINDS: ReadonlySet<NoticeKind> = new Set<NoticeKind>([
  'office-action-subsequent',
  'reexamination-notice',
])

/** A notice together with how it was delivered. */
export type NoticeInput = {
  kind: NoticeKind
  delivery: DeliveryRequest
  /** Months the notice itself designates, overriding the usual designated length. */
  designatedMonths?: number
}

/** The late-payment window attached to an annual fee. */
export type LatePaymentWindow = {
  /** Day the fee was due. */
  from: string
  /** Last day of the six-month surcharge window. */
  to: string
  legalBasis: string
  note: string
}

/** Everything the deadline set is computed from. */
export type DeadlineQuery = {
  kind: PatentKind
  /** Application date; for an international application, the international filing date. */
  filingDate: CalendarDate
  /**
   * Whether the case claims priority. Supplied explicitly by the agent or the
   * human handling the case; it is never inferred from the presence of a
   * priority date, because the periods that follow the priority date must not
   * silently change with a half-filled record.
   */
  claimsPriority: boolean
  /** Earliest priority date; required when claimsPriority is true. */
  priorityDate?: CalendarDate
  /** Whether the case is a PCT application entering the Chinese national phase. */
  isPctNationalPhase?: boolean
  /** Grant publication date (授权公告日), which fixes the granted patent year. */
  authorizationPublicationDate?: CalendarDate
  /** Date the drug obtained marketing approval in China (新药上市许可日). */
  marketingApprovalDate?: CalendarDate
  /** Notices of this case whose delivery starts a period. */
  notices?: readonly NoticeInput[]
  /** Whether 细则第5条 roll-forward applies; defaults to `apply`. */
  restDayRule?: RestDayRule
  /** The day the report is produced; supplied by the caller so the report is reproducible. */
  today: CalendarDate
}

/** How close a deadline is, or whether it can be computed at all. */
export type DeadlineStatus = 'overdue' | 'urgent' | 'normal'

/** A deadline whose end date is known. */
export type ComputedDeadline = {
  id: string
  label: string
  legalBasis: string
  /** The period's own end date, before any rest-day roll-forward. */
  rawDueDate: string
  /**
   * The reported end date: the rolled date under `apply`, the raw date under
   * `omit`.
   */
  dueDate: string
  /** Days from `today` to the reported end date; negative once overdue. */
  daysRemaining: number
  status: DeadlineStatus
  /** Whether the rest-day rule moved the reported end date past the raw one. */
  rolledForward: boolean
  /** Set when the loaded holiday arrangement does not cover the end date's year. */
  calendarCaveat?: string
  /** The delivery or trigger rule that produced the start date. */
  triggerBasis?: string
  /** Six-month surcharge window following an annual fee's due date. */
  latePaymentWindow?: LatePaymentWindow
}

/** A deadline that cannot be computed from the supplied inputs. */
export type PendingDeadline = {
  id: string
  label: string
  legalBasis: string
  /** The input whose value is required. */
  requiredInput: string
  reason: string
}

/** The deadline report. */
export type DeadlineReport = {
  computed: ComputedDeadline[]
  pending: PendingDeadline[]
  /** The roll-forward rule the reported end dates were produced under. */
  restDayRule: RestDayRule
}

/** Options the evaluator needs beyond the case inputs. */
export type EvaluateOptions = {
  calendar: WorkCalendar
  /** Warn when an end date falls within this many days; a deployment policy. */
  reminderLeadDays: number
}

/** Thrown when the query contradicts itself, e.g. a priority date without a priority claim. */
export class DeadlineQueryError extends Error {
  /**
   * @param message - what the query contradicts.
   */
  constructor(message: string) {
    super(message)
    this.name = 'DeadlineQueryError'
  }
}

/** A deadline definition: either a computed entry or a statement of what is missing. */
type DeadlineItem = ComputedDeadline | PendingDeadline

/**
 * Prefix of a {@link ComputedDeadline.calendarCaveat} whose rest-day rule could
 * not be applied, followed by the uncovered year. Consumers that render prose
 * name the year; the prefixed token itself is for machine consumers.
 */
export const UNCOVERED_YEAR_CAVEAT_PREFIX = 'calendar-uncovered-year:'

/** Shared fields every entry carries. */
type EntryBase = {
  id: string
  label: string
  legalBasis: string
  query: DeadlineQuery
  options: EvaluateOptions
  triggerBasis?: string
  latePaymentWindow?: LatePaymentWindow
}

/**
 * Evaluate the deadline set for one case.
 * @param query - case dates, notices, and the report date.
 * @param options - work calendar and reminder policy.
 * @returns computed deadlines (chronological) and deadlines still needing inputs.
 * @throws DeadlineQueryError when the priority inputs contradict each other.
 */
export function evaluateDeadlines(query: DeadlineQuery, options: EvaluateOptions): DeadlineReport {
  assertPriorityInputs(query)
  const items: DeadlineItem[] = []
  const notices = indexNotices(query.notices ?? [])

  const filing = query.filingDate
  const priority = query.priorityDate

  // ── 专利法第29条 — the window for a later application on the same subject.
  const priorityMonths = query.kind === 'design' ? 6 : 12
  items.push(fromPeriod({
    base: {
      id: 'priority-window',
      label: `优先权期限（可就相同主题提出后续申请并主张优先权，${String(priorityMonths)}个月自本申请日起算）`,
      legalBasis: query.kind === 'design' ? '专利法第29条第2款' : '专利法第29条第1款',
      query,
      options,
    },
    start: filing,
    period: { unit: 'month', count: priorityMonths },
  }))

  // ── 细则第36条 — priority may be restored within two months of the window closing.
  items.push(fromPeriod({
    base: {
      id: 'priority-restoration',
      label: '请求恢复优先权（有正当理由且在优先权期限届满后2个月内）',
      legalBasis: '专利法实施细则第36条',
      query,
      options,
    },
    start: periodEnd(filing, { unit: 'month', count: priorityMonths }),
    period: { unit: 'month', count: 2 },
  }))

  // ── 细则第37条 — add or correct a priority claim; it presupposes a priority claim.
  if (query.claimsPriority && priority !== undefined) {
    const fromPriority = periodEnd(priority, { unit: 'month', count: 16 })
    const fromFiling = periodEnd(filing, { unit: 'month', count: 4 })
    items.push(fromDate({
      base: {
        id: 'priority-addition-or-correction',
        label: '请求增加或改正优先权要求（自优先权日起16个月与自申请日起4个月，以较晚届满者为准）',
        legalBasis: '专利法实施细则第37条',
        query,
        options,
      },
      due: compareCalendarDates(fromPriority, fromFiling) >= 0 ? fromPriority : fromFiling,
    }))
  }

  // ── 细则第112条 — application fee.
  items.push(fromPeriod({
    base: {
      id: 'application-fee',
      label: '缴纳申请费、公布印刷费及必要的申请附加费（或自收到受理通知书之日起15日内）',
      legalBasis: '专利法实施细则第112条',
      query,
      options,
    },
    start: filing,
    period: { unit: 'month', count: 2 },
  }))

  // ── 专利法第35条 — substantive examination request, counted from the priority date
  // when the case claims priority (the start date the office uses in practice).
  if (query.kind === 'invention') {
    const start = query.claimsPriority && priority !== undefined ? priority : filing
    const startLabel = start === filing ? '申请日' : '优先权日'
    items.push(fromPeriod({
      base: {
        id: 'substantive-exam-request',
        label: `请求实质审查并缴纳审查费（自${startLabel}起3年）`,
        legalBasis: '专利法第35条',
        query,
        options,
      },
      start,
      period: { unit: 'year', count: 3 },
    }))
  }

  // ── 细则第57条 — voluntary amendment windows.
  if (query.kind === 'invention') {
    items.push(...fromNotices({
      id: 'voluntary-amendment-invention',
      label: '主动修改（发明：提出实质审查请求时，或收到进入实质审查阶段通知书之日起3个月内）',
      legalBasis: '专利法实施细则第57条第1款',
      noticeKind: 'substantive-exam-notice',
      absentReason: '需要“进入实质审查阶段通知书”的送达记录，本查询未提供该通知。',
      months: 3,
      notices,
      query,
      options,
    }))
  } else {
    items.push(fromPeriod({
      base: {
        id: 'voluntary-amendment-utility-design',
        label: '主动修改（自申请日起2个月内）',
        legalBasis: '专利法实施细则第57条第2款',
        query,
        options,
      },
      start: filing,
      period: { unit: 'month', count: 2 },
    }))
  }

  // ── 细则第60条第1款 + 第48条 — registration, which also bounds divisional filing.
  // A case is granted once, so duplicates of this kind are rejected in indexNotices;
  // the first record is the only one.
  const grantNotice = notices.get('grant-notice')?.[0]
  if (grantNotice !== undefined) {
    const grant = resolveDeliveryDate(grantNotice.delivery)
    items.push(fromPeriod({
      base: {
        id: 'registration',
        label: '办理登记手续并缴纳授权当年年费、印花税（自收到授权通知之日起2个月）',
        legalBasis: '专利法实施细则第60条第1款、第114条',
        query,
        options,
        triggerBasis: grant.basis,
      },
      start: grant.date,
      period: { unit: 'month', count: 2 },
    }))
    items.push(fromPeriod({
      base: {
        id: 'divisional-application',
        label: '提出分案申请（须在办理登记手续期限届满前）',
        legalBasis: '专利法实施细则第48条、第60条第1款',
        query,
        options,
        triggerBasis: grant.basis,
      },
      start: grant.date,
      period: { unit: 'month', count: 2 },
    }))
  } else {
    items.push(pending({
      id: 'registration',
      label: '办理登记手续并缴纳授权当年年费、印花税',
      legalBasis: '专利法实施细则第60条第1款、第114条',
      requiredInput: 'grant-notice（授权通知的送达记录）',
      reason: '该期限自收到授予专利权通知之日起算；未记录该通知送达日即无法计算，不以申请日起算的固定年数替代。',
    }))
    items.push(pending({
      id: 'divisional-application',
      label: '提出分案申请（须在办理登记手续期限届满前）',
      legalBasis: '专利法实施细则第48条、第60条第1款',
      requiredInput: 'grant-notice（授权通知的送达记录）',
      reason: '分案申请须在办理登记手续期限届满前提出，该期限自收到授权通知之日起算。',
    }))
  }

  // ── 专利法第42条第1款 — patent term, always counted from the filing date.
  const termYears = query.kind === 'invention' ? 20 : query.kind === 'utility-model' ? 10 : 15
  items.push(fromPeriod({
    base: {
      id: 'patent-term',
      label: `专利权期限届满（${String(termYears)}年，自申请日起算）`,
      legalBasis: '专利法第42条第1款',
      query,
      options,
    },
    start: filing,
    period: { unit: 'year', count: termYears },
  }))

  // ── 细则第115条 — annual fees after the granted year.
  items.push(...annualFeeItems(query, options))

  // ── 细则第120条 — PCT national-phase entry.
  if (query.isPctNationalPhase === true) {
    const base = priority ?? filing
    const baseLabel = priority !== undefined ? '优先权日' : '国际申请日（未主张优先权）'
    items.push(fromPeriod({
      base: {
        id: 'pct-national-entry',
        label: `办理进入中国国家阶段手续（自${baseLabel}起30个月内；缴纳宽限费后可延至32个月）`,
        legalBasis: '专利法实施细则第120条',
        query,
        options,
      },
      start: base,
      period: { unit: 'month', count: 30 },
    }))
    items.push(fromPeriod({
      base: {
        id: 'pct-national-entry-grace',
        label: `宽限期内办理进入中国国家阶段手续（自${baseLabel}起32个月内，须缴宽限费）`,
        legalBasis: '专利法实施细则第120条',
        query,
        options,
      },
      start: base,
      period: { unit: 'month', count: 32 },
    }))
  }

  // ── 专利法第41条 — reexamination request.
  items.push(...fromNotices({
    id: 'reexamination-request',
    label: '请求复审（自收到驳回决定之日起3个月）',
    legalBasis: '专利法第41条第1款',
    noticeKind: 'rejection-decision',
    absentReason: '需要驳回决定的送达记录，本查询未提供该通知。',
    months: 3,
    notices,
    query,
    options,
  }))

  // ── Designated periods, which only the notice can start.
  items.push(...fromNotices({
    id: 'oa-response-first',
    label: '答复第一次审查意见通知书（指定期限，实质审查程序中为4个月）',
    legalBasis: '专利审查指南第五部分第七章第2.1节',
    noticeKind: 'office-action-first',
    absentReason: '需要第一次审查意见通知书的送达记录，本查询未提供该通知。',
    months: 4,
    notices,
    query,
    options,
  }))
  items.push(...fromNotices({
    id: 'oa-response-subsequent',
    label: '答复后续审查意见通知书（指定期限一般为2个月，以通知书指定为准）',
    legalBasis: '专利审查指南第五部分第七章第2.1节',
    noticeKind: 'office-action-subsequent',
    absentReason: '需要后续审查意见通知书的送达记录，本查询未提供该通知。',
    months: 2,
    notices,
    query,
    options,
  }))
  items.push(...fromNotices({
    id: 'reexamination-deficiency-response',
    label: '答复复审通知书（指定期限，以通知书指定为准）',
    legalBasis: '专利法实施细则第67条',
    noticeKind: 'reexamination-notice',
    absentReason: '需要复审通知书的送达记录，本查询未提供该通知。',
    months: 2,
    notices,
    query,
    options,
  }))
  items.push(...fromNotices({
    id: 'invalidation-response',
    label: '答复无效宣告请求（合议组指定期限，通常为1个月）',
    legalBasis: '专利审查指南第四部分第三章第4.4节',
    noticeKind: 'invalidation-transfer',
    absentReason: '需要无效宣告请求书转送文件的送达记录，本查询未提供该通知。',
    months: 1,
    notices,
    query,
    options,
  }))

  // ── 细则第77条、第81条 — term-compensation requests.
  if (query.authorizationPublicationDate !== undefined) {
    items.push(fromPeriod({
      base: {
        id: 'term-compensation-request',
        label: '请求专利权期限补偿（发明专利授权过程中的不合理延迟）',
        legalBasis: '专利法第42条第2款、专利法实施细则第77条',
        query,
        options,
      },
      start: query.authorizationPublicationDate,
      period: { unit: 'month', count: 3 },
    }))
  } else {
    items.push(pending({
      id: 'term-compensation-request',
      label: '请求专利权期限补偿（发明专利授权过程中的不合理延迟）',
      legalBasis: '专利法第42条第2款、专利法实施细则第77条',
      requiredInput: 'authorizationPublicationDate（授权公告日）',
      reason: '该请求应自公告授予专利权之日起3个月内提出，未提供授权公告日即无法计算。',
    }))
  }
  if (query.marketingApprovalDate !== undefined) {
    items.push(fromPeriod({
      base: {
        id: 'new-drug-compensation-request',
        label: '请求新药相关发明专利权期限补偿',
        legalBasis: '专利法第42条第3款、专利法实施细则第81条',
        query,
        options,
      },
      start: query.marketingApprovalDate,
      period: { unit: 'month', count: 3 },
    }))
  }

  return assemble(items, query)
}

/**
 * Reject a query whose priority inputs contradict each other. An explicit
 * priority claim with no date, or a date with no claim, would otherwise pick a
 * start date silently.
 * @param query - the case inputs.
 */
function assertPriorityInputs(query: DeadlineQuery): void {
  if (query.claimsPriority && query.priorityDate === undefined) {
    throw new DeadlineQueryError(
      '已声明本案主张优先权（claimsPriority: true），但未提供优先权日（priorityDate）：'
      + '实审请求等期限自优先权日起算，缺该日期无法计算。',
    )
  }
  if (!query.claimsPriority && query.priorityDate !== undefined) {
    throw new DeadlineQueryError(
      '本案声明不主张优先权（claimsPriority: false），却提供了优先权日（priorityDate）：'
      + '两者矛盾，请按案卷事实改其一。',
    )
  }
}

/**
 * Build the annual-fee entries after the granted year, each carrying its
 * six-month surcharge window.
 * @param query - the case inputs.
 * @param options - calendar and reminder policy.
 * @returns the fee entries, or a pending entry when the granted year is unknown.
 */
function annualFeeItems(query: DeadlineQuery, options: EvaluateOptions): DeadlineItem[] {
  const filing = query.filingDate
  const grant = query.authorizationPublicationDate
  if (grant === undefined) {
    return [pending({
      id: 'annual-fee',
      label: '缴纳授予专利权当年以后各年度的年费',
      legalBasis: '专利法实施细则第115条、第114条',
      requiredInput: 'authorizationPublicationDate（授权公告日）',
      reason:
        '费用年度取决于授予专利权当年的专利年度：授权当年年费在办理登记手续时缴纳，'
        + '以后年度年费在上一年度期满前缴纳。未提供授权公告日即无法确定年度序号。',
    })]
  }
  const grantedYear = patentYearOf(filing, grant)
  const items: DeadlineItem[] = []
  const horizon = periodEnd(query.today, { unit: 'year', count: 2 })
  const lastYear = Math.max(grantedYear + 1, patentYearOf(filing, horizon))
  for (let year = grantedYear + 1; year <= lastYear; year++) {
    // 细则第115条: the fee for year N is due before year N-1 ends.
    const due = addCalendarMonths(filing, (year - 1) * 12)
    const windowEnd = periodEnd(due, { unit: 'month', count: 6 })
    items.push(fromDate({
      base: {
        id: `annual-fee-${String(year)}`,
        label: `缴纳第${String(year)}年度年费（授予专利权当年以后的年费应在上一年度期满前缴纳）`,
        legalBasis: '专利法实施细则第115条',
        query,
        options,
        latePaymentWindow: {
          from: formatCalendarDate(due),
          to: formatCalendarDate(windowEnd),
          legalBasis: '专利法实施细则第115条',
          note:
            '未缴或者未缴足的，可在应缴年费期满之日起6个月内补缴，同时缴纳滞纳金'
            + '（每超过规定的缴费时间1个月，加收当年全额年费的5%）；期满未缴纳的，'
            + '专利权自应当缴纳年费期满之日起终止。',
        },
      },
      due,
    }))
  }
  return items
}

/**
 * The patent year containing a date, counted from the filing date.
 * @param filingDate - the filing date that starts year one.
 * @param date - the date to place.
 * @returns the patent year number (1-based).
 */
function patentYearOf(filingDate: CalendarDate, date: CalendarDate): number {
  let year = 1
  // A patent year is at most 366 days; the loop bound also stops a malformed
  // input pair from spinning.
  while (year < 200 && compareCalendarDates(addCalendarMonths(filingDate, year * 12), date) <= 0) {
    year++
  }
  return year
}

/**
 * Build a deadline from a start date plus a period.
 * @param args - the entry base, start date, and period.
 * @returns the computed deadline.
 */
function fromPeriod(args: { base: EntryBase; start: CalendarDate; period: Period }): ComputedDeadline {
  return finish(args.base, periodEnd(args.start, args.period))
}

/**
 * Build a deadline whose end date is already known.
 * @param args - the entry base and end date.
 * @returns the computed deadline.
 */
function fromDate(args: { base: EntryBase; due: CalendarDate }): ComputedDeadline {
  return finish(args.base, args.due)
}

/**
 * Index the supplied notices by kind, keeping every record of a repeatable kind.
 * @param supplied - the notices the caller recorded on the case.
 * @returns the notices per kind, oldest first as supplied.
 * @throws DeadlineQueryError when a kind that a case receives once is supplied twice.
 */
function indexNotices(supplied: readonly NoticeInput[]): ReadonlyMap<NoticeKind, readonly NoticeInput[]> {
  const byKind = new Map<NoticeKind, NoticeInput[]>()
  for (const notice of supplied) {
    const list = byKind.get(notice.kind)
    if (list === undefined) {
      byKind.set(notice.kind, [notice])
      continue
    }
    if (!REPEATABLE_NOTICE_KINDS.has(notice.kind)) {
      throw new DeadlineQueryError(
        `通知书记录重复：${notice.kind} 在一个案子里只有一份，收到两份记录时无法确定以哪一份为准。`
        + '请核对通知书，或把多份记录合并为实际送达情形后的那一份。',
      )
    }
    list.push(notice)
  }
  return byKind
}

/**
 * Build a deadline that starts at a notice's delivery date, or a pending entry
 * naming that notice when the case has not recorded it.
 *
 * A repeatable kind yields one entry per recorded notice: its id is the base id
 * for the first record and carries the record's ordinal (`<id>-2`, `<id>-3`) for
 * the rest, so every period a case actually runs has its own row.
 * @param args - the entry definition.
 * @returns the computed deadlines, or the single pending entry.
 */
function fromNotices(args: {
  id: string
  label: string
  legalBasis: string
  noticeKind: NoticeKind
  absentReason: string
  months: number
  notices: ReadonlyMap<NoticeKind, readonly NoticeInput[]>
  query: DeadlineQuery
  options: EvaluateOptions
}): DeadlineItem[] {
  const recorded = args.notices.get(args.noticeKind) ?? []
  if (recorded.length === 0) {
    return [pending({
      id: args.id,
      label: args.label,
      legalBasis: args.legalBasis,
      requiredInput: `${args.noticeKind}（通知的送达记录）`,
      reason: args.absentReason,
    })]
  }
  return recorded.map((notice, index) => {
    const id = index === 0 ? args.id : `${args.id}-${String(index + 1)}`
    const resolved = resolveDeliveryDate(notice.delivery)
    const designated = notice.designatedMonths !== undefined
      ? `；通知书指定期限 ${String(notice.designatedMonths)} 个月`
      : ''
    return fromPeriod({
      base: {
        id,
        label: recorded.length === 1
          ? args.label
          : `${args.label}（第 ${String(index + 1)} 份通知）`,
        legalBasis: args.legalBasis,
        query: args.query,
        options: args.options,
        triggerBasis: `${resolved.basis}${designated}`,
      },
      start: resolved.date,
      period: { unit: 'month', count: notice.designatedMonths ?? args.months },
    })
  })
}

/**
 * Report one computed entry: keep the period's own end date, apply the rest-day
 * rule when the query asks for it, and derive the status from the reported date.
 * @param base - the entry's identity, legal basis, trigger basis, and query inputs.
 * @param due - the period's own end date.
 * @returns the computed deadline.
 */
function finish(base: EntryBase, due: CalendarDate): ComputedDeadline {
  const rule = base.query.restDayRule ?? 'apply'
  let dueDate = due
  let rolledForward = false
  let calendarCaveat: string | undefined
  if (rule === 'apply') {
    try {
      const rolled = base.options.calendar.rollForward(due)
      dueDate = rolled.date
      rolledForward = rolled.rolled
    } catch (error) {
      if (!(error instanceof WorkCalendarCoverageError)) throw error
      // The arrangement for that year is not loaded, so the rest-day rule could
      // not be applied. Report the raw end date and say which year is unverified
      // rather than dropping the entry or assuming the day is a working day.
      calendarCaveat = `${UNCOVERED_YEAR_CAVEAT_PREFIX}${String(error.year)}`
    }
  }
  const daysRemaining = daysBetween(base.query.today, dueDate)
  const status: DeadlineStatus = daysRemaining < 0
    ? 'overdue'
    : daysRemaining <= base.options.reminderLeadDays ? 'urgent' : 'normal'
  return {
    id: base.id,
    label: base.label,
    legalBasis: base.legalBasis,
    rawDueDate: formatCalendarDate(due),
    dueDate: formatCalendarDate(dueDate),
    daysRemaining,
    status,
    rolledForward,
    ...(calendarCaveat !== undefined ? { calendarCaveat } : {}),
    ...(base.triggerBasis !== undefined ? { triggerBasis: base.triggerBasis } : {}),
    ...(base.latePaymentWindow !== undefined ? { latePaymentWindow: base.latePaymentWindow } : {}),
  }
}

/**
 * Build a pending entry.
 * @param args - the entry's identity and the input still required.
 * @returns the pending deadline.
 */
function pending(args: PendingDeadline): PendingDeadline {
  return args
}

/**
 * Split entries into computed and pending, sorting computed ones chronologically
 * and pending ones by id.
 * @param items - the built entries.
 * @param query - the case inputs, whose roll-forward rule the report records.
 * @returns the report.
 */
function assemble(items: readonly DeadlineItem[], query: DeadlineQuery): DeadlineReport {
  const computed = items.filter((item): item is ComputedDeadline => 'dueDate' in item)
  const uncomputed = items.filter((item): item is PendingDeadline => !('dueDate' in item))
  computed.sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.id.localeCompare(right.id))
  uncomputed.sort((left, right) => left.id.localeCompare(right.id))
  return { computed, pending: uncomputed, restDayRule: query.restDayRule ?? 'apply' }
}

/**
 * Human label for a patent kind, used in reports.
 * @param kind - the patent category.
 * @returns the Chinese label.
 */
export function describePatentKind(kind: PatentKind): string {
  switch (kind) {
    case 'invention': return '发明专利'
    case 'utility-model': return '实用新型专利'
    case 'design': return '外观设计专利'
  }
}
