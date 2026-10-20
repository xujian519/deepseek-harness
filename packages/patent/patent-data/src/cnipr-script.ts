/**
 * CNIPR 脚本生成：脚本体以 stdin 交给 `ego-browser nodejs` 执行。
 *
 * 参数直接写进脚本体。ego 的 Node 运行时只从 stdin 接收脚本、不继承环境变量、也不接受
 * argv——部署侧技能因此用固定路径的 JSON 请求文件传参；包内脚本由本模块生成，参数与模式
 * 都嵌进去，省掉请求文件及其读写契约。
 *
 * 两个脚本都按名复用同一个任务空间（不 finish）：下一次调用沿用它的登录态与标签页，
 * 这也是本通道只复用 ego lite 登录态、不自己处理登录的原因。页内只取原文，判定与解析
 * 回到 `cnipr-receipt.ts` 的纯函数，除了页面自身状态的两处判断：登录态与结果页渲染。
 * @module @deepseek-ai/dsh-patent-data/cnipr-script
 */

import { CNIPR_BASE_URL, CNIPR_LOGIN_HINT_PATTERN, CNIPR_PDF_URL_PATTERN, CNIPR_RESULT_APP_NUMBER_PATTERN } from './cnipr-receipt.ts'
import type { CniprLegalQuery, CniprPageBudgets } from './types.ts'

/** 直链脚本的回传标签；`EgoBrowserSession.extractTaggedJson` 按 `EGO_<tag>:` 解析。 */
export const CNIPR_PDF_TAG = 'CNIPR_PDFLINKS'

/** 法律状态脚本的回传标签。 */
export const CNIPR_LEGAL_TAG = 'CNIPR_LEGAL'

/** 关键词检索脚本的回传标签。 */
export const CNIPR_SEARCH_TAG = 'CNIPR_SEARCH'

/** 按名复用的任务空间；同一空间复用登录态与标签页，故两次调用之间不做登录。 */
export const CNIPR_TASK_SPACE = 'sati-patent-cnipr'

/**
 * 生成脚本的出厂页面等待预算：通道落地时的站点实测值，也就是这些等待改成配置前的行为。
 * 站点协议常量（每页 10 条、单次最多 30 条）不在这里，它们由站点账号等级决定。
 */
export const DEFAULT_CNIPR_PAGE_BUDGETS: CniprPageBudgets = {
  loginPollMs: 1_000,
  loginAttempts: 10,
  loginRounds: 2,
  navigationTimeoutMs: 45_000,
  actionTimeoutMs: 15_000,
  resultTimeoutMs: 30_000,
  renderTimeoutMs: 20_000,
  detailTimeoutMs: 20_000,
}

/**
 * 脚本回传一行载荷：`console.log` 的输出在 ego 里走 stderr，会话把两路合并后再解析。
 * @param tag - 回传标签。
 * @param extra - `items` 与 `error` 之外还要回传的字段名（检索脚本用它回传结果页总数）。
 * @returns 该脚本末尾的载荷输出语句。
 */
function emit(tag: string, extra = ''): string {
  const fields = ['items', ...(extra === '' ? [] : [extra]), 'error: failure']
  return `console.log(${JSON.stringify(`EGO_${tag}:`)} + JSON.stringify({ ${fields.join(', ')} }))`
}

/**
 * 两个脚本共用的前缀：登录态等待、页面状态等待与失败分类。
 *
 * `waitForLoggedIn` 只认页头的「欢迎您」——CNIPR 的页头晚于搜索框出现，以搜索框存在判定
 * 未登录会在正常页面上误判；失败时按 {@link CNIPR_LOGIN_HINT_PATTERN} 区分「会话失效」
 * 与「页面没按预期跳转」，前者的处置是去 ego lite 重新登录。
 * @param budgets - 页面等待预算，逐项内嵌进脚本体。
 * @returns 脚本体前缀。
 */
