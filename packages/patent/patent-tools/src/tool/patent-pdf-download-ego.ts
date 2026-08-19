/**
 * ego-browser download adapter for `patent_pdf_download`: builds the
 * ego-browser heredoc script that opens each Google Patents page, extracts the
 * CDN PDF link, and attempts a browser-side download intercept, then runs it
 * over an injected `EgoBrowserSession` and maps the tagged JSON result back to
 * the tool's `EgoDownloadResult` vocabulary.
 *
 * The script is the port of Sati's buildDownloadScript: one task space per
 * call (`sati-patent-download`), per-patent try/catch, and a single
 * `EGO_DOWNLOAD:<json>` payload emitted via cliLog. Intercept success is
 * best-effort (depends on the ego-browser environment's download handling);
 * anything that cannot be saved by the browser is reported as a `fallback`
 * item carrying the extracted CDN URL, which the tool then fetches itself.
 * @module @deepseek-ai/dsh-patent-tools/tool/patent-pdf-download-ego
 */

import { PatentToolError } from '../error.ts'
import type { EgoDownloadItem, EgoDownloadRequest, EgoDownloadResult, RunEgo } from './patent-pdf-download.ts'

/** Task-space name for the patent PDF download space (sati-<domain>, matching EgoBrowserSession.taskSpaceName). */
const TASK_SPACE_DOMAIN = 'sati-patent-download'

/** One settled ego-browser script run, as the adapter consumes it. */
type EgoScriptRun = {
  output: string
  exitCode: number | null
  timedOut: boolean
}

/**
 * The ego-browser session surface the download adapter needs. EgoBrowserSession
 * satisfies it structurally; tests inject a fake with the same three methods.
 */
export type EgoSessionSeam = {
  /** Availability check; a non-ok verdict throws setup_required before any run. */
  checkAvailability: () => { ok: boolean; reason?: string }
  /** Run one script via stdin and return the collected output. */
  runScript: (script: string, options: { cwd: string; timeoutMs?: number; signal?: AbortSignal }) => Promise<EgoScriptRun>
  /** Parse the first EGO_<tag>:<json> line from the output. */
  extractTaggedJson: (output: string, tag: string) => unknown
}

/**
 * Build the ego-browser heredoc script for one batch download.
 * @param request - the validated download request.
 * @returns the script body to pass to `ego-browser nodejs` via stdin.
 */
