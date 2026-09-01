/**
 * `patent_pdf_download` tool: batch-download patent PDFs from Google Patents
 * through an injected ego-browser runner, with a plain-fetch fallback for the
 * extracted CDN URL. Ported from Sati's patentPdfDownload.ts.
 *
 * The ego-browser script construction (buildDownloadScript) and the Sati
 * session (EgoBrowserSession.runScript) are NOT ported here — the integrator
 * wires \`runEgo\` to \`ctx.patentData.createEgoSession()\`. This tool ports
 * validation, output-dir resolution, the MANIFEST resume (dedupe), the fetch
 * fallback, and the summary rendering. Per-patent telemetry (appendDownloadLog)
 * is dropped (Sati-specific ~/.sati/logs path).
 * @module @deepseek-ai/dsh-patent-tools/tool/patent-pdf-download
 */

import { appendFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  networkFetch,
  NetworkFetchError,
  parseRetryAfterHeader,
  type NetworkRetryOptions,
} from '@deepseek-ai/dsh-tool-literature'
import { PatentToolError } from '../error.ts'

const MAX_PATENTS = 50
/** 默认整体超时推算参数：每篇 25s，下限 60s，上限 180s。 */
const PER_PATENT_TIMEOUT_MS = 25_000
const MIN_DEFAULT_TIMEOUT_MS = 60_000
const MAX_DEFAULT_TIMEOUT_MS = 180_000
/**
 * Google Patents CDN（patentimages.storage.googleapis.com）对非浏览器 UA 返回
 * 403，因此 fetch 兜底刻意使用浏览器 UA。
 */
const PATENT_DOWNLOAD_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
/** PDF 魔数（%PDF-，5 字节）。 */
const PDF_MAGIC = '%PDF-'
/** 错误页判定下限：小于该字节数的响应视为错误页不落盘。 */
const MIN_PDF_BYTES = 500
/** 断点续传 MANIFEST 文件名（`<outputDir>/.MANIFEST.jsonl`，append 追加式）。 */
const MANIFEST_FILE = '.MANIFEST.jsonl'
/** fetch 兜底重试策略：吸收瞬时失败与限流（429/503），按 Retry-After 退避，上限 30s。 */
const DEFAULT_FETCH_FALLBACK_RETRY: NetworkRetryOptions = { maxRetries: 2, baseDelayMs: 250, maxDelayMs: 30_000 }

/** 限流重试提示（模型可见，用于替代盲 sleep）。 */
function rateLimitHint(retryAfterMs: number): string {
  return `，等待约 ${Math.max(1, Math.round(retryAfterMs / 1000))}s 后重试`
}

/** Input for the patent_pdf_download tool. */
export type PatentPdfDownloadInput = {
  /** 专利公开号/授权公告号列表（CN/US/EP/WO…），1-50 篇。 */
  patents: string[]
  /** 输出目录（绝对或相对当前工作目录）；默认 <cwd>/专利原文/YYYY-MM-DD。 */
  outputDir?: string
  /** 每页打开超时（秒），默认 20。 */
  pageTimeoutSec?: number
  /** 每篇下载拦截超时（毫秒），默认 60_000。 */
  downloadTimeoutMs?: number
  /** 整体执行超时（毫秒），默认 180_000，上限 300_000。 */
  timeoutMs?: number
  /** 是否截图留证（页面证据截图），默认 false。 */
  record?: boolean
  /** 忽略 MANIFEST 断点续传，强制重跑全部专利（默认 false）。 */
  force?: boolean
}

