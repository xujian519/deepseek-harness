/**
 * `paper_download` tool: download one academic paper's PDF from the literature
 * connectors. The direct link wins (arXiv extra.pdf / OpenAlex pdf_url /
 * Semantic Scholar openAccessPdf), verified by PDF magic and minimum size;
 * when the direct fetch fails (403/404/HTML shell page), the ego extractor
 * opens the record page, extracts the PDF link, and the same fetch path
 * downloads it. Mirrors the patent_pdf_download channel design.
 * @module @deepseek-ai/dsh-tool-literature/tool/paper-download
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { EgoExtractor, type PageExtractor } from '@deepseek-ai/dsh-browser-backend'
import type { ConnectorRegistry } from '../runtime/connector-registry.ts'
import { LiteratureToolError } from '../error.ts'

/** PDF magic bytes (%PDF-, 5 bytes). */
const PDF_MAGIC = '%PDF-'
/** Responses smaller than this are treated as error pages and not saved. */
const MIN_PDF_BYTES = 500
/** Browser UA for sources that reject non-browser clients. */
const PAPER_DOWNLOAD_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
/** Whole-call timeout default (ms). */
const DEFAULT_TIMEOUT_MS = 60_000
/** JS expression yielding the first PDF link on a paper record page. */
const PDF_LINK_EXPR = '(() => { const a = document.querySelector(\'a[href$=".pdf"], a[href*="/pdf/"], a[href*=".pdf?"]\'); return a ? a.href : null })()'

/** Input for the paper_download tool. */
export type PaperDownloadInput = {
  /** Database id from paper_list_sources (e.g. "arxiv", "openalex"). */
  db: string
  /** Paper id from a paper_search hit. */
  id: string
  /** Direct PDF link override (skips the connector's pdf_url resolution). */
  pdfUrl?: string
  /** Output directory (absolute or relative to cwd); default <cwd>/论文原文/YYYY-MM-DD. */
  outputDir?: string
  /** Whole-call timeout in ms (default 60000, max 300000). */
  timeoutMs?: number
}

/** One paper download result. */
export type PaperDownloadResult = {
  status: 'ok' | 'failed'
  /** status=ok 时的落盘路径。 */
  path?: string
  /** 实际下载的 PDF 链接（诊断 / 手动重试用）。 */
  pdfUrl?: string
  /** 失败原因。 */
  error?: string
  /** 落盘方式：direct=直链 fetch，browser=browser-use 提取链接后 fetch。 */
  method?: 'direct' | 'browser'
}

/** Output of the paper_download tool. */
export type PaperDownloadOutput = {
  db: string
  id: string
  result: PaperDownloadResult
  outputDir: string
}

/** Injected paper-download dependencies. */
export type PaperDownloadDeps = {
  /** The literature connector registry (resolves the db's fetch + record url). */
  registry: ConnectorRegistry
  /** fetch implementation for the PDF download (defaults to globalThis.fetch). */
  fetchImpl?: typeof fetch
  /** Page extractor for the browser fallback channel (defaults to a fresh ego extractor). */
  extractor?: PageExtractor
  /** Working directory used to resolve a relative outputDir (default process.cwd()). */
  cwd?: string
  /** Resolve the output directory (defaults to <cwd>/论文原文/YYYY-MM-DD). */
  resolveOutputDir?: (outputDir: string | undefined, cwd: string) => string
}

/** 当天日期子目录名（YYYY-MM-DD）。 */
/* jscpd:ignore-start */
function datePartOf(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
/* jscpd:ignore-end */

/** Default output directory resolution: explicit outputDir relative to cwd, else <cwd>/论文原文/YYYY-MM-DD. */
function defaultResolveOutputDir(outputDir: string | undefined, cwd: string): string {
  if (outputDir) return resolve(cwd, outputDir)
  return join(cwd, '论文原文', datePartOf(new Date()))
}

/** A fetched PDF body with the download duration. */
export type FetchedPdf = { ok: true; body: Buffer; durationMs: number }

/** Download a URL and verify it is a real PDF (magic + minimum size + not an HTML shell). */
async function fetchPdfBody(
  url: string,
  options: { signal: AbortSignal; timeoutMs: number; fetchImpl?: typeof fetch },
): Promise<FetchedPdf | { ok: false; error: string; durationMs: number }> {
  const start = Date.now()
  try {
    const fetchFn = options.fetchImpl ?? globalThis.fetch
    const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)])
    // 与 patent_pdf_download 的 fetchPdfFallback 对称：PDF 魔数/最小字节/Content-Type 判定需跨工具一致。
    /* jscpd:ignore-start */
    const res = await fetchFn(url, {
      headers: { 'User-Agent': PAPER_DOWNLOAD_USER_AGENT, Accept: 'application/pdf' },
      signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    const contentType = res.headers.get('content-type') ?? ''
    if (contentType.toLowerCase().includes('text/html')) {
      throw new Error(`unexpected Content-Type: ${contentType}`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < MIN_PDF_BYTES) {
      throw new Error(`response too small (${buf.length} bytes), likely an error page`)
    }
    if (buf.subarray(0, PDF_MAGIC.length).toString() !== PDF_MAGIC) {
      throw new Error('invalid PDF magic')
    }
    /* jscpd:ignore-end */
    return { ok: true, body: buf, durationMs: Date.now() - start }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - start,
    }
  }
}

