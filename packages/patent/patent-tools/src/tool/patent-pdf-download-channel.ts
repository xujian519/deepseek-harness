/**
 * Late-bound download channel for `patent_pdf_download`.
 *
 * The ego channel comes from `ctx.patentData`, whose plugin declares
 * `inject: ['subprocess']` and therefore activates one dependency hop after a
 * consumer that only injects `['tools']` — the shipped preset row order. Reading
 * the service during `apply()` loses it in every such composition, so
 * {@link createDownloadChannelRunner} resolves it per call and falls back to a
 * browser-free page scrape that yields the CDN URL for the tool's own fetch
 * fallback. The scrape channel relies on the scrape's own request timeout: the
 * LRU-cached scrape seam accepts neither a per-call timeout nor an abort signal.
 * @module @deepseek-ai/dsh-patent-tools/tool/patent-pdf-download-channel
 */

import { scrapePatent as scrapePatentImpl } from '@deepseek-ai/nuo-patent'
import type { ScrapeResult } from '@deepseek-ai/nuo-patent'
import { cachedScrapePatent } from '@deepseek-ai/dsh-patent-data'
import type { PatentData } from '@deepseek-ai/dsh-patent-data'
import { PatentToolError } from '../error.ts'
import type { EgoDownloadItem, EgoDownloadRequest, EgoDownloadResult, RunEgo } from './patent-pdf-download.ts'
import { createEgoDownloadRunner } from './patent-pdf-download-ego.ts'

/**
 * Late-bound lookup for the patent-data service. Production passes
 * `() => ctx.get('patentData')`; a lookup that captures the service during
 * `apply()` freezes whatever the sibling row had published by then.
 * @returns the service, or undefined while it is not mounted in the caller's scope.
 */
export type PatentDataLookup = () => PatentData | undefined

/** Page-scrape seam for the browser-free channel (production: the LRU-cached nuo scrape). */
export type PatentScrape = (
  patent: string,
  options?: { returnAbstract?: boolean; returnLegal?: boolean },
) => Promise<ScrapeResult>

/** Injected dependencies of the browser-free channel. */
export type DownloadChannelDeps = {
  /** Scrape implementation; defaults to the LRU-cached nuo scrape. */
  scrape?: PatentScrape
}

/**
 * Build the browser-free channel: scrape each patent page for its CDN PDF link
 * and report it as a `fallback` item, which the tool's fetch fallback downloads.
 * Used when the ego service is absent and when its browser is unusable.
 * @param deps - optional scrape injection.
 * @returns a batch runner producing one `fallback` item per patent.
 */
export function createScrapeChannelRunner(deps: DownloadChannelDeps = {}): RunEgo {
  const scrape = deps.scrape ?? cachedScrapePatent(scrapePatentImpl)
  return async (request: EgoDownloadRequest): Promise<EgoDownloadResult> => {
    const items = await Promise.all(request.patents.map(async (patent): Promise<EgoDownloadItem> => {
      const result = await scrape(patent, { returnAbstract: false, returnLegal: false })
      const pdfUrl = result.data?.pdf_url
      if (result.success && typeof pdfUrl === 'string' && pdfUrl.length > 0) {
        return { patent, status: 'fallback', pdfUrl }
      }
      return {
        patent,
        status: 'fallback',
        error: result.errorMessage || `未在页面中找到 CDN PDF 链接：${patent}`,
      }
    }))
    return { items }
  }
}

/**
 * Build the `patent_pdf_download` batch runner over a late-bound patent-data
 * lookup. The ego channel is used whenever the service is present and its
 * browser is usable; otherwise the batch continues through the browser-free
 * scrape channel instead of failing outright.
 * @param lookup - late-bound patent-data lookup (production: `() => ctx.get('patentData')`).
 * @param deps - optional scrape injection for the browser-free channel.
 * @returns the batch runner to inject into the tool.
 */
export function createDownloadChannelRunner(
  lookup: PatentDataLookup,
  deps: DownloadChannelDeps = {},
): RunEgo {
  const scrapeRunner = createScrapeChannelRunner(deps)
  return async (request: EgoDownloadRequest): Promise<EgoDownloadResult> => {
    const patentData = lookup()
    if (patentData === undefined) return scrapeRunner(request)
    try {
      return await createEgoDownloadRunner(patentData.createEgoSession())(request)
    } catch (error) {
      // 浏览器不可用（未安装 ego lite / 首次引导未完成）属可预期环境差异：退回无浏览器通道，
      // 其余错误（超时、脚本失败）保持 fail-loud，避免把真实故障伪装成降级成功。
      if (error instanceof PatentToolError && error.code === 'setup_required') return scrapeRunner(request)
      throw error
    }
  }
}