/** One patent PDF download result. */
export type PatentDownloadItem = {
  patent: string
  status: 'ok' | 'failed'
  /** status=ok 时的落盘路径。 */
  path?: string
  /** 提取到的 CDN PDF 链接（诊断 / 手动重试用）。 */
  pdfUrl?: string
  /** 失败原因。 */
  error?: string
  /** 落盘方式：browser=ego-browser 下载拦截，http=fetch 兜底，skip=MANIFEST 续传命中。 */
  method?: 'browser' | 'http' | 'skip'
  /** fetch 兜底路径的下载耗时（毫秒）。 */
  durationMs?: number
  /** 网络层错误码（network_rate_limited / network_timeout 等），供按码路由与诊断。 */
  networkErrorCode?: string
  /** 限流建议等待时长（毫秒，由 Retry-After 推测），供模型决定何时重试。 */
  retryAfterMs?: number
}

/** Output of the patent_pdf_download tool. */
export type PatentPdfDownloadOutput = {
  results: PatentDownloadItem[]
  summary: { total: number; ok: number; failed: number }
  outputDir: string
  /** record=true 且截图成功时的证据目录路径。 */
  recorded?: string
}

/** 单篇 ego-browser 下载结果（脚本侧只产生 ok / fallback）。 */
export type EgoDownloadItem = {
  patent: string
  status: 'ok' | 'fallback'
  path?: string
  pdfUrl?: string
  error?: string
}

/** ego-browser 批量下载结果。 */
export type EgoDownloadResult = {
  items: EgoDownloadItem[]
  /** 截图证据目录路径（record=true 且成功时）。 */
  recorded?: string
}

/** 传给注入的 ego-browser runner 的批量下载参数。 */
export type EgoDownloadRequest = {
  patents: string[]
  outputDir: string
  pageTimeoutSec: number
  downloadTimeoutMs: number
  record: boolean
  timeoutMs: number
  signal?: AbortSignal
}

/** 注入的 ego-browser 批量下载 runner。 */
export type RunEgo = (request: EgoDownloadRequest) => Promise<EgoDownloadResult>

/** MANIFEST 条目（与 Sati 契约一致）。 */
export type PatentManifestEntry = {
  patent: string
  status: 'ok' | 'failed'
  path?: string
  size?: number
  sha1?: string
  ts: number
}

/** Injected patent-PDF-download dependencies. */
export type PatentPdfDownloadDeps = {
  /** ego-browser batch runner (production wires ctx.patentData.createEgoSession()). */
  runEgo: RunEgo
  /** Working directory used to resolve a relative outputDir (default process.cwd()). */
  cwd?: string
  /** Resolve the output directory (defaults to <cwd>/专利原文/YYYY-MM-DD). */
  resolveOutputDir?: (outputDir: string | undefined, cwd: string) => string
  /** fetch implementation for the CDN fallback (defaults to globalThis.fetch). */
  fetchImpl?: typeof fetch
  /** Override the CDN fallback retry policy (defaults to DEFAULT_FETCH_FALLBACK_RETRY). */
  fetchFallbackRetry?: NetworkRetryOptions
  /** Resolve the batch runner from a browser-backend cold decision (defaults to runEgo). */
  resolveRunner?: () => Promise<RunEgo> | RunEgo
}

/**
 * Normalize a patent number: trim, upper-case, and strip whitespace/separators.
 * @param value - the raw patent number.
 * @returns the normalized number.
 */
export function normalizePatentNumber(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s\-:/]/g, '')
}