/**
 * Resolve the PDF link for a download: an explicit override wins, else the
 * connector record's PDF field. A connector `fetch` returns its raw source
 * record (arXiv `pdf`, OpenAlex `pdf_url`, Semantic Scholar `openAccessPdf.url`)
 * or a normalized hit carrying those under `.extra`; accept both shapes so the
 * source record is read without its wrapper.
 */
function pdfUrlFrom(
  record: unknown,
  direct: string | undefined,
): { pdfUrl: string } | { error: string } {
  if (direct !== undefined && direct.trim() !== '') return { pdfUrl: direct.trim() }
  // record may be null when the connector exposes no fetch; every access is optional-chained.
  const r = record as {
    extra?: { pdf_url?: unknown; pdf?: unknown }
    pdf_url?: unknown
    pdf?: unknown
    openAccessPdf?: { url?: unknown }
  } | null | undefined
  const candidates = [r?.extra?.pdf_url, r?.extra?.pdf, r?.pdf_url, r?.pdf, r?.openAccessPdf?.url]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate !== '') return { pdfUrl: candidate }
  }
  return { error: 'no PDF link available for this record (no pdf_url in the record and no direct pdfUrl given)' }
}

/** The record page to open in the browser fallback: the record's url, else its id when it is a URL. */
function recordPageUrl(record: unknown): string | undefined {
  const r = record as { url?: unknown; landing_page_url?: unknown; id?: unknown }
  for (const candidate of [r.url, r.landing_page_url, r.id]) {
    if (typeof candidate === 'string' && /^https?:\/\//.test(candidate)) return candidate
  }
  return undefined
}

/** Render the canonical download value into model-facing prose. */
function renderDownload(value: PaperDownloadOutput): string {
  const { result } = value
  if (result.status === 'ok') {
    const method = result.method === 'browser' ? '（ego 兜底）' : ''
    return [`下载完成：${result.path}${method}`, `输出目录：${value.outputDir}`].join('\n')
  }
  const retry = result.pdfUrl ? `；可手动重试：${result.pdfUrl}` : ''
  /* v8 ignore next -- execute always sets result.error on failure; the fallback covers hand-built values. */
  return `下载失败（${result.error ?? 'unknown'}${retry}）\n输出目录：${value.outputDir}`
}

const DESCRIPTION = [
  '- Downloads one academic paper PDF identified by `db` + `id` (from `paper_search`)',
  "- Prefers the source's direct PDF link (arXiv extra.pdf / OpenAlex pdf_url / Semantic Scholar openAccessPdf), verified by PDF magic and minimum size",
  '- When the direct link fails (403/404/HTML shell), falls back to ego opening the record page and extracting the PDF link',
  '- Saves as `<outputDir>/<id>.pdf` (default `<cwd>/论文原文/YYYY-MM-DD/<id>.pdf`)',
  '',
  'Usage notes:',
  '  - Call `paper_search` first to obtain a `db` id and paper `id`',
  '  - `pdfUrl` overrides the connector-resolved link (diagnostics / manual retry)',
].join('\n')

/**
 * Build the `paper_download` tool over the literature registry and an optional
 * browser-use extractor.
 * @param deps - the registry plus optional fetch/extractor/output-dir injection.
 * @returns a registry-ready tool definition.
 */
export function createPaperDownloadTool(deps: PaperDownloadDeps): ToolDefinition {
  const resolveDir = deps.resolveOutputDir ?? defaultResolveOutputDir
  const extractor = deps.extractor ?? new EgoExtractor()
  return defineTool({
    name: 'paper_download',
    description: DESCRIPTION,
    parameters: {
      db: { type: 'string', required: true, description: 'Database id (from paper_list_sources)' },
      id: { type: 'string', required: true, description: 'Paper id from a paper_search hit' },
      pdfUrl: { type: 'string', description: 'Direct PDF link override (skips connector resolution)' },
      outputDir: { type: 'string', description: 'Output directory; default <cwd>/论文原文/YYYY-MM-DD' },
      timeoutMs: { type: 'number', description: 'Whole-call timeout (ms); default 60000, max 300000' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          db: { type: 'string', required: true },
          id: { type: 'string', required: true },
          result: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              status: { type: 'string', required: true, enum: ['ok', 'failed'] },
              path: { type: 'string' },
              pdfUrl: { type: 'string' },
              error: { type: 'string' },
              method: { type: 'string', enum: ['direct', 'browser'] },
            },
          },
          outputDir: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderDownload(value) }],
    },
    async execute(args, exec) {
      const db = args.db.trim()
      const id = args.id.trim()
      if (db === '' || id === '') {
        throw new LiteratureToolError('invalid_tool_input', 'db and id must be non-empty.', { tool: 'paper_download' })
      }
      const timeoutMs = args.timeoutMs
      if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)) {
        throw new LiteratureToolError('invalid_tool_input', 'timeoutMs must be an integer between 1 and 300000', {
          tool: 'paper_download',
        })
      }
      const effectiveTimeout = timeoutMs ?? DEFAULT_TIMEOUT_MS
      const connector = deps.registry.get(db)
      if (connector === undefined) {
        const available = deps.registry.catalog().map(e => e.id).join(', ')
        throw new LiteratureToolError(
          'invalid_tool_input',
          `No database "${db}". Available: ${available || '(none registered)'}. Use paper_list_sources.`,
          { tool: 'paper_download' },
        )
      }
      const outputDir = resolveDir(args.outputDir, deps.cwd ?? process.cwd())
      await mkdir(outputDir, { recursive: true })

      // 1. Resolve the PDF link: explicit override, else the connector record's extra.
      const record = connector.fetch !== undefined ? await connector.fetch(id, { signal: exec.signal }) : null
      const resolved = pdfUrlFrom(record, args.pdfUrl)
      if ('error' in resolved) {
        return {
          db,
          id,
          result: { status: 'failed' as const, error: resolved.error },
          outputDir,
        }
      }

      const pdfUrl = resolved.pdfUrl
      // 2. Direct fetch first.
      const direct = await fetchPdfBody(pdfUrl, {
        signal: exec.signal,
        timeoutMs: effectiveTimeout,
        fetchImpl: deps.fetchImpl,
      })
      if (direct.ok) {
        const target = await writePdf(outputDir, id, direct.body)
        return { db, id, result: { status: 'ok' as const, path: target, pdfUrl, method: 'direct' as const }, outputDir }
      }

      // 3. Browser fallback: open the record page and extract the PDF link.
      const pageUrl = recordPageUrl(record)
      if (pageUrl === undefined) {
        return { db, id, result: { status: 'failed' as const, pdfUrl, error: `${direct.error}; no record page for browser extraction` }, outputDir }
      }
      const extracted = await extractor.extract(pageUrl, PDF_LINK_EXPR, {
        timeoutMs: effectiveTimeout,
        signal: exec.signal,
      })
      if (!extracted.ok || extracted.value === null) {
        return {
          db,
          id,
          result: { status: 'failed' as const, pdfUrl, error: `${direct.error}; browser extraction failed: ${extracted.ok ? 'no PDF link on the record page' : extracted.error}` },
          outputDir,
        }
      }
      const viaBrowser = await fetchPdfBody(extracted.value, {
        signal: exec.signal,
        timeoutMs: effectiveTimeout,
        fetchImpl: deps.fetchImpl,
      })
      if (viaBrowser.ok) {
        const target = await writePdf(outputDir, id, viaBrowser.body)
        return { db, id, result: { status: 'ok' as const, path: target, pdfUrl: extracted.value, method: 'browser' as const }, outputDir }
      }
      return { db, id, result: { status: 'failed' as const, pdfUrl: extracted.value, error: viaBrowser.error }, outputDir }
    },
  })
}

/** Strip path separators from a paper id used as a file name. */
function safeFileName(id: string): string {
  return id.replace(/[\\/]/g, '_')
}

/** Write a PDF body to `<dir>/<id>.pdf` and return the target path. */
async function writePdf(dir: string, id: string, body: Buffer): Promise<string> {
  const target = join(dir, `${safeFileName(id)}.pdf`)
  await writeFile(target, body)
  return target
}
