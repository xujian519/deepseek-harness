// CNIPR 脚本生成：驱动页面的关键步骤必须出现在脚本体里，且参数内嵌（ego 只从 stdin
// 收脚本、不继承环境变量、不接受 argv，故包内不使用部署技能的请求文件协议）。
import { describe, expect, it } from 'vitest'
import {
  CNIPR_LEGAL_TAG,
  CNIPR_PDF_TAG,
  CNIPR_SEARCH_TAG,
  CNIPR_TASK_SPACE,
  DEFAULT_CNIPR_PAGE_BUDGETS,
  buildCniprLegalScript,
  buildCniprPdfLinksScript,
  buildCniprSearchScript,
} from '@deepseek-ai/dsh-patent-data'
import type { CniprPageBudgets } from '@deepseek-ai/dsh-patent-data'

/** Constructor shape for compiling a script body that contains top-level await. */
type AsyncFunctionConstructor = new (body: string) => (...args: unknown[]) => Promise<unknown>

const AsyncFunction = (async function () {}).constructor as AsyncFunctionConstructor

describe('generated script bodies', () => {
  it('compile as JavaScript before they reach ego-browser', () => {
    const bodies = [
      buildCniprPdfLinksScript(['CN122072823A']),
      buildCniprLegalScript([{ number: 'CN122072823A', pubNumber: 'CN122072823A' }]),
      buildCniprSearchScript('石墨烯 "quoted" \\ backslash', 3),
    ]
    for (const body of bodies) expect(() => new AsyncFunction(body)).not.toThrow()
  })
})

describe('page budgets', () => {
  const budgets: CniprPageBudgets = {
    loginPollMs: 250,
    loginAttempts: 3,
    loginRounds: 1,
    navigationTimeoutMs: 12_000,
    actionTimeoutMs: 4_000,
    resultTimeoutMs: 5_000,
    renderTimeoutMs: 6_000,
    detailTimeoutMs: 7_000,
  }

  const scripts = (values: CniprPageBudgets): string[] => [
    buildCniprPdfLinksScript(['CN122072823A'], values),
    buildCniprLegalScript([{ number: '2023113560975', appNumber: '202311356097.5' }], values),
    buildCniprSearchScript('石墨烯电池', 1, values),
  ]

  it('ships the measured waits as the defaults', () => {
    for (const script of scripts(DEFAULT_CNIPR_PAGE_BUDGETS)) {
      expect(script).toContain(`const LOGIN_POLL_MS = ${DEFAULT_CNIPR_PAGE_BUDGETS.loginPollMs}`)
      expect(script).toContain(`const LOGIN_ATTEMPTS = ${DEFAULT_CNIPR_PAGE_BUDGETS.loginAttempts}`)
      expect(script).toContain(`const LOGIN_ROUNDS = ${DEFAULT_CNIPR_PAGE_BUDGETS.loginRounds}`)
      expect(script).toContain(`const NAVIGATION_TIMEOUT_MS = ${DEFAULT_CNIPR_PAGE_BUDGETS.navigationTimeoutMs}`)
      expect(script).toContain(`const ACTION_TIMEOUT_MS = ${DEFAULT_CNIPR_PAGE_BUDGETS.actionTimeoutMs}`)
      expect(script).toContain(`const RESULT_TIMEOUT_MS = ${DEFAULT_CNIPR_PAGE_BUDGETS.resultTimeoutMs}`)
      expect(script).toContain(`const RENDER_TIMEOUT_MS = ${DEFAULT_CNIPR_PAGE_BUDGETS.renderTimeoutMs}`)
      expect(script).toContain(`const DETAIL_TIMEOUT_MS = ${DEFAULT_CNIPR_PAGE_BUDGETS.detailTimeoutMs}`)
    }
  })

  it('embeds non-default waits in every generated script', () => {
    for (const script of scripts(budgets)) {
      expect(script).toContain('const LOGIN_POLL_MS = 250')
      expect(script).toContain('const LOGIN_ATTEMPTS = 3')
      expect(script).toContain('const LOGIN_ROUNDS = 1')
      expect(script).toContain('const NAVIGATION_TIMEOUT_MS = 12000')
      expect(script).toContain('const ACTION_TIMEOUT_MS = 4000')
      expect(script).toContain('const RESULT_TIMEOUT_MS = 5000')
      expect(script).toContain('const RENDER_TIMEOUT_MS = 6000')
      expect(script).toContain('const DETAIL_TIMEOUT_MS = 7000')
      // 单轮配置不再 reload 首页；多轮时只在轮间 reload。
      expect(script).toContain('if (round < LOGIN_ROUNDS - 1)')
      expect(script).not.toContain('45000')
    }
    // 详情 XHR 的失败文案跟随配置，而不是写死秒数。
    expect(scripts(budgets)[0]).toContain("'详情检索 ' + DETAIL_TIMEOUT_MS + ' 毫秒未返回'")
  })
})