/** 当天日期子目录名（YYYY-MM-DD）。 */
function datePartOf(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** 默认输出目录解析：显式 outputDir 相对 cwd，否则 <cwd>/专利原文/YYYY-MM-DD。 */
function defaultResolveOutputDir(outputDir: string | undefined, cwd: string): string {
  if (outputDir) return resolve(cwd, outputDir)
  return join(cwd, '专利原文', datePartOf(new Date()))
}

/** 校验 + 归一化 + 去重专利号（含目录穿越拒绝）。 */
function validatePatents(patents: string[]): string[] {
  const normalized = patents.map(normalizePatentNumber).filter(n => n.length > 0)
  const unique = [...new Set(normalized)]
  if (unique.length === 0) {
    throw new PatentToolError('invalid_tool_input', 'patents must contain at least one non-empty number', {
      tool: 'patent_pdf_download',
    })
  }
  if (unique.length > MAX_PATENTS) {
    throw new PatentToolError('invalid_tool_input', `patents exceeds the maximum of ${MAX_PATENTS}`, {
      tool: 'patent_pdf_download',
    })
  }
  const traversal = unique.filter(n => n.includes('\\') || n.includes('..'))
  if (traversal.length > 0) {
    throw new PatentToolError(
      'invalid_tool_input',
      `patents contain path traversal characters: ${traversal.join(', ')}`,
      { tool: 'patent_pdf_download' },
    )
  }
  return unique
}

/**
 * Reject a defined integer value outside [min, max], throwing an
 * invalid_tool_input error for the patent_pdf_download tool.
 * @param value - the candidate value (undefined passes through).
 * @param min - inclusive lower bound.
 * @param max - inclusive upper bound.
 * @param message - the error message when the value is out of range.
 */
function requireIntRange(value: number | undefined, min: number, max: number, message: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < min || value > max)) {
    throw new PatentToolError('invalid_tool_input', message, { tool: 'patent_pdf_download' })
  }
}

/** 磁盘文件大小与 MANIFEST 记录一致才算命中续传。 */
async function fileSizeMatches(path: string, expectedSize: number): Promise<boolean> {
  try {
    const st = await stat(path)
    return st.size === expectedSize
  } catch {
    return false
  }
}

/**
 * 加载 MANIFEST。按 patent 键去重（append 式积累的重复行最后一条 wins）；
 * 损坏行容忍跳过，文件不存在返回空。
 */
async function loadManifest(outputDir: string): Promise<Map<string, PatentManifestEntry>> {
  const manifestPath = join(outputDir, MANIFEST_FILE)
  let raw: string
  try {
    raw = await readFile(manifestPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map()
    throw error
  }
  const byPatent = new Map<string, PatentManifestEntry>()
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const entry = JSON.parse(trimmed) as PatentManifestEntry | null
      if (entry && typeof entry.patent === 'string' && entry.status === 'ok') {
        byPatent.set(entry.patent, entry)
      }
    } catch {
      // 单行损坏：跳过该行，其余行仍生效
    }
  }
  return byPatent
}

/** 追加一条 MANIFEST 记录。 */
async function saveManifestEntry(outputDir: string, entry: PatentManifestEntry): Promise<void> {
  const manifestPath = join(outputDir, MANIFEST_FILE)
  await appendFile(manifestPath, JSON.stringify(entry) + '\n', 'utf8')
}

/** 计算文件 SHA-1（写 MANIFEST 用）。 */
async function sha1OfFile(path: string): Promise<string> {
  const data = await readFile(path)
  return createHash('sha1').update(data).digest('hex')
}

/**
 * 浏览器拦截条目兜底：脚本返回 fallback（已提取 CDN URL）时，用 fetch 直接
 * 下载落盘。成功升格为 ok（method=http）；失败标记 failed（保留 pdfUrl 供重试）。
 *
 * 与 Sati 的差异：Sati 经 networkFetch 流式写盘；本端口用注入的 fetchImpl
 * 整读入内存（20MB 级 PDF）落盘。fetch 兜底经 networkFetch 带超时/重试/
 * Retry-After 退避；重试耗尽仍限流时，在失败项给出 networkErrorCode 与
 * retryAfterMs，并把建议等待时长写入 error，让模型据此重试而非盲 sleep。
 */
