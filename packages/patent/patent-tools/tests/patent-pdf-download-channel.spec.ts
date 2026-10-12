// Late-bound download channel: the ego channel resolves ctx.patentData per call
// (patent-data declares inject:['subprocess'], so it activates after a
// tools-only consumer), and a host without a usable browser continues on the
// browser-free scrape channel.
import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { ScrapeResult } from '@deepseek-ai/nuo-patent'
import PatentData from '@deepseek-ai/dsh-patent-data'
import { PatentToolError } from '../src/error.ts'
import { createDownloadChannelRunner, createScrapeChannelRunner } from '../src/tool/patent-pdf-download-channel.ts'
import type { PatentDataSeam } from '../src/tool/patent-pdf-download-channel.ts'
import { CNIPR_CHANNEL, GOOGLE_PATENTS_CHANNEL } from '../src/tool/internal/upstream-channel.ts'
import type { EgoDownloadRequest } from '../src/tool/patent-pdf-download.ts'
import type { EgoSessionSeam } from '../src/tool/patent-pdf-download-ego.ts'
import type { CniprChannel, CniprPdfLinkItem } from '@deepseek-ai/dsh-patent-data'

// The default scrape seam is the LRU-cached nuo scrape; stub the engine call so
// the dependency-free path stays off the network.
const nuo = vi.hoisted(() => ({ scrapePatent: vi.fn() }))
vi.mock('@deepseek-ai/nuo-patent', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  scrapePatent: nuo.scrapePatent,
}))

const request: EgoDownloadRequest = {
  patents: ['US1A'],
  outputDir: '/tmp/patent-pdf-channel',
  pageTimeoutSec: 20,
  downloadTimeoutMs: 1_000,
  record: false,
  timeoutMs: 1_000,
}

const CDN_URL = 'https://patentimages.storage.googleapis.com/ab/cd/US1A.pdf'

/** One nuo scrape result; `pdfUrl` null models a page without a CDN link. */
function scrapeResult(pdfUrl: string | null, errorMessage = ''): ScrapeResult {
  return {
    success: pdfUrl !== null,
    patent: 'US1A',
    url: 'https://patents.google.com/patent/US1A/en',
    data: pdfUrl === null ? null : ({ pdf_url: pdfUrl } as unknown as NonNullable<ScrapeResult['data']>),
    errorCode: pdfUrl === null ? 'PARSE_ERROR' : '',
    errorMessage,
    parseWarnings: [],
  }
}

/** Patent-data stand-in exposing only the surface the channel reads. */
function patentDataWith(session: EgoSessionSeam, cnipr?: Pick<CniprChannel, 'pdfLinks'>): PatentDataSeam {
  return { createEgoSession: () => session, createCniprChannel: () => cnipr }
}

function egoSession(overrides: Partial<EgoSessionSeam> = {}): EgoSessionSeam {
  return {
    checkAvailability: () => ({ ok: true }),
    runScript: async () => ({
      output: 'EGO_DOWNLOAD:{"items":[{"patent":"US1A","status":"ok","path":"/tmp/US1A.pdf"}]}',
      exitCode: 0,
      timedOut: false,
    }),
    extractTaggedJson: output => JSON.parse(output.slice(output.indexOf('EGO_DOWNLOAD:') + 'EGO_DOWNLOAD:'.length)) as unknown,
    ...overrides,
  }
}