describe('buildCniprPdfLinksScript', () => {
  it('embeds the numbers, the task space, and the login gate', () => {
    const script = buildCniprPdfLinksScript(['CN122072823A', 'CN100000000A'])
    expect(script).toContain(`taskSpace("${CNIPR_TASK_SPACE}")`)
    expect(script).toContain('"CN122072823A"')
    expect(script).toContain('"CN100000000A"')
    expect(script).toContain('http://search.cnipr.com')
    expect(script).toContain('欢迎您')
    // 页头晚于搜索框渲染，只等「欢迎您」，等不到即报登录态失效（可操作的失败）。
    expect(script).toContain("cniprCode: 'login_required'")
    expect(script).toContain(`EGO_${CNIPR_PDF_TAG}:`)
  })

  it('searches by number and reads the full-text link out of the detail response', () => {
    const script = buildCniprPdfLinksScript(['CN122072823A'])
    expect(script).toContain("page.fill('input[name=\"q\"]', number, { clearFirst: true })")
    expect(script).toContain("page.click('#search-btn'")
    expect(script).toContain('/doOverviewSearch4Index/')
    expect(script).toContain('#detailSearch')
    expect(script).toContain("'/search!doDetailSearch.action'")
    // 直链模式以 JSON 内嵌（反斜杠随之转义），断言片段避开转义差异。
    expect(script).toContain('pdfcn')
    expect(script).toContain('.PDF')
    expect(script).toContain('Unexamined_patent')
    expect(script).toContain('Authorized_patent')
  })

  it('keeps one bad number from ending the batch and never finishes the shared task space', () => {
    const script = buildCniprPdfLinksScript(['CN122072823A'])
    // 逐号 try/catch：单号失败记进条目，同批其余号继续。
    expect(script).toContain('items.push({ number, error: failureOf(error, \'page_state\').message })')
    // 不 finish：按名复用的任务空间要保留下一次调用的登录态与标签页。
    expect(script).not.toContain('task.finish')
  })
})

describe('buildCniprLegalScript', () => {
  it('embeds the queries and shares the login gate', () => {
    const script = buildCniprLegalScript([
      { number: '2023113560975', appNumber: '202311356097.5' },
      { number: 'CN122072823A', pubNumber: 'CN122072823A' },
    ])
    expect(script).toContain('"appNumber":"202311356097.5"')
    expect(script).toContain('"pubNumber":"CN122072823A"')
    expect(script).toContain(`EGO_${CNIPR_LEGAL_TAG}:`)
    expect(script).toContain("cniprCode: 'login_required'")
  })

  it('resolves a publication number to its application number before querying', () => {
    const script = buildCniprLegalScript([{ number: 'CN122072823A', pubNumber: 'CN122072823A' }])
    // 号码形态与包内同源：正则 source 注入，不在脚本里另写一份。
    expect(script).toContain('new RegExp("申请号')
    expect(script).toContain('resolveAppNumber')
    expect(script).toContain('未检索到申请号')
  })

  it('waits for the result heading rather than the record count', () => {
    const script = buildCniprLegalScript([{ number: '2023113560975', appNumber: '202311356097.5' }])
    expect(script).toContain('/pages!legal.action')
    expect(script).toContain("page.fill('#strAn'")
    expect(script).toContain('input[type=submit][value=检索]')
    expect(script).toContain('/doLegalSearch/')
    expect(script).toContain('法律状态检索结果')
  })
})

describe('buildCniprSearchScript', () => {
  it('embeds the query and page count without a request file', () => {
    const script = buildCniprSearchScript('石墨烯电池', 3)
    expect(script).toContain('"石墨烯电池"')
    expect(script).toContain('const pages = 3')
    expect(script).toContain(`taskSpace("${CNIPR_TASK_SPACE}")`)
    expect(script).toContain(`EGO_${CNIPR_SEARCH_TAG}:`)
    expect(script).toContain('header')
    // 不读请求文件：参数一律内嵌（ego 只从 stdin 收脚本、不继承环境变量、不接受 argv）。
    expect(script).not.toContain('/tmp/dsh-cnipr-request.json')
  })

  it('searches from the home box and reads the result rows', () => {
    const script = buildCniprSearchScript('石墨烯电池', 1)
    expect(script).toContain('欢迎您')
    expect(script).toContain("page.fill('input[name=\"q\"]', query, { clearFirst: true })")
    expect(script).toContain("page.click('#search-btn'")
    expect(script).toContain('/doOverviewSearch4Index/')
    expect(script).toContain('#detailSearch')
    // 结果行本身带全部字段，因此只读结果页，不逐条取详情页。
    expect(script).not.toContain('doDetailSearch')
    expect(script).toContain("querySelectorAll('div.g_item')")
    expect(script).toContain("getAttribute('pnm')")
    expect(script).toContain('#slideselect')
  })

  it('turns pages through the site pagination and stops when there is no next page', () => {
    const script = buildCniprSearchScript('石墨烯电池', 3)
    // 每页 10 条是页面固定值（20/30 条受站点等级校验），取更多只能翻页。
    expect(script).toContain('#pagination_top a')
    expect(script).toContain('#startPage')
    expect(script).toContain('if (!moved) return false')
    expect(script).toContain('if (index > 1 && !(await turnToPage(page, index))) break')
    expect(script).toContain('if (read.items.length === 0) break')
  })

  it('never finishes the shared task space', () => {
    expect(buildCniprSearchScript('q', 1)).not.toContain('task.finish')
  })
})