async function fetchPdfFallback(
  item: EgoDownloadItem,
  outputDir: string,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch; fetchRetry?: NetworkRetryOptions },
): Promise<PatentDownloadItem> {
  if (item.status === 'ok') {
    return {
      patent: item.patent,
      status: 'ok',
      ...(item.path === undefined ? {} : { path: item.path }),
      ...(item.pdfUrl === undefined ? {} : { pdfUrl: item.pdfUrl }),
      method: 'browser',
    }
  }
  if (!item.pdfUrl) {
    return { patent: item.patent, status: 'failed', ...(item.error === undefined ? {} : { error: item.error }) }
  }
  // 闭包须捕获已收窄的 URL；属性访问在闭包内不被窄化。
  const pdfUrl: string = item.pdfUrl
  const start = Date.now()
  const target = join(outputDir, `${item.patent}.pdf`)
  const tmp = `${target}.tmp`
  const base = item.error ? `${item.error}; ` : ''
  let networkErrorCode: string | undefined
  let retryAfterMs: number | undefined
  const failed = (reason: string): PatentDownloadItem => ({
    patent: item.patent,
    status: 'failed',
    pdfUrl,
    ...(networkErrorCode === undefined ? {} : { networkErrorCode }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    error: `${base}fetch fallback failed: ${reason}`,
    durationMs: Date.now() - start,
  })
  const fetchFn = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchFn !== 'function') {
    return failed('no fetch implementation available')
  }
  try {
    const res = await networkFetch(
      pdfUrl,
      { headers: { 'User-Agent': PATENT_DOWNLOAD_USER_AGENT, Accept: 'application/pdf' } },
      {
        /* v8 ignore next -- execute always passes exec.signal through. */
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        fetchImpl: fetchFn,
        retry: options.fetchRetry ?? DEFAULT_FETCH_FALLBACK_RETRY,
      },
    )
    if (!res.ok) {
      if (res.status === 429) {
        networkErrorCode = 'network_rate_limited'
        retryAfterMs = parseRetryAfterHeader(res.headers.get('retry-after'))
        return failed(`HTTP 429 (rate limited)${retryAfterMs === undefined ? '' : rateLimitHint(retryAfterMs)}`)
      }
      return failed(`HTTP ${res.status} ${res.statusText}`)
    }
    const contentType = res.headers.get('content-type') ?? ''
    if (contentType.toLowerCase().includes('text/html')) {
      return failed(`unexpected Content-Type: ${contentType}`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < MIN_PDF_BYTES) {
      return failed(`response too small (${buf.length} bytes), likely an error page`)
    }
    if (buf.subarray(0, PDF_MAGIC.length).toString() !== PDF_MAGIC) {
      return failed(`invalid PDF magic: ${JSON.stringify(buf.subarray(0, PDF_MAGIC.length).toString())}`)
    }
    await writeFile(tmp, buf)
    await rename(tmp, target)
    return {
      patent: item.patent,
      status: 'ok',
      path: target,
      pdfUrl,
      method: 'http',
      durationMs: Date.now() - start,
    }
  } catch (fetchErr) {
    await unlink(tmp).catch(() => {})
    networkErrorCode = fetchErr instanceof NetworkFetchError ? fetchErr.code : undefined
    return failed(fetchErr instanceof Error ? fetchErr.message : String(fetchErr))
  }
}

function summarize(results: PatentDownloadItem[], total: number): { total: number; ok: number; failed: number } {
  const ok = results.filter(r => r.status === 'ok').length
  return { total, ok, failed: total - ok }
}

/** 落盘方式的中文标注（formatSummary 行内后缀）。 */
const METHOD_LABELS: Record<string, string> = {
  http: '（fetch 兜底）',
  skip: '（已下载，跳过）',
}

/** Render the canonical download value into model-facing prose. */
function renderPdfDownload(value: PatentPdfDownloadOutput): string {
  const lines: string[] = [
    `下载完成：${value.summary.ok}/${value.summary.total} 成功，${value.summary.failed} 失败`,
    `输出目录：${value.outputDir}`,
  ]
  if (value.recorded) lines.push(`截图留证：${value.recorded}`)
  for (const r of value.results) {
    if (r.status === 'failed') {
      const retry = r.pdfUrl ? `；可手动重试：${r.pdfUrl}` : ''
      lines.push(`- ${r.patent}: 失败（${r.error ?? 'unknown'}${retry}）`)
    } else {
      /* v8 ignore next -- fallback results always carry a method for ok items. */
      const method = METHOD_LABELS[r.method ?? ''] ?? ''
      lines.push(`- ${r.patent}: ${r.path ?? 'ok'}${method}`)
    }
  }
  return lines.join('\n')
}

const ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    patent: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['ok', 'failed'] },
    path: { type: 'string' },
    pdfUrl: { type: 'string' },
    error: { type: 'string' },
    method: { type: 'string', enum: ['browser', 'http', 'skip'] },
    durationMs: { type: 'number' },
    networkErrorCode: { type: 'string' },
    retryAfterMs: { type: 'number' },
  },
} as const

