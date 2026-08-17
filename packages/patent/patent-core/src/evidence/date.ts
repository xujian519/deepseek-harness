/**
 * 证据日期认定（移植自 Mady domains/evidence/date.go）。
 *
 * 专利实践中"现有技术时间基准"的确定性判定：解析多格式日期、
 * 月级日期推定到月末、Wayback Machine 存档日期提取、与申请日比较。
 * 纯函数，无外部依赖。
 */

import type { DateDetermination } from './types.ts'

/** 支持的日期格式（对齐 Go dateFormats）。
 * 英文月份名（Jan 2, 2023 / September 2, 2023）由 parseDateFlexible 的
 * fallback 正则处理（格式模板无法表达月份名 → 数字解构），不列入本表。 */
const DATE_FORMATS: readonly string[] = [
  'yyyy-MM-dd',
  'yyyy/MM/dd',
  'yyyy.MM.dd',
  'yyyyMMdd',
  'yyyy-MM',
  'yyyy/MM',
  'yyyy年M月d日',
  'yyyy年MM月dd日',
  'yyyy年M月',
]

/** 解析指定格式的日期字符串；失败返回 null。 */
function parseWithFormat(text: string, format: string): Date | null {
  const match = formatToRegex(format).exec(text)
  if (match === null) return null
  const [, year, month, day] = match
  if (year === undefined || month === undefined) return null
  const y = Number(year)
  const mo = Number(month)
  if (!Number.isFinite(y) || y < 1 || !Number.isFinite(mo) || mo < 1 || mo > 12) return null
  if (day !== undefined) {
    const d = Number(day)
    if (!Number.isFinite(d) || d < 1 || d > 31) return null
    const date = new Date(Date.UTC(y, mo - 1, d))
    // 溢出校验（如 2 月 30 日 → 回绕到 3 月，视为非法）
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
    return date
  }
  return new Date(Date.UTC(y, mo - 1, 1))
}

/** 把格式模板转成正则（仅支持本项目声明的格式）。 */
function formatToRegex(format: string): RegExp {
  switch (format) {
    case 'yyyy-MM-dd':
      return /^(\d{4})-(\d{1,2})-(\d{1,2})$/
    case 'yyyy/MM/dd':
      return /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/
    case 'yyyy.MM.dd':
      return /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/
    case 'yyyyMMdd':
      return /^(\d{4})(\d{2})(\d{2})$/
    case 'yyyy-MM':
      return /^(\d{4})-(\d{1,2})$/
    case 'yyyy/MM':
      return /^(\d{4})\/(\d{1,2})$/
    case 'yyyy年M月d日':
      return /^(\d{4})年(\d{1,2})月(\d{1,2})日$/
    case 'yyyy年MM月dd日':
      return /^(\d{4})年(\d{2})月(\d{2})日$/
    case 'yyyy年M月':
      return /^(\d{4})年(\d{1,2})月$/
    default:
      return /$a/ // 永不匹配
  }
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

/**
 * 多格式日期解析；失败返回 null。
 * @param text - 待解析的日期字符串。
 * @returns 解析出的 Date，失败返回 null。
 */
export function parseDateFlexible(text: string): Date | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  for (const format of DATE_FORMATS) {
    const parsed = parseWithFormat(trimmed, format)
    if (parsed !== null) return parsed
  }
  // 英文月份名（Jan 2, 2006 / January 2, 2006 / Sept 2, 2023——含 Sept 变体）
  const m = trimmed.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4})$/)
  if (m) {
    const monthName = m[1]
    if (monthName !== undefined) {
      const month = MONTHS[monthName.toLowerCase()] ?? MONTHS[monthName.toLowerCase().slice(0, 3)]
      const day = Number(m[2])
      const year = Number(m[3])
      if (month !== undefined && day >= 1 && day <= 31 && year >= 1) {
        const date = new Date(Date.UTC(year, month - 1, day))
        if (date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return date
      }
    }
  }
  return null
}

/**
 * 是否精确到日（含英文月份格式："Jan 15, 2023" 是精确日期，不得截为年-月）。
 * @param dateStr - 日期字符串。
 * @returns 是否精确到日。
 */
export function isPreciseDate(dateStr: string): boolean {
  const trimmed = dateStr.trim()
  return (
    ['yyyy-MM-dd', 'yyyy/MM/dd', 'yyyy.MM.dd', 'yyyyMMdd', 'yyyy年M月d日', 'yyyy年MM月dd日'].some(
      format => parseWithFormat(trimmed, format) !== null,
    ) || /^[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}$/.test(trimmed)
  )
}

/**
 * 是否仅到年月。
 * @param dateStr - 日期字符串。
 * @returns 是否仅到年月。
 */
export function isMonthOnlyDate(dateStr: string): boolean {
  return ['yyyy-MM', 'yyyy/MM', 'yyyy年M月'].some(format => parseWithFormat(dateStr.trim(), format) !== null)
}

/**
 * 月级日期推定到当月最后一天（专利实践惯例，保守推定）。
 * @param date - 月级日期（或其当月初日）。
 * @returns ISO 格式的当月最后一天（yyyy-MM-dd）。
 */
export function inferredMonthEnd(date: Date): string {
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
  return formatIsoDate(lastDay)
}

function formatIsoDate(d: Date): string {
  const y = d.getUTCFullYear()
  const mo = `${d.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${d.getUTCDate()}`.padStart(2, '0')
  return `${y}-${mo}-${day}`
}

function formatYearMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${`${d.getUTCMonth() + 1}`.padStart(2, '0')}`
}

/**
 * 清理证据 URI 的自定义 scheme 前缀（web_pub: / http_archive: / patent: 等）。
 * @param uri - 原始证据 URI。
 * @returns 去掉自定义 scheme 前缀后的 URI。
 */
export function cleanEvidenceURI(uri: string): string {
  const prefixes = [
    'web_pub:',
    'http_archive:',
    'web:',
    'pub_use:',
    'public_use:',
    'witness:',
    'patent:',
    'prior_art:',
  ]
  for (const prefix of prefixes) {
    if (uri.startsWith(prefix)) return uri.slice(prefix.length)
  }
  return uri
}

/**
 * 从 Wayback Machine URL 提取存档日期（/web/YYYYMMDDhhmmss/... 含 id_ 后缀变体）。
 * @param rawURL - 原始 URL。
 * @returns ISO 格式存档日期（yyyy-MM-dd），失败返回空串。
 */
export function extractWaybackMachineDate(rawURL: string): string {
  let parsed: URL
  try {
    parsed = new URL(cleanEvidenceURI(rawURL))
  } catch {
    return ''
  }
  // 严格匹配 archive.org 域（web.archive.org / archive.org），
  // 防 "web.archive.org.evil.com" 之类伪造域名通过 includes 误匹配。
  const hostname = parsed.hostname.toLowerCase()
  if (hostname !== 'web.archive.org' && hostname !== 'archive.org' && !hostname.endsWith('.web.archive.org')) {
    return ''
  }
  const parts = parsed.pathname.replace(/^\/web\//, '').split('/')
  const timestamp = (parts[0] ?? '').replace(/\D.*$/, '') // 剥离 "20230615093000id_" 的 id_ 后缀
  if (timestamp.length >= 8) {
    const formatted = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`
    if (parseDateFlexible(formatted) !== null) return formatted
  }
  return ''
}

/**
 * 确定证据的公开日期（页面标注日期 > Wayback Machine 存档日期）。
 * 月级日期推定到月末，可靠度分级。返回 DateDetermination。
 * @param claimedDate - 页面标注的日期（可空）。
 * @param urlStr - 证据 URL（可空，供 Wayback Machine 存档日期提取）。
 * @param filingDate - 申请日（可选，用于判断是否构成现有技术）。
 * @returns 日期认定结果。
 */
export function determinePublicationDate(
  claimedDate: string | undefined,
  urlStr: string | undefined,
  filingDate?: string,
): DateDetermination {
  const result: DateDetermination = {
    sourceDate: claimedDate ?? '',
    determined: 'unknown',
    method: 'internet_publication',
    isPriorArt: false,
    ...(filingDate !== undefined ? { filingDate } : {}),
    reliability: 'low',
    sourceType: 'inferred',
  }
  if (claimedDate === undefined || claimedDate === '') {
    if (urlStr === undefined || urlStr === '') return result
    const wmDate = extractWaybackMachineDate(urlStr)
    if (wmDate !== '') {
      result.determined = wmDate
      result.isPriorArt = isBeforeFilingDate(wmDate, filingDate)
      result.reliability = 'medium'
      result.sourceType = 'wayback_machine'
    }
    return result
  }

  const parsed = parseDateFlexible(claimedDate)
  if (parsed === null) return result
  if (isPreciseDate(claimedDate)) {
    result.determined = formatIsoDate(parsed)
    result.reliability = 'high'
    result.sourceType = 'exact_page_date'
  } else if (isMonthOnlyDate(claimedDate)) {
    result.determined = inferredMonthEnd(parsed)
    result.reliability = 'medium'
    result.sourceType = 'claimed_date'
  } else {
    result.determined = formatYearMonth(parsed)
    result.reliability = 'medium'
    result.sourceType = 'claimed_date'
  }
  result.isPriorArt = isBeforeFilingDate(result.determined, filingDate)
  return result
}

/**
 * 判断公开日是否早于申请日（无法解析时返回 false）。
 * @param pubDate - 公开日期字符串。
 * @param filingDate - 申请日期字符串。
 * @returns 公开日是否早于申请日。
 */
export function isBeforeFilingDate(pubDate: string | undefined, filingDate: string | undefined): boolean {
  if (pubDate === undefined || pubDate === '' || filingDate === undefined || filingDate === '') return false
  const pub = parseDateFlexible(pubDate)
  const filing = parseDateFlexible(filingDate)
  if (pub === null || filing === null) return false
  return pub.getTime() < filing.getTime()
}

/**
 * 从描述文本中提取日期（策略：完整中文日期 > 月级中文日期 > YYYY-MM-DD 模式）。
 * 返回最精确的日期表达；未找到返回空串。
 * @param text - 待提取日期的描述文本。
 * @returns 提取到的最精确日期表达，未找到返回空串。
 */
export function extractDateFromText(text: string): string {
  if (text === '') return ''
  // 完整中文日期：XXXX年XX月XX日（rune 安全：用 Unicode 正则）
  const full = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
  if (full) {
    const candidate = full[0]
    if (parseDateFlexible(candidate) !== null) return candidate
  }
  // 月级中文日期：XXXX年XX月
  const monthOnly = text.match(/(\d{4})年(\d{1,2})月/)
  if (monthOnly) {
    const candidate = monthOnly[0]
    if (parseDateFlexible(candidate) !== null) return candidate
  }
  // ASCII 日期：YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD / YYYYMMDD
  for (const m of text.matchAll(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{8}/g)) {
    if (parseDateFlexible(m[0]) !== null) return m[0]
  }
  return ''
}