describe('createScrapeChannelRunner', () => {
  it('reports the scraped CDN link as a fallback item', async () => {
    const runner = createScrapeChannelRunner({ scrape: async () => scrapeResult(CDN_URL) })
    const result = await runner(request)
    expect(result.items).toEqual([{ patent: 'US1A', status: 'fallback', pdfUrl: CDN_URL, channel: GOOGLE_PATENTS_CHANNEL }])
  })

  it('reports the scrape failure without a pdfUrl', async () => {
    const runner = createScrapeChannelRunner({ scrape: async () => scrapeResult(null, 'HTTP 503') })
    const result = await runner(request)
    expect(result.items).toEqual([{
      patent: 'US1A', status: 'fallback', error: 'HTTP 503', channel: GOOGLE_PATENTS_CHANNEL,
    }])
  })

  it('names a page without a CDN link', async () => {
    const runner = createScrapeChannelRunner({ scrape: async () => scrapeResult(null) })
    const result = await runner(request)
    expect(result.items[0]?.error).toContain('未在页面中找到 CDN PDF 链接')
  })

  it('names a page whose CDN link is empty', async () => {
    const runner = createScrapeChannelRunner({ scrape: async () => scrapeResult('') })
    const result = await runner(request)
    expect(result.items[0]?.error).toContain('未在页面中找到 CDN PDF 链接')
  })

  it('defaults to the cached nuo scrape', async () => {
    nuo.scrapePatent.mockResolvedValueOnce(scrapeResult(CDN_URL))
    const runner = createScrapeChannelRunner()
    const result = await runner(request)
    expect(result.items[0]?.pdfUrl).toBe(CDN_URL)
    expect(nuo.scrapePatent).toHaveBeenCalledWith('US1A', { returnAbstract: false, returnLegal: false })
  })
})