const DESCRIPTION = [
  '从 Google Patents 批量下载专利 PDF：优先经用户 ego-browser（ego lite）做浏览器内下载拦截（复用登录态），拦截不可用或失败时回退为提取 CDN PDF 链接后用 HTTP 直接下载落盘。输入 patents 为公开号列表（CN123456789A、US11452699B2、EP1234567A1、WO2023123456A1…），保存为 `<outputDir>/<patent>.pdf`。每篇结果为 status=ok（带 path 与 method 说明落盘方式）或 status=failed（带 error，且保留 pdfUrl 供手动重试）；失败不中断其余专利。',
  '',
  'Usage notes:',
  '  - 重复执行命中 MANIFEST 断点续传（size 匹配即跳过，method=skip），force=true 强制重下',
  '  - record=true 可额外截图留证（输出 `<outputDir>/evidence/`）',
  '  - HTTP 兜底对瞬时失败/限流（429/503）自动重试并按 Retry-After 退避；重试后仍限流时 error 会注明限流与建议等待时长（并可结合 retryAfterMs），此时应等待后再重试而非立即重试',
].join('\n')
/**
 * Build the `patent_pdf_download` tool over an injected ego-browser runner.
 * @param deps - the runner plus optional cwd / output-dir resolver / fetch impl.
 * @returns a registry-ready tool definition.
 */
