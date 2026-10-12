// CNIPR 通道：可用性与期限的分类、收据缺失的收敛、号码级结果的对齐，以及
// 会话选项（cwd / 期限 / 取消信号）的透传。
import { describe, expect, it } from 'vitest'
import { CniprChannel, CniprChannelError } from '@deepseek-ai/dsh-patent-data'
import type { CniprEgoSession } from '@deepseek-ai/dsh-patent-data'

/** 一次脚本运行的记录：断言通道传给会话的脚本体与选项。 */
type ScriptRun = { script: string; options: { cwd: string; timeoutMs?: number; signal?: AbortSignal } }

/** 回放固定输出的假会话，并记录每次运行；`output` 由各处用例给出。 */
function fakeSession(output: string, overrides: Partial<CniprEgoSession> = {}): { session: CniprEgoSession; runs: ScriptRun[] } {
  const runs: ScriptRun[] = []
  const session: CniprEgoSession = {
    checkAvailability: () => ({ ok: true }),
    runScript: async (script, options) => {
      runs.push({ script, options })
      return { output, exitCode: 0, timedOut: false }
    },
    extractTaggedJson: (raw: string, tag: string): unknown => {
      const prefix = `EGO_${tag}:`
      const idx = raw.indexOf(prefix)
      if (idx < 0) return null
      return JSON.parse(raw.slice(idx + prefix.length))
    },
    ...overrides,
  }
  return { session, runs }
}

function tagged(tag: string, payload: unknown): string {
  return `unrelated\nEGO_${tag}:${JSON.stringify(payload)}\n`
}

describe('CniprChannel.pdfLinks', () => {
  it('maps reported links, keeps request order, and marks unreported numbers', async () => {
    const { session, runs } = fakeSession(tagged('CNIPR_PDFLINKS', {
      items: [
        { number: 'CN122072823A', matches: ['pic.cnipr.com/pdfcn/a/PDF_PID/x.PDF'], isUnexamined: true, isAuthorized: false },
      ],
    }))
    const channel = new CniprChannel({ session })

    const items = await channel.pdfLinks(['CN122072823A', 'CN100000000A'])

    expect(items).toEqual([
      { number: 'CN122072823A', urls: ['http://pic.cnipr.com/pdfcn/a/PDF_PID/x.PDF'], unexamined: true, authorized: false },
      { number: 'CN100000000A', urls: [], unexamined: false, authorized: false, error: '脚本未回报该号' },
    ])
    expect(runs[0]?.script).toContain('"CN122072823A"')
  })

  it('does not run a script when no number has the publication-number form', async () => {
    const { session, runs } = fakeSession('')
    const channel = new CniprChannel({ session })

    expect(await channel.pdfLinks(['202311356097.5', 'US11452699B2'])).toEqual([
      { number: '202311356097.5', urls: [], unexamined: false, authorized: false, error: 'CNIPR 通道只处理公开(公告)号' },
      { number: 'US11452699B2', urls: [], unexamined: false, authorized: false, error: 'CNIPR 通道只处理公开(公告)号' },
    ])
    expect(runs).toEqual([])
  })

  it('throws the script-level failure class instead of returning partial links', async () => {
    const { session } = fakeSession(tagged('CNIPR_PDFLINKS', { items: [], error: { code: 'login_required', message: '未检测到 CNIPR 登录态' } }))
    const channel = new CniprChannel({ session })

    await expect(channel.pdfLinks(['CN122072823A'])).rejects.toThrow(CniprChannelError)
    await expect(channel.pdfLinks(['CN122072823A'])).rejects.toMatchObject({
      code: 'login_required',
      detail: '未检测到 CNIPR 登录态',
    })
  })
})