function sharedPreamble(budgets: CniprPageBudgets): string {
  return `const BASE = ${JSON.stringify(CNIPR_BASE_URL)}
const LOGIN_HINT = ${JSON.stringify(CNIPR_LOGIN_HINT_PATTERN)}
const LOGIN_POLL_MS = ${budgets.loginPollMs}
const LOGIN_ATTEMPTS = ${budgets.loginAttempts}
const LOGIN_ROUNDS = ${budgets.loginRounds}
const NAVIGATION_TIMEOUT_MS = ${budgets.navigationTimeoutMs}
const ACTION_TIMEOUT_MS = ${budgets.actionTimeoutMs}
const RESULT_TIMEOUT_MS = ${budgets.resultTimeoutMs}
const RENDER_TIMEOUT_MS = ${budgets.renderTimeoutMs}
const DETAIL_TIMEOUT_MS = ${budgets.detailTimeoutMs}
const pageText = async (page) => await page.evaluate(() => (document.body ? document.body.innerText : ''))
const failureOf = (error, fallback) => ({
  code: error && error.cniprCode ? error.cniprCode : fallback,
  message: error && error.message ? error.message : String(error),
})
const waitForState = async (page, action, expectation) => {
  try {
    await action()
  } catch (error) {
    const text = await pageText(page).catch(() => '')
    const login = !text.includes('欢迎您') && new RegExp(LOGIN_HINT).test(text)
    const detail = error && error.message ? error.message : String(error)
    throw Object.assign(new Error('等' + expectation + '失败：' + detail), { cniprCode: login ? 'login_required' : 'page_state' })
  }
}
const waitForLoggedIn = async (page) => {
  for (let round = 0; round < LOGIN_ROUNDS; round += 1) {
    for (let attempt = 0; attempt < LOGIN_ATTEMPTS; attempt += 1) {
      if ((await pageText(page)).includes('欢迎您')) return
      await page.waitForTimeout(LOGIN_POLL_MS)
    }
    if (round < LOGIN_ROUNDS - 1) await page.reload({ timeout: NAVIGATION_TIMEOUT_MS, waitUntil: 'domcontentloaded' })
  }
  throw Object.assign(new Error('未检测到 CNIPR 登录态：请在 ego lite 里登录 search.cnipr.com 后重试'), { cniprCode: 'login_required' })
}
const openHome = async (page) => {
  await waitForState(page, () => page.goto(BASE + '/', { timeout: NAVIGATION_TIMEOUT_MS, waitUntil: 'domcontentloaded' }), 'CNIPR 首页')
  await waitForLoggedIn(page)
}`
}

/**
 * 生成「按号取全文 PDF 直链」脚本。免费账号(L1)不能走概览页的批量 PDF 下载，但详情页 HTML
 * 内嵌 `pic.cnipr.com/pdfcn/...` 全文直链，因此每条记录经详情检索接口取回原文再抽直链；
 * `PDF_PID` 由系统生成、无法由公开号反推，所以直链只能这样取。
 * @param numbers - 公开(公告)号列表（调用方已归一与去重）。
 * @param budgets - 页面等待预算；默认取 {@link DEFAULT_CNIPR_PAGE_BUDGETS}。
 * @returns 交给 `ego-browser nodejs` 的脚本体。
 */
export function buildCniprPdfLinksScript(
  numbers: readonly string[],
  budgets: CniprPageBudgets = DEFAULT_CNIPR_PAGE_BUDGETS,
): string {
  return `${sharedPreamble(budgets)}
const numbers = ${JSON.stringify(numbers)}
const extractLinks = (args) => {
  const form = document.getElementById('detailSearch')
  if (!form) return { error: 'no-detailSearch（未进入结果页？）' }
  const body = new FormData(form)
  body.set('recordCursor', String(args.cursor))
  body.set('startPage', '1')
  body.set('limit', '1')
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/search!doDetailSearch.action', true)
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return
      try {
        const html = xhr.responseText || ''
        resolve({
          matches: html.match(new RegExp(args.pattern, 'gi')) || [],
          isUnexamined: /Unexamined_patent/i.test(html),
          isAuthorized: /Authorized_patent/i.test(html),
        })
      } catch (error) {
        resolve({ error: String(error) })
      }
    }
    setTimeout(() => resolve({ error: '详情检索 ' + DETAIL_TIMEOUT_MS + ' 毫秒未返回' }), DETAIL_TIMEOUT_MS)
    xhr.send(body)
  })
}
const items = []
let failure
try {
  const task = await taskSpace(${JSON.stringify(CNIPR_TASK_SPACE)})
  const page = task.page('p1')
  await openHome(page)
  for (const number of numbers) {
    try {
      await waitForState(page, () => page.goto(BASE + '/', { timeout: NAVIGATION_TIMEOUT_MS, waitUntil: 'domcontentloaded' }), 'CNIPR 首页')
      await page.fill('input[name="q"]', number, { clearFirst: true })
      await page.click('#search-btn', { timeout: ACTION_TIMEOUT_MS })
      await waitForState(page, () => page.waitForURL(/doOverviewSearch4Index/, { timeout: NAVIGATION_TIMEOUT_MS }), '检索结果页')
      await waitForState(page, () => page.waitForSelector('#detailSearch', { timeout: RESULT_TIMEOUT_MS }), '结果页详情表单')
      const found = await page.evaluate(extractLinks, { cursor: 0, pattern: ${JSON.stringify(CNIPR_PDF_URL_PATTERN)} })
      items.push({ number, ...found })
    } catch (error) {
      items.push({ number, error: failureOf(error, 'page_state').message })
    }
  }
} catch (error) {
  failure = failureOf(error, 'page_state')
}
${emit(CNIPR_PDF_TAG)}
`
}