export function createPatentPdfDownloadTool(deps: PatentPdfDownloadDeps): ToolDefinition {
  const resolveDir = deps.resolveOutputDir ?? defaultResolveOutputDir
  return defineTool({
    name: 'patent_pdf_download',
    description: DESCRIPTION,
    parameters: {
      patents: { type: 'array', required: true, items: { type: 'string' }, description: '专利公开号列表（1-50 篇）' },
      outputDir: { type: 'string', description: '输出目录（绝对或相对当前工作目录）；默认 <cwd>/专利原文/YYYY-MM-DD' },
      pageTimeoutSec: { type: 'number', description: '每页打开超时（秒），默认 20' },
      downloadTimeoutMs: { type: 'number', description: '每篇下载拦截超时（毫秒），默认 60000' },
      timeoutMs: { type: 'number', description: '整体执行超时（毫秒），默认 180000，上限 300000' },
      record: { type: 'boolean', description: '是否截图留证（默认 false）' },
      force: { type: 'boolean', description: '忽略 MANIFEST 断点续传，强制重下全部（默认 false）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          results: { type: 'array', required: true, items: ITEM_SCHEMA },
          summary: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              total: { type: 'integer', required: true },
              ok: { type: 'integer', required: true },
              failed: { type: 'integer', required: true },
            },
          },
          outputDir: { type: 'string', required: true },
          recorded: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderPdfDownload(value) }],
    },
    async execute(args, exec) {
      const patents = validatePatents(args.patents)

      const pageTimeoutSec = args.pageTimeoutSec
      requireIntRange(pageTimeoutSec, 5, 60, 'pageTimeoutSec must be an integer between 5 and 60')
      const downloadTimeoutMs = args.downloadTimeoutMs
      requireIntRange(downloadTimeoutMs, 5_000, 300_000, 'downloadTimeoutMs must be between 5000 and 300000')
      const timeoutMs = args.timeoutMs
      requireIntRange(timeoutMs, 1, 300_000, 'timeoutMs must be between 1 and 300000')

      const cwd = deps.cwd ?? process.cwd()
      const outputDir = resolveDir(args.outputDir, cwd)
      await mkdir(outputDir, { recursive: true })

      const pageTimeoutSecValue = pageTimeoutSec ?? 20
      const downloadTimeoutMsValue = downloadTimeoutMs ?? 60_000
      const timeoutMsValue =
        timeoutMs ??
        Math.min(MAX_DEFAULT_TIMEOUT_MS, Math.max(MIN_DEFAULT_TIMEOUT_MS, patents.length * PER_PATENT_TIMEOUT_MS))
      const record = args.record === true
      const force = args.force === true

      // 断点续传：status=ok 且磁盘 size 匹配的专利跳过；--force 时全部视为未下载。
      const manifest = await loadManifest(outputDir)
      const skipped: PatentDownloadItem[] = []
      let pending: string[]
      if (force) {
        pending = patents
      } else {
        pending = []
        for (const patent of patents) {
          const entry = manifest.get(patent)
          if (entry?.path && entry.size !== undefined && (await fileSizeMatches(entry.path, entry.size))) {
            skipped.push({ patent, status: 'ok', path: entry.path, method: 'skip' })
          } else {
            pending.push(patent)
          }
        }
      }
      if (pending.length === 0) {
        const summary = { total: patents.length, ok: patents.length, failed: 0 }
        return { results: skipped, summary, outputDir }
      }

      let egoResult: EgoDownloadResult
      try {
        const runner = deps.resolveRunner !== undefined ? await deps.resolveRunner() : deps.runEgo
        egoResult = await runner({
          patents: pending,
          outputDir,
          pageTimeoutSec: pageTimeoutSecValue,
          downloadTimeoutMs: downloadTimeoutMsValue,
          record,
          timeoutMs: timeoutMsValue,
          signal: exec.signal,
        })
      } catch (error) {
        if (exec.signal.aborted) {
          throw new PatentToolError('tool_aborted', 'patent_pdf_download aborted', { tool: 'patent_pdf_download' })
        }
        // 配置类失败（未接线的 fail-loud 桩）保留 setup_required 码，供按码路由的调用方判别。
        if (error instanceof PatentToolError && error.code === 'setup_required') throw error
        throw new PatentToolError(
          'tool_execution_failed',
          `patent_pdf_download failed: ${error instanceof Error ? error.message : String(error)}`,
          { tool: 'patent_pdf_download' },
        )
      }

      // 兜底：浏览器拦截不可用或失败时，用 fetch 下载 CDN PDF。
      const results = await Promise.all(
        egoResult.items.map(item =>
          fetchPdfFallback(item, outputDir, {
            signal: exec.signal,
            ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
            ...(deps.fetchFallbackRetry === undefined ? {} : { fetchRetry: deps.fetchFallbackRetry }),
          }),
        ),
      )

      // 下载成功的条目追加进 MANIFEST；落盘文件不可读时放弃续传记录，不阻断结果。
      for (const r of results) {
        if (r.status === 'ok' && r.path) {
          try {
            const st = await stat(r.path)
            await saveManifestEntry(outputDir, {
              patent: r.patent,
              status: 'ok',
              path: r.path,
              size: st.size,
              sha1: await sha1OfFile(r.path),
              ts: Date.now(),
            })
          } catch {
            // 续传记录失败不影响本次下载结果
          }
        }
      }

      const allResults = [...skipped, ...results]
      const summary = summarize(allResults, patents.length)
      return {
        results: allResults,
        summary,
        outputDir,
        ...(egoResult.recorded === undefined ? {} : { recorded: egoResult.recorded }),
      }
    },
  })
}