describe('CniprChannel.legalStatus', () => {
  it('queries application numbers directly and publication numbers through resolution', async () => {
    const { session, runs } = fakeSession(tagged('CNIPR_LEGAL', {
      items: [
        { number: '2023113560975', appNumber: '202311356097.5', text: '共 1 条记录 申请号：202311356097.5 法律状态公告日：2023.12.29 法律状态：公开 法律状态信息：公开' },
      ],
    }))
    const channel = new CniprChannel({ session })

    const items = await channel.legalStatus(['2023113560975', 'CN122072823A'])

    expect(items[0]).toEqual({
      number: '2023113560975',
      appNumber: '202311356097.5',
      total: 1,
      records: [{ app_number: '202311356097.5', announce_date: '2023.12.29', status: '公开', status_info: '公开' }],
    })
    expect(items[1]).toEqual({
      number: 'CN122072823A',
      appNumber: '',
      total: null,
      records: [],
      error: '脚本未回报该号',
    })
    const script = runs[0]?.script ?? ''
    expect(script).toContain('"appNumber":"202311356097.5"')
    expect(script).toContain('"pubNumber":"CN122072823A"')
  })

  it('does not run a script when no number is a Chinese application or publication number', async () => {
    const { session, runs } = fakeSession('')
    const channel = new CniprChannel({ session })

    expect(await channel.legalStatus(['US11452699B2'])).toEqual([
      { number: 'US11452699B2', appNumber: '', total: null, records: [], error: 'CNIPR 通道只处理中国申请号与公开(公告)号' },
    ])
    expect(runs).toEqual([])
  })

  it('throws the script-level failure class', async () => {
    const { session } = fakeSession(tagged('CNIPR_LEGAL', { items: [], error: { code: 'page_state', message: '等法律状态结果渲染失败' } }))
    const channel = new CniprChannel({ session })

    await expect(channel.legalStatus(['CN122072823A'])).rejects.toMatchObject({
      code: 'page_state',
      detail: '等法律状态结果渲染失败',
    })
  })
})

describe('CniprChannel run gating', () => {
  it('fails loud with setup_required when ego-browser is not usable', async () => {
    const { session } = fakeSession('', { checkAvailability: () => ({ ok: false, reason: '未安装 ego lite' }) })
    const channel = new CniprChannel({ session })

    await expect(channel.pdfLinks(['CN122072823A'])).rejects.toMatchObject({
      code: 'setup_required',
      detail: '未安装 ego lite',
      message: 'CNIPR 通道失败（setup_required）：未安装 ego lite',
    })
  })

  it('reports a missing reason as setup guidance', async () => {
    const { session } = fakeSession('', { checkAvailability: () => ({ ok: false }) })
    const channel = new CniprChannel({ session })

    await expect(channel.pdfLinks(['CN122072823A'])).rejects.toMatchObject({ code: 'setup_required' })
  })

  it('classifies an over-deadline run as a timeout', async () => {
    const { session } = fakeSession('', {
      runScript: async () => ({ output: 'partial', exitCode: null, timedOut: true }),
    })

    await expect(new CniprChannel({ session }).pdfLinks(['CN122072823A'])).rejects.toMatchObject({
      code: 'timeout',
      detail: 'CNIPR 脚本超出期限（exit null）',
    })
  })

  it('reports a run that never printed a receipt, with the output tail', async () => {
    const { session } = fakeSession('ego-browser: no such task space')
    const channel = new CniprChannel({ session })

    await expect(channel.pdfLinks(['CN122072823A'])).rejects.toMatchObject({
      code: 'receipt_missing',
      detail: '脚本未回传 CNIPR_PDFLINKS 收据（exit 0）：ego-browser: no such task space',
    })
  })

  it('reports a receipt the session could not parse', async () => {
    const { session } = fakeSession('EGO_CNIPR_PDFLINKS:{not json}', {
      extractTaggedJson: () => undefined,
      runScript: async () => ({ output: 'ego-browser exited', exitCode: null, timedOut: false }),
    })
    const channel = new CniprChannel({ session })

    await expect(channel.pdfLinks(['CN122072823A'])).rejects.toMatchObject({
      code: 'receipt_missing',
      detail: '脚本未回传 CNIPR_PDFLINKS 收据（exit null）：ego-browser exited',
    })
  })

  it('passes the configured directory, deadline, and cancellation signal through', async () => {
    const { session, runs } = fakeSession(tagged('CNIPR_PDFLINKS', { items: [] }))
    const channel = new CniprChannel({ session, cwd: '/tmp/cnipr', timeoutMs: 123_000 })
    const controller = new AbortController()

    await channel.pdfLinks(['CN122072823A'], { timeoutMs: 45_000, signal: controller.signal })

    expect(runs[0]?.options).toEqual({ cwd: '/tmp/cnipr', timeoutMs: 45_000, signal: controller.signal })
    await channel.pdfLinks(['CN122072823A'])
    expect(runs[1]?.options).toEqual({ cwd: '/tmp/cnipr', timeoutMs: 123_000 })
  })

  it('defaults the script directory to the process working directory', async () => {
    const { session, runs } = fakeSession(tagged('CNIPR_PDFLINKS', { items: [] }))

    await new CniprChannel({ session }).pdfLinks(['CN122072823A'])

    expect(runs[0]?.options).toMatchObject({ cwd: process.cwd() })
  })
})

