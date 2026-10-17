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
 * Day the 2020 amendment to 专利法 took effect. A design filed before this day
 * keeps the 10-year term of the earlier 专利法第42条; one filed on or after it
 * has the 15-year term. The filing date, not the grant date, selects the term.
 */
const DESIGN_TERM_TRANSITION = { year: 2021, month: 6, day: 1 } as const

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
  /**
   * Granted patent-term compensation in whole years (发明专利，0–5). Extends both
   * the term and the annual-fee years; a patent still awaiting a decision omits it.
   */
  termCompensationYears?: number
  /** Date the invalidation request was filed (提出无效宣告请求之日). */
  invalidationRequestDate?: CalendarDate
  /**
   * Last patent year whose annual fee is recorded as paid. Fees up to and
   * including this year are not reported; omitting it reports every fee in the
   * horizon, including historical ones.
   */
  paidThroughYear?: number
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

/** Default years of future annual fees a report covers when no policy overrides it. */
export const DEFAULT_ANNUITY_HORIZON_YEARS = 2

/** Options the evaluator needs beyond the case inputs. */
export type EvaluateOptions = {
  calendar: WorkCalendar
  /** Warn when an end date falls within this many days; a deployment policy. */
  reminderLeadDays: number
  /**
   * Years of future annual fees to report, counted from `today`; a deployment
   * policy. Defaults to two so the report shows the next charge and the one after.
   */
  annuityHorizonYears?: number
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
 * @throws DeadlineQueryError when the inputs contradict each other or do not apply to the kind.
 */
export function evaluateDeadlines(query: DeadlineQuery, options: EvaluateOptions): DeadlineReport {
  assertQuery(query)
  const notices = indexNotices(query.notices ?? [])
  const items: DeadlineItem[] = [
    ...priorityItems(query, options),
    ...applicationFeeItems(query, options),
    ...substantiveExamRequestItems(query, options),
    ...voluntaryAmendmentItems(notices, query, options),
    ...registrationItems(notices, query, options),
    ...patentTermItems(query, options),
    ...annualFeeItems(query, options),
    ...pctNationalEntryItems(query, options),
    ...invalidationRequestItems(query, options),
    ...noticeDrivenItems(notices, query, options),
    ...termCompensationItems(query, options),
  ]
  return assemble(items, query)
}

/**
 * Reject a query whose inputs contradict themselves: priority inputs, dates out
 * of order, or a field that does not apply to the patent category. Each would
 * otherwise produce a period counted from the wrong date or for the wrong kind.
 * @param query - the case inputs.
 */
function assertQuery(query: DeadlineQuery): void {
  assertPriorityInputs(query)
  if (query.authorizationPublicationDate !== undefined
    && compareCalendarDates(query.authorizationPublicationDate, query.filingDate) < 0) {
    throw new DeadlineQueryError(
      '授权公告日早于申请日：授权公告不可能发生在申请之前，请核对两项日期。',
    )
  }
  if (query.isPctNationalPhase === true && query.kind === 'design') {
    throw new DeadlineQueryError(
      '外观设计不能通过 PCT 进入中国国家阶段：请将 isPctNationalPhase 设为 false 或更正专利类型。',
    )
  }
  if (query.kind !== 'invention') {
    if (query.marketingApprovalDate !== undefined) {
      throw new DeadlineQueryError(
        '新药相关专利权期限补偿只适用于发明专利：请删除 marketingApprovalDate 或更正专利类型。',
      )
    }
    if ((query.termCompensationYears ?? 0) !== 0) {
      throw new DeadlineQueryError(
        '专利权期限补偿只适用于发明专利：请删除 termCompensationYears 或更正专利类型。',
      )
    }
  }
  if (query.termCompensationYears !== undefined
    && (!Number.isInteger(query.termCompensationYears)
      || query.termCompensationYears < 0 || query.termCompensationYears > 5)) {
    throw new DeadlineQueryError(
      `termCompensationYears 必须是 0 至 5 的整数年: ${String(query.termCompensationYears)}`,
    )
  }
  if (query.paidThroughYear !== undefined) {
    if (!Number.isInteger(query.paidThroughYear) || query.paidThroughYear < 0) {
      throw new DeadlineQueryError(
        `paidThroughYear 必须是 0 或正整数专利年度: ${String(query.paidThroughYear)}`,
      )
    }
    const cap = termYearCap(query)
    if (query.paidThroughYear > cap) {
      const hint = query.kind === 'invention'
        ? '如已获期限补偿，请同时提供 termCompensationYears。'
        : ''
      throw new DeadlineQueryError(
        `paidThroughYear 超出专利权期限（${String(cap)} 年）: ${String(query.paidThroughYear)}。${hint}`,
      )
    }
  }
}

/**
 * Reject priority inputs that contradict each other or run out of order: a
 * claim with no date, a date with no claim, or a priority date after the filing
 * date. Each would otherwise pick a start date silently.
 * @param query - the case inputs.
 */
function assertPriorityInputs(query: DeadlineQuery): void {
  if (query.priorityDate !== undefined
    && compareCalendarDates(query.priorityDate, query.filingDate) > 0) {
    throw new DeadlineQueryError(
      '优先权日晚于申请日：优先权日必须在申请日之前，请核对两项日期。',
    )
  }
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
 * Build the priority family: the window for a later application on the same
 * subject, the restoration request that follows it, and — when the case claims
 * priority — the request to add or correct the claim.
 * @param query - the case inputs.
 * @param options - calendar and reminder policy.
 * @returns the priority entries.
 */
function priorityItems(query: DeadlineQuery, options: EvaluateOptions): DeadlineItem[] {
  const filing = query.filingDate
  const priority = query.priorityDate
  const items: DeadlineItem[] = []

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

  // ── 细则第36条 — restoration is limited to an invention or utility model.
  if (query.kind !== 'design') {
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
  }

  // ── 细则第37条 — add or correct a priority claim; it presupposes a priority
  // claim and, like restoration, applies only to an invention or utility model.
  if (query.kind !== 'design' && query.claimsPriority && priority !== undefined) {
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

  return items
}

/**
 * Build the application-fee entry, which runs from the filing date.
 * @param query - the case inputs.
 * @param options - calendar and reminder policy.
 * @returns the fee entry.
 */
function applicationFeeItems(query: DeadlineQuery, options: EvaluateOptions): DeadlineItem[] {
  const filing = query.filingDate
  const items: DeadlineItem[] = []

  // ── 细则第112条 — application fee; a priority claim adds its fee to the same payment.
  const priorityFee = query.claimsPriority ? '及优先权要求费' : ''
  items.push(fromPeriod({
    base: {
      id: 'application-fee',
      label: `缴纳申请费、公布印刷费、必要的申请附加费${priorityFee}（或自收到受理通知书之日起15日内）`,
      legalBasis: '专利法实施细则第112条',
      query,
      options,
    },
    start: filing,
    period: { unit: 'month', count: 2 },
  }))

  return items
}

/**
 * Build the substantive-examination request, which only an invention runs and
 * which counts from the priority date when the case claims one.
 * @param query - the case inputs.
 * @param options - calendar and reminder policy.
 * @returns the request entry, or none for a utility model or a design.
 */
function substantiveExamRequestItems(query: DeadlineQuery, options: EvaluateOptions): DeadlineItem[] {
  const filing = query.filingDate
  const priority = query.priorityDate
  const items: DeadlineItem[] = []

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

  return items
}

/**
 * Build the voluntary-amendment window. Both arms of the kind branch stay here:
 * an invention amends at the examination-request notice, a utility model or a
 * design within two months of the filing date.
 * @param notices - the notices recorded on the case, by kind.
 * @param query - the case inputs.
 * @param options - calendar and reminder policy.
 * @returns the amendment entry, or a pending entry when the invention's notice is missing.
 */
function voluntaryAmendmentItems(
  notices: ReadonlyMap<NoticeKind, readonly NoticeInput[]>,
  query: DeadlineQuery,
  options: EvaluateOptions,
): DeadlineItem[] {
  const filing = query.filingDate
  const items: DeadlineItem[] = []

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

  return items
}

/**
 * Build the registration and divisional-filing periods, both of which start at
 * the grant notice's delivery and therefore stay pending until the case records it.
 * @param notices - the notices recorded on the case, by kind.
 * @param query - the case inputs.
 * @param options - calendar and reminder policy.
 * @returns the two entries, computed or pending.
 */
function registrationItems(
  notices: ReadonlyMap<NoticeKind, readonly NoticeInput[]>,
  query: DeadlineQuery,
  options: EvaluateOptions,
): DeadlineItem[] {
  const items: DeadlineItem[] = []

  // ── 细则第60条第1款 + 第48条 — registration, which also bounds divisional filing.
  // A case is granted once, so duplicates of this kind are rejected in indexNotices;
  // the first record is the only one.
  // 细则第114条 puts the granted year's annuity in the registration step; 印花税 is not
  // a fee the current schedule charges.
  const grantNotice = notices.get('grant-notice')?.[0]
  if (grantNotice !== undefined) {
    const grant = resolveDeliveryDate(grantNotice.delivery)
    items.push(fromPeriod({
      base: {
        id: 'registration',
        label: '办理登记手续并缴纳授权当年年费（自收到授权通知之日起2个月）',
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
      label: '办理登记手续并缴纳授权当年年费',
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

  return items
}

/**
 * Build the patent-term expiry, always counted from the filing date.
 * @param query - the case inputs.
 * @param options - calendar and reminder policy.
 * @returns the term entry.
 */
function patentTermItems(query: DeadlineQuery, options: EvaluateOptions): DeadlineItem[] {
  const baseYears = statutoryTermYears(query)
  const compensation = query.termCompensationYears ?? 0
  const label = compensation === 0
    ? `专利权期限届满（${String(baseYears)}年，自申请日起算）`
    : `专利权期限届满（${String(baseYears)}年+期限补偿${String(compensation)}年，自申请日起算）`

  // ── 专利法第42条第1款 — patent term, always counted from the filing date.
  return [fromPeriod({
    base: {
      id: 'patent-term',
      label,
      legalBasis: '专利法第42条第1款',
      query,
      options,
    },
    start: query.filingDate,
    period: { unit: 'year', count: baseYears + compensation },
  })]
}

/**
 * The last patent year of the term, including granted compensation.
 * @param query - the case inputs.
 * @returns the term length in years.
 */
function termYearCap(query: DeadlineQuery): number {
  return statutoryTermYears(query) + (query.termCompensationYears ?? 0)
}

/**
 * The statutory term in years for a case, before any granted compensation: 20
 * for an invention, 10 for a utility model, and 10 or 15 for a design depending
 * on whether it was filed before the 2021 amendment took effect.
 * @param query - the case inputs.
 * @returns the statutory term in years.
 */
function statutoryTermYears(query: DeadlineQuery): number {
  switch (query.kind) {
    case 'invention': return 20
    case 'utility-model': return 10
    case 'design':
      return compareCalendarDates(query.filingDate, DESIGN_TERM_TRANSITION) < 0 ? 10 : 15
  }
}

/**
 * Build the annual-fee entries after the granted year (细则第115条), each carrying its
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
  const horizonYears = options.annuityHorizonYears ?? DEFAULT_ANNUITY_HORIZON_YEARS
  const horizon = periodEnd(query.today, { unit: 'year', count: horizonYears })
  // A patent year is one year of term; no annual fee exists past the last one.
  // Granted term compensation extends both the term and its fee years.
  const lastFeeYear = termYearCap(query)
  const lastYear = Math.min(
    lastFeeYear,
    Math.max(grantedYear + 1, patentYearOf(filing, horizon)),
  )
  const firstYear = Math.max(grantedYear + 1, (query.paidThroughYear ?? 0) + 1)
  for (let year = firstYear; year <= lastYear; year++) {
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
 * Build the PCT national-phase entry and its surcharge grace period, both
 * counted from the priority date when the case claims one and from the
 * international filing date otherwise.
 * @param query - the case inputs.
 * @param options - calendar and reminder policy.
 * @returns the two entries, or none when the case is not in the national phase.
 */
function pctNationalEntryItems(query: DeadlineQuery, options: EvaluateOptions): DeadlineItem[] {
  const priority = query.priorityDate
  const filing = query.filingDate
  const items: DeadlineItem[] = []

  // ── 细则第120条 — PCT national-phase entry; the PCT route does not cover designs.
  if (query.kind !== 'design' && query.isPctNationalPhase === true) {
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

  return items
}

/**
 * Build the invalidation-procedure period that runs from the request date.
 *
 * The request date is not the filing date, so a case that has not recorded it
 * reports a pending entry naming the input rather than counting from anything
 * else.
 * @param query - the case inputs.
 * @param options - calendar and reminder policy.
 * @returns the request-driven entry, computed or pending.
 */
function invalidationRequestItems(query: DeadlineQuery, options: EvaluateOptions): DeadlineItem[] {
  const label = '增加无效理由或补充证据（自提出无效宣告请求之日起1个月）'
  const legalBasis = '专利法实施细则第71条'
  const requestDate = query.invalidationRequestDate
  if (requestDate === undefined) {
    return [pending({
      id: 'invalidation-evidence-supplement',
      label,
      legalBasis,
      requiredInput: 'invalidationRequestDate（提出无效宣告请求之日）',
      reason: '该期限自提出无效宣告请求之日起算；未记录请求日即无法计算，不以申请日等其他日期替代。',
    })]
  }
  return [fromPeriod({
    base: { id: 'invalidation-evidence-supplement', label, legalBasis, query, options },
    start: requestDate,
    period: { unit: 'month', count: 1 },
  })]
}

/** One notice-driven period: the report carries an entry per recorded notice of the kind. */
type NoticePeriodSpec = {
  id: string
  label: string
  legalBasis: string
  noticeKind: NoticeKind
  /** Why the entry is pending when the case has not recorded that notice. */
  absentReason: string
  /** Months from delivery when the notice itself designates none. */
  months: number
  /** Overrides for a patent category whose default designated period differs. */
  monthsByKind?: Partial<Record<PatentKind, number>>
  /** Labels that name the category-specific procedure. */
  labelByKind?: Partial<Record<PatentKind, string>>
}

/**
 * The periods that start at a notice's delivery, each beside its article and
 * the kind that starts it. Nothing else starts them, so a case that has not
 * recorded the notice reports a pending entry naming it.
 */
const NOTICE_PERIOD_SPECS: readonly NoticePeriodSpec[] = [
  {
    id: 'reexamination-request',
    label: '请求复审（自收到驳回决定之日起3个月）',
    legalBasis: '专利法第41条第1款',
    noticeKind: 'rejection-decision',
    absentReason: '需要驳回决定的送达记录，本查询未提供该通知。',
    months: 3,
  },
  {
    id: 'oa-response-first',
    label: '答复第一次审查意见通知书（指定期限，实质审查程序中为4个月）',
    labelByKind: {
      'utility-model': '答复第一次审查意见通知书（指定期限，初步审查程序中为2个月）',
      design: '答复第一次审查意见通知书（指定期限，初步审查程序中为2个月）',
    },
    legalBasis: '专利审查指南第五部分第七章第2.1节',
    noticeKind: 'office-action-first',
    absentReason: '需要第一次审查意见通知书的送达记录，本查询未提供该通知。',
    months: 4,
    monthsByKind: { 'utility-model': 2, design: 2 },
  },
  {
    id: 'oa-response-subsequent',
    label: '答复后续审查意见通知书（指定期限一般为2个月，以通知书指定为准）',
    legalBasis: '专利审查指南第五部分第七章第2.1节',
    noticeKind: 'office-action-subsequent',
    absentReason: '需要后续审查意见通知书的送达记录，本查询未提供该通知。',
    months: 2,
  },
  {
    id: 'reexamination-deficiency-response',
    label: '答复复审通知书（指定期限通常为1个月，以通知书指定为准）',
    legalBasis: '专利法实施细则第67条',
    noticeKind: 'reexamination-notice',
    absentReason: '需要复审通知书的送达记录，本查询未提供该通知。',
    months: 1,
  },
  {
    id: 'invalidation-response',
    label: '答复无效宣告请求（合议组指定期限，通常为1个月）',
    legalBasis: '专利法实施细则第72条、专利审查指南第四部分第三章第4.4.1节',
    noticeKind: 'invalidation-transfer',
    absentReason: '需要无效宣告请求书转送文件的送达记录，本查询未提供该通知。',
    months: 1,
  },
]

/**
 * Build the notice-driven periods, one entry per recorded notice of the kind.
 * @param notices - the notices recorded on the case, by kind.
 * @param query - the case inputs.
 * @param options - calendar and reminder policy.
 * @returns the computed entries, or one pending entry per period whose notice is missing.
 */
function noticeDrivenItems(
  notices: ReadonlyMap<NoticeKind, readonly NoticeInput[]>,
  query: DeadlineQuery,
  options: EvaluateOptions,
): DeadlineItem[] {
  return NOTICE_PERIOD_SPECS.flatMap(({ labelByKind, monthsByKind, ...spec }) => fromNotices({
    ...spec,
    label: labelByKind?.[query.kind] ?? spec.label,
    months: monthsByKind?.[query.kind] ?? spec.months,
    notices,
    query,
    options,
  }))
}

/**
 * Build the term-compensation requests: the delay request stays pending until
 * the grant publication date is recorded, the new-drug request exists only for
 * a case with a marketing approval date.
 * @param query - the case inputs.
 * @param options - calendar and reminder policy.
 * @returns the request entries.
 */
function termCompensationItems(query: DeadlineQuery, options: EvaluateOptions): DeadlineItem[] {
  const items: DeadlineItem[] = []

  // ── 细则第77条、第81条 — compensation exists only for an invention patent.
  if (query.kind !== 'invention') return []

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