/**
 * 生成法律状态查询脚本：申请号直接查；公开(公告)号先经检索结果页解析出申请号。
 * `app_number` 的解析用包内的 {@link CNIPR_RESULT_APP_NUMBER_PATTERN}，两处号码形态同源。
 * @param entries - 每个号的查询目标。
 * @param budgets - 页面等待预算；默认取 {@link DEFAULT_CNIPR_PAGE_BUDGETS}。
 * @returns 交给 `ego-browser nodejs` 的脚本体。
 */
export function buildCniprLegalScript(
  entries: readonly CniprLegalQuery[],
  budgets: CniprPageBudgets = DEFAULT_CNIPR_PAGE_BUDGETS,
): string {
  return `${sharedPreamble(budgets)}
const entries = ${JSON.stringify(entries)}
const APP_NUMBER = new RegExp(${JSON.stringify(CNIPR_RESULT_APP_NUMBER_PATTERN.source)}, 'i')
const resolveAppNumber = async (page, pubNumber) => {
  await waitForState(page, () => page.goto(BASE + '/', { timeout: NAVIGATION_TIMEOUT_MS, waitUntil: 'domcontentloaded' }), 'CNIPR 首页')
  await page.fill('input[name="q"]', pubNumber, { clearFirst: true })
  await page.evaluate(() => {
    const input = document.querySelector('input[name="q"]')
    input.closest('form').querySelector('button').click()
  })
  await waitForState(page, () => page.waitForURL(/doOverviewSearch4Index/, { timeout: RESULT_TIMEOUT_MS }), '检索结果页')
  await waitForState(page, () => page.waitForFunction(() => !!document.body && /申请号[：:]/.test(document.body.innerText), undefined, { timeout: RENDER_TIMEOUT_MS }), '结果页渲染')
  return (await pageText(page)).replace(/\\s+/g, ' ').match(APP_NUMBER)
}
const queryLegal = async (page, appNumber) => {
  await page.goto(BASE + '/pages!legal.action', { timeout: NAVIGATION_TIMEOUT_MS, waitUntil: 'domcontentloaded' })
  await waitForState(page, () => page.waitForSelector('#strAn', { timeout: RESULT_TIMEOUT_MS }), '法律状态检索表单')
  await page.fill('#strAn', appNumber, { clearFirst: true })
  await page.click('input[type=submit][value=检索]', { timeout: ACTION_TIMEOUT_MS })
  await waitForState(page, () => page.waitForURL(/doLegalSearch/, { timeout: RESULT_TIMEOUT_MS }), '法律状态结果页')
  // 只等结果区标题：零命中的结果页不输出记录数标记，等它必然超时（实测）。
  await waitForState(page, () => page.waitForFunction(() => !!document.body && document.body.innerText.indexOf('法律状态检索结果') >= 0, undefined, { timeout: RENDER_TIMEOUT_MS }), '法律状态结果渲染')
  return await pageText(page)
}
const items = []
let failure
try {
  const task = await taskSpace(${JSON.stringify(CNIPR_TASK_SPACE)})
  const page = task.page('p1')
  await openHome(page)
  for (const entry of entries) {
    try {
      if (entry.appNumber) {
        items.push({ number: entry.number, appNumber: entry.appNumber, text: await queryLegal(page, entry.appNumber) })
        continue
      }
      const resolved = await resolveAppNumber(page, entry.pubNumber)
      if (!resolved) {
        items.push({ number: entry.number, resolvedFrom: entry.pubNumber, error: '公开(公告)号 ' + entry.pubNumber + ' 未检索到申请号，无法查询法律状态' })
        continue
      }
      const appNumber = resolved[1].toUpperCase()
      items.push({ number: entry.number, appNumber, resolvedFrom: entry.pubNumber, text: await queryLegal(page, appNumber) })
    } catch (error) {
      items.push({ number: entry.number, error: failureOf(error, 'page_state').message })
    }
  }
} catch (error) {
  failure = failureOf(error, 'page_state')
}
${emit(CNIPR_LEGAL_TAG)}
`
}

