/**
 * browser-use download channel for `patent_pdf_download`: a `RunEgo`-compatible
 * batch runner that extracts each Google Patents CDN PDF link through the
 * browser-use extractor and reports every patent as a `fallback` item carrying
 * the link, so the tool's existing fetch fallback downloads and verifies it.
 * Complements the ego-browser download-intercept channel; the tool's cold
 * decision picks one of them per task.
 * @module @deepseek-ai/dsh-patent-tools/tool/patent-pdf-download-browser-use
 */

import { BrowserUseExtractor } from '@deepseek-ai/dsh-browser-backend'
import type { EgoDownloadItem, EgoDownloadRequest, EgoDownloadResult, RunEgo } from './patent-pdf-download.ts'

/** JS expression yielding the first Google Patents CDN PDF link on the page. */
const CDN_LINK_EXPR = '(() => { const a = document.querySelector(\'a[href*="patentimages.storage.googleapis.com"]\'); return a ? a.href : null })()'

/**
 * Build the browser-use download runner over an extractor.
 * @param extractor - the browser-use extractor (production: a BrowserUseExtractor).
 * @returns a `RunEgo` that maps per-patent extraction into fallback items.
 */
export function createBrowserUseDownloadRunner(extractor: BrowserUseExtractor): RunEgo {
  return async (request: EgoDownloadRequest): Promise<EgoDownloadResult> => {
    const items: EgoDownloadItem[] = []
    for (const patent of request.patents) {
      if (request.signal?.aborted === true) break
      const pageUrl = `https://patents.google.com/patent/${patent}/en`
      const result = await extractor.extract(pageUrl, CDN_LINK_EXPR, {
        timeoutMs: request.pageTimeoutSec * 1_000,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
      if (!result.ok) {
        items.push({ patent, status: 'fallback', error: result.error })
      } else if (result.value !== null) {
        items.push({ patent, status: 'fallback', pdfUrl: result.value })
      } else {
        items.push({ patent, status: 'fallback', error: 'no CDN pdf link on page' })
      }
    }
    return { items }
  }
}