describe('CniprChannel.search', () => {
  const rowText = '申请号： CN201922356571.X 公开(公告)号： CN211350734U 公开(公告)日： 2020.08.25 '
    + '申请(专利权)人： 上海碳源汇谷新材料科技有限公司 分类号： H01M2/10(2006.01) 摘要：本实用新型属于石墨烯电池技术领域。 机器翻译'
  const searchPayload = {
    header: '全部655件专利',
    items: [
      { cursor: 0, number: 'CN211350734U', title: '一种稳定性高的石墨烯电池', text: rowText },
      { cursor: 1, number: 'CN110611065A', title: '一种电动自行车高体积能量的易更换石墨烯电池', text: rowText },
    ],
  }

  it('reads the result page rows and the page total in one run', async () => {
    const { session, runs } = fakeSession(tagged('CNIPR_SEARCH', searchPayload))
    const channel = new CniprChannel({ session })

    const result = await channel.search('石墨烯电池')

    expect(result.total).toBe(655)
    expect(result.hits).toEqual([
      {
        patent: 'CN211350734U',
        title: '一种稳定性高的石墨烯电池',
        assignee: '上海碳源汇谷新材料科技有限公司',
        publicationDate: '2020-08-25',
        abstract: '本实用新型属于石墨烯电池技术领域。',
      },
      {
        patent: 'CN110611065A',
        title: '一种电动自行车高体积能量的易更换石墨烯电池',
        assignee: '上海碳源汇谷新材料科技有限公司',
        publicationDate: '2020-08-25',
        abstract: '本实用新型属于石墨烯电池技术领域。',
      },
    ])
    // 结果页自带全部字段，因此一次检索只跑一个脚本。
    expect(runs).toHaveLength(1)
    expect(runs[0]?.script).toContain('"石墨烯电池"')
    expect(runs[0]?.script).toContain('const pages = 1')
  })

  it('plans the page count from the requested limit and truncates to it', async () => {
    const { session, runs } = fakeSession(tagged('CNIPR_SEARCH', searchPayload))
    const channel = new CniprChannel({ session })

    const result = await channel.search('石墨烯电池', { limit: 1 })

    expect(result.hits).toHaveLength(1)
    expect(runs[0]?.script).toContain('const pages = 1')

    await channel.search('石墨烯电池', { limit: 25 })
    expect(runs[1]?.script).toContain('const pages = 3')
  })

  it('fails loud when the page stops publishing the result total', async () => {
    const { session } = fakeSession(tagged('CNIPR_SEARCH', { header: null, items: [] }))
    const channel = new CniprChannel({ session })

    await expect(channel.search('石墨烯电池')).rejects.toMatchObject({ code: 'page_state' })
  })

  it('classifies a script-level failure and a missing receipt', async () => {
    const login = fakeSession(tagged('CNIPR_SEARCH', { items: [], error: { code: 'login_required', message: '未检测到 CNIPR 登录态' } }))
    await expect(new CniprChannel({ session: login.session }).search('q'))
      .rejects.toMatchObject({ code: 'login_required', detail: '未检测到 CNIPR 登录态' })

    const empty = fakeSession('unrelated output')
    await expect(new CniprChannel({ session: empty.session }).search('q'))
      .rejects.toMatchObject({ code: 'receipt_missing' })
  })
})