/**
 * 生成关键词检索脚本：主页检索框提交后读结果页，按需翻页。
 *
 * 结果页本身发布了标题、申请人、公开日与摘要，因此检索不需要逐条取详情页。每页 10 条是
 * 本部署账号下页面的固定值——页面可选的 20/30 条受站点等级校验（实测被拒回 10 条），
 * 所以「取更多」只能靠站点自身的分页（提交检索表单的 `start` 字段，L1 可用）。页数由
 * 包内的 `planCniprSearchRequest` 决定，脚本只按给定页数读取，不自行判断要几页。
 * @param query - 检索词（调用方已确认不含 Google 专有的字段语法）。
 * @param pages - 要读取的结果页数。
 * @param budgets - 页面等待预算；默认取 {@link DEFAULT_CNIPR_PAGE_BUDGETS}。
 * @returns 交给 `ego-browser nodejs` 的脚本体。
 */
export function buildCniprSearchScript(
  query: string,
  pages: number,
  budgets: CniprPageBudgets = DEFAULT_CNIPR_PAGE_BUDGETS,
): string {
  return `${sharedPreamble(budgets)}
const query = ${JSON.stringify(query)}
const pages = ${JSON.stringify(pages)}
const readPage = (args) => {
  const header = document.querySelector('#slideselect')
  const rows = Array.from(document.querySelectorAll('div.g_item'))
  return {
    header: header ? header.innerText : null,
    items: rows.map((row, index) => {
      const box = row.querySelector('input[name="recordno"]')
      const patti = row.querySelector('li[name="patti"]')
      const cont = row.querySelector('div.g_cont')
      return {
        cursor: args.offset + index,
        number: box ? box.getAttribute('pnm') : null,
        title: patti ? patti.getAttribute('title') : null,
        text: cont ? cont.innerText : row.innerText,
      }
    }),
  }
}
const turnToPage = async (page, target) => {
  const moved = await page.evaluate((wanted) => {
    const link = Array.from(document.querySelectorAll('#pagination_top a'))
      .find(anchor => anchor.innerText.trim() === String(wanted))
    if (!link) return false
    link.click()
    return true
  }, target)
  if (!moved) return false
  await waitForState(page, () => page.waitForFunction((wanted) => {
    const marker = document.querySelector('#startPage')
    return !!marker && marker.value === String(wanted)
  }, target, { timeout: RESULT_TIMEOUT_MS }), '第 ' + target + ' 页')
  await waitForState(page, () => page.waitForSelector('div.g_item', { timeout: RENDER_TIMEOUT_MS }), '第 ' + target + ' 页记录')
  return true
}
const items = []
let header = null
let failure
try {
  const task = await taskSpace(${JSON.stringify(CNIPR_TASK_SPACE)})
  const page = task.page('p1')
  await openHome(page)
  await waitForState(page, () => page.fill('input[name="q"]', query, { clearFirst: true }), 'CNIPR 检索框')
  await waitForState(page, () => page.click('#search-btn', { timeout: ACTION_TIMEOUT_MS }), 'CNIPR 检索提交')
  await waitForState(page, () => page.waitForURL(/doOverviewSearch4Index/, { timeout: NAVIGATION_TIMEOUT_MS }), '检索结果页')
  await waitForState(page, () => page.waitForSelector('#detailSearch', { timeout: RESULT_TIMEOUT_MS }), '结果页详情表单')
  for (let index = 1; index <= pages; index += 1) {
    if (index > 1 && !(await turnToPage(page, index))) break
    const read = await page.evaluate(readPage, { offset: items.length })
    if (header === null) header = read.header
    if (read.items.length === 0) break
    items.push(...read.items)
  }
} catch (error) {
  failure = failureOf(error, 'page_state')
}
${emit(CNIPR_SEARCH_TAG, 'header')}
`
}