export function buildDownloadScript(request: EgoDownloadRequest): string {
  const patents = JSON.stringify(request.patents)
  const outputDir = JSON.stringify(request.outputDir)
  const pageTimeoutSec = request.pageTimeoutSec
  const downloadTimeoutMs = request.downloadTimeoutMs
  const evidenceLines = request.record
    ? [
      '        if (saved) {',
      '          const shot = await cdp(\'Page.captureScreenshot\', { format: \'png\' })',
      '          if (shot && shot.data) { const p = outputDir + \'/evidence-\' + patent + \'.png\'; fs.writeFileSync(p, Buffer.from(shot.data, \'base64\')); evidence.push(p) }',
      '        }',
    ]
    : []
  const recordedLine = request.record
    ? '  if (evidence.length > 0) payload.recorded = outputDir + \'/evidence\''
    : undefined
  return [
    `const task = await useOrCreateTaskSpace('${TASK_SPACE_DOMAIN}')`,
    'try {',
    '  const items = []',
    ...(request.record ? ['  const evidence = []'] : []),
    `  const patents = ${patents}`,
    `  const outputDir = ${outputDir}`,
    '  for (const patent of patents) {',
    '    let pdfUrl = null',
    '    try {',
    `      await openOrReuseTab('https://patents.google.com/patent/' + patent + '/en', { wait: true, timeout: ${pageTimeoutSec} })`,
    '      pdfUrl = await js(String.raw`(() => { const a = document.querySelector(\'a[href*="patentimages.storage.googleapis.com"]\'); return a ? a.href : null })()`)',
    '      if (!pdfUrl) throw new Error(\'no CDN pdf link on page\')',
    '      await cdp(\'Page.setDownloadBehavior\', { behavior: \'allow\', downloadPath: outputDir })',
    '      await openOrReuseTab(pdfUrl, { wait: false })',
    '      const fs = await import(\'node:fs\')',
    '      const before = new Set(fs.readdirSync(outputDir))',
    `      const deadline = Date.now() + ${downloadTimeoutMs}`,
    '      let saved = null',
    '      while (Date.now() < deadline) {',
    '        const fresh = fs.readdirSync(outputDir).filter(f => !before.has(f) && !f.endsWith(\'.crdownload\') && !f.endsWith(\'.tmp\'))',
    '        if (fresh.length > 0) {',
    '          const src = outputDir + \'/\' + fresh[0]',
    '          const target = outputDir + \'/\' + patent + \'.pdf\'',
    '          if (src !== target) fs.renameSync(src, target)',
    '          saved = target',
    '          break',
    '        }',
    '        await wait(1)',
    '      }',
    '      if (saved) {',
    '        items.push({ patent, status: \'ok\', path: saved })',
    ...evidenceLines,
    '      } else {',
    '        items.push({ patent, status: \'fallback\', pdfUrl })',
    '      }',
    '    } catch (e) {',
    '      items.push({ patent, status: \'fallback\', pdfUrl, error: String(e && e.message || e) })',
    '    }',
    '  }',
    '  const payload = { items }',
    ...(recordedLine === undefined ? [] : [recordedLine]),
    '  cliLog(\'EGO_DOWNLOAD:\' + JSON.stringify(payload))',
    '} finally {',
    '  await completeTaskSpace(task.id, { keep: false })',
    '}',
  ].join('\n')
}

/**
 * Build the `runEgo` batch runner over one ego-browser session.
 * @param session - the ego-browser session (production: ctx.patentData.createEgoSession()).
 * @returns a `RunEgo` that runs the download script and parses the tagged result.
 */
export function createEgoDownloadRunner(session: EgoSessionSeam): RunEgo {
  return async (request: EgoDownloadRequest): Promise<EgoDownloadResult> => {
    const availability = session.checkAvailability()
    if (!availability.ok) {
      throw new PatentToolError(
        'setup_required',
        availability.reason ?? 'ego-browser 不可用；请先安装 ego lite 并完成首次引导。',
        { tool: 'patent_pdf_download' },
      )
    }
    let result: EgoScriptRun
    try {
      result = await session.runScript(buildDownloadScript(request), {
        cwd: request.outputDir,
        timeoutMs: request.timeoutMs,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
    } catch (error) {
      throw new PatentToolError(
        'tool_execution_failed',
        `ego-browser 启动失败：${error instanceof Error ? error.message : String(error)}`,
        { tool: 'patent_pdf_download' },
      )
    }
    if (result.timedOut) {
      throw new PatentToolError('tool_execution_failed', 'patent_pdf_download 超出 ego-browser 整体超时。', {
        tool: 'patent_pdf_download',
      })
    }
    const payload = session.extractTaggedJson(result.output, 'DOWNLOAD') as EgoDownloadResult | null
    if (payload === null || !Array.isArray(payload.items)) {
      const tail = result.output.slice(-400)
      throw new PatentToolError(
        'tool_execution_failed',
        `ego-browser 未返回可解析的下载结果（exit ${result.exitCode}）：${tail}`,
        { tool: 'patent_pdf_download' },
      )
    }
    const items: EgoDownloadItem[] = payload.items.map(item => ({
      patent: item.patent,
      status: item.status === 'ok' ? 'ok' : 'fallback',
      ...(item.path === undefined ? {} : { path: item.path }),
      ...(item.pdfUrl === undefined ? {} : { pdfUrl: item.pdfUrl }),
      ...(item.error === undefined ? {} : { error: item.error }),
    }))
    return { items, ...(payload.recorded === undefined ? {} : { recorded: payload.recorded }) }
  }
}