describe('createDownloadChannelRunner', () => {
  it('uses the ego channel when the service is present', async () => {
    const runner = createDownloadChannelRunner(() => patentDataWith(egoSession()), {
      scrape: async () => scrapeResult(null, 'scrape must not run'),
    })
    const result = await runner(request)
    expect(result.items).toEqual([{
      patent: 'US1A', status: 'ok', path: '/tmp/US1A.pdf', channel: GOOGLE_PATENTS_CHANNEL,
    }])
  })

  it('serves China publication numbers from CNIPR and leaves the rest to Google Patents', async () => {
    const cniprRequest = vi.fn(async (): Promise<CniprPdfLinkItem[]> => [
      { number: 'CN122072823A', urls: ['http://pic.cnipr.com/pdfcn/a/PDF_PID/x.PDF'], unexamined: true, authorized: false },
    ])
    const runner = createDownloadChannelRunner(() => patentDataWith(egoSession(), { pdfLinks: cniprRequest }), {
      scrape: async () => scrapeResult(null, 'scrape must not run'),
    })

    const result = await runner({ ...request, patents: ['CN122072823A', 'US1A'] })

    expect(result.items).toEqual([
      { patent: 'CN122072823A', status: 'fallback', pdfUrl: 'http://pic.cnipr.com/pdfcn/a/PDF_PID/x.PDF', channel: CNIPR_CHANNEL },
      { patent: 'US1A', status: 'ok', path: '/tmp/US1A.pdf', channel: GOOGLE_PATENTS_CHANNEL },
    ])
    expect(result.warnings).toEqual([])
    // 只有中国公开号进 CNIPR 段，非中国号直接走 Google 腿。
    expect(cniprRequest).toHaveBeenCalledWith(['CN122072823A'], expect.anything())
  })

  it('notes a number CNIPR could not serve and lets Google Patents take it', async () => {
    const cniprRequest = vi.fn(async (): Promise<CniprPdfLinkItem[]> => [
      { number: 'CN122072823A', urls: [], unexamined: false, authorized: false, error: '检索不到该号' },
    ])
    // 浏览器不可用：Google 腿落到无浏览器的 scrape 通道，按请求逐篇回报。
    const unavailable = egoSession({ checkAvailability: () => ({ ok: false, reason: 'ego lite not installed' }) })
    const runner = createDownloadChannelRunner(() => patentDataWith(unavailable, { pdfLinks: cniprRequest }), {
      scrape: async () => scrapeResult(CDN_URL),
    })

    const result = await runner({ ...request, patents: ['CN122072823A'] })

    expect(result.items).toEqual([{ patent: 'CN122072823A', status: 'fallback', pdfUrl: CDN_URL, channel: GOOGLE_PATENTS_CHANNEL }])
    expect(result.warnings).toEqual([
      `CNIPR 通道未取到 CN122072823A 的全文直链（检索不到该号），该篇改走 ${GOOGLE_PATENTS_CHANNEL}`,
    ])
  })

  it('reports an unusable CNIPR channel and still downloads through Google Patents', async () => {
    const failing: Pick<CniprChannel, 'pdfLinks'> = {
      pdfLinks: async () => { throw new Error('CNIPR 通道失败（login_required）：未检测到 CNIPR 登录态') },
    }
    const unavailable = egoSession({ checkAvailability: () => ({ ok: false, reason: 'ego lite not installed' }) })
    const runner = createDownloadChannelRunner(() => patentDataWith(unavailable, failing), {
      scrape: async () => scrapeResult(CDN_URL),
    })

    const result = await runner({ ...request, patents: ['CN122072823A'] })

    expect(result.items).toEqual([{ patent: 'CN122072823A', status: 'fallback', pdfUrl: CDN_URL, channel: GOOGLE_PATENTS_CHANNEL }])
    expect(result.warnings?.[0]).toContain('CNIPR 通道不可用')
    expect(result.warnings?.[0]).toContain('未检测到 CNIPR 登录态')
  })

  it('skips the CNIPR leg while the deployment leaves the channel disabled', async () => {
    // createCniprChannel() 返回 undefined 就是「本部署没打开这条通道」：中国号与其它号一样走 Google 腿。
    const unavailable = egoSession({ checkAvailability: () => ({ ok: false, reason: 'ego lite not installed' }) })
    const runner = createDownloadChannelRunner(() => patentDataWith(unavailable, undefined), {
      scrape: async () => scrapeResult(CDN_URL),
    })

    const result = await runner({ ...request, patents: ['CN122072823A'] })

    expect(result.items).toEqual([{
      patent: 'CN122072823A', status: 'fallback', pdfUrl: CDN_URL, channel: GOOGLE_PATENTS_CHANNEL,
    }])
    expect(result.warnings).toEqual([])
  })

  it('falls back to the scrape channel when the service is absent', async () => {
    const runner = createDownloadChannelRunner(() => undefined, { scrape: async () => scrapeResult(CDN_URL) })
    const result = await runner(request)
    expect(result.items[0]?.pdfUrl).toBe(CDN_URL)
  })

  it('falls back to the scrape channel when the browser is unusable', async () => {
    const session = egoSession({ checkAvailability: () => ({ ok: false, reason: 'ego lite not installed' }) })
    const runner = createDownloadChannelRunner(() => patentDataWith(session), {
      scrape: async () => scrapeResult(CDN_URL),
    })
    const result = await runner(request)
    expect(result.items[0]?.pdfUrl).toBe(CDN_URL)
  })

  it('propagates ego failures that are not setup problems', async () => {
    const session = egoSession({
      runScript: async () => {
        throw new Error('spawn boom')
      },
    })
    const runner = createDownloadChannelRunner(() => patentDataWith(session), { scrape: async () => scrapeResult(CDN_URL) })
    await expect(runner(request)).rejects.toBeInstanceOf(PatentToolError)
  })
})

describe('patent-data activation order', () => {
  /** Minimal `tools` provider so the consumer can declare the preset's inject list. */
  class FakeTools extends Service {
    constructor(ctx: Context) {
      super(ctx, 'tools')
    }
  }

  /** Minimal `subprocess` provider: patent-data only needs the service name. */
  class FakeSubprocess extends Service {
    constructor(ctx: Context) {
      super(ctx, 'subprocess')
    }
  }

  it('resolves the service in a consumer that reads it after activation', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeTools)
    ctx.plugin(FakeSubprocess)
    ctx.plugin(PatentData)

    const seen: Array<PatentData | undefined> = []
    ctx.plugin({
      name: 'channel-probe',
      inject: ['tools'],
      apply(scope) {
        seen.push(scope.get('patentData'))
        // The preset's row order activates patent-data one dependency hop later.
        setTimeout(() => seen.push(scope.get('patentData')), 0)
      },
    })
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(seen[0]).toBeUndefined()
    expect(seen[1]).toBeInstanceOf(PatentData)
    await ctx.fiber.dispose()
  })
})
