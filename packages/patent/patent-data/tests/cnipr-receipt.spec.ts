// CNIPR 纯函数层：号码形态与规范化、请求规划、结果对齐、收据解析。
// 全部不触碰浏览器与 ego 全局，因此可在 Node 里直接跑；页内只取原文。
import { describe, expect, it } from 'vitest'
import {
  alignCniprResults,
  classifyCniprNumber,
  normalizeCniprAppNumber,
  normalizeCniprPdfUrls,
  parseCniprLegalRecords,
  planCniprLegalQueries,
  planCniprPdfRequests,
  readCniprLegalPayload,
  readCniprPdfLinksPayload,
  readCniprScriptFailure,
} from '@deepseek-ai/dsh-patent-data'

describe('normalizeCniprAppNumber', () => {
  it('puts the dot back before the check digit', () => {
    expect(normalizeCniprAppNumber('2023113560975')).toBe('202311356097.5')
    expect(normalizeCniprAppNumber('CN2023113560975')).toBe('CN202311356097.5')
    expect(normalizeCniprAppNumber(' cn202311356097A ')).toBe('CN202311356097.A')
  })

  it('keeps a number that already carries the dot, and other forms as-is', () => {
    expect(normalizeCniprAppNumber('202311356097.5')).toBe('202311356097.5')
    expect(normalizeCniprAppNumber('CN122072823A')).toBe('CN122072823A')
    expect(normalizeCniprAppNumber('202311')).toBe('202311')
  })
})

describe('classifyCniprNumber', () => {
  it('separates publication numbers, application numbers, and everything else', () => {
    expect(classifyCniprNumber('CN122072823A')).toBe('pub')
    expect(classifyCniprNumber('ZL202311356097.5')).toBe('other')
    expect(classifyCniprNumber('202311356097.5')).toBe('app')
    expect(classifyCniprNumber('2023113560975')).toBe('app')
    expect(classifyCniprNumber('US11452699B2')).toBe('other')
  })
})

describe('normalizeCniprPdfUrls', () => {
  it('forces http, strips an existing scheme, and dedupes', () => {
    expect(normalizeCniprPdfUrls([
      'https://pic.cnipr.com/pdfcn/a/PDF_PID/x.PDF',
      'pic.cnipr.com/pdfcn/a/PDF_PID/x.PDF',
      'http://pic.cnipr.com/pdfcn/b/PDF_PID/y.PDF',
    ])).toEqual([
      'http://pic.cnipr.com/pdfcn/a/PDF_PID/x.PDF',
      'http://pic.cnipr.com/pdfcn/b/PDF_PID/y.PDF',
    ])
  })
})

describe('planCniprPdfRequests', () => {
  it('sends publication numbers and reports the rest as unsupported', () => {
    const plan = planCniprPdfRequests(['CN122072823A', '202311356097.5'])
    expect(plan.requested).toEqual(['CN122072823A'])
    expect(plan.unsupported).toEqual([
      { number: '202311356097.5', urls: [], unexamined: false, authorized: false, error: 'CNIPR 通道只处理公开(公告)号' },
    ])
  })
})

describe('planCniprLegalQueries', () => {
  it('queries application numbers directly and resolves publication numbers first', () => {
    const plan = planCniprLegalQueries(['2023113560975', 'CN122072823A', 'US11452699B2'])
    expect(plan.queries).toEqual([
      { number: '2023113560975', appNumber: '202311356097.5' },
      { number: 'CN122072823A', pubNumber: 'CN122072823A' },
    ])
    expect(plan.unsupported).toEqual([
      { number: 'US11452699B2', appNumber: '', total: null, records: [], error: 'CNIPR 通道只处理中国申请号与公开(公告)号' },
    ])
  })
})

describe('alignCniprResults', () => {
  it('keeps request order and marks numbers the script never reported', () => {
    const aligned = alignCniprResults(
      ['CN1', 'CN2', 'CN3'],
      [{ number: 'CN3', marker: 'reported' }, { number: 'CN1', marker: 'reported' }],
      number => ({ number, marker: 'missing' }),
    )
    expect(aligned).toEqual([
      { number: 'CN1', marker: 'reported' },
      { number: 'CN2', marker: 'missing' },
      { number: 'CN3', marker: 'reported' },
    ])
  })
})

describe('readCniprScriptFailure', () => {
  it('keeps the login class and folds an unknown class into page_state', () => {
    expect(readCniprScriptFailure({ code: 'login_required', message: '请重新登录' }))
      .toEqual({ code: 'login_required', message: '请重新登录' })
    // 未知分类只可能来自脚本改了一半的运行，归入页面交互失败比放行安全。
    expect(readCniprScriptFailure({ code: 'something_new' })).toEqual({ code: 'page_state', message: '' })
    expect(readCniprScriptFailure(undefined)).toBeUndefined()
    expect(readCniprScriptFailure('boom')).toBeUndefined()
  })
})

describe('readCniprPdfLinksPayload', () => {
  it('maps reported links and drops entries that carry no number', () => {
    const read = readCniprPdfLinksPayload({
      items: [
        { number: 'CN122072823A', matches: ['pic.cnipr.com/pdfcn/a/PDF_PID/x.PDF'], isUnexamined: true, isAuthorized: false },
        { number: 'CN100000000A', error: '检索不到该号' },
        { matches: ['pic.cnipr.com/pdfcn/b.PDF'] },
        'not-an-object',
      ],
    })
    expect(read.items).toEqual([
      { number: 'CN122072823A', urls: ['http://pic.cnipr.com/pdfcn/a/PDF_PID/x.PDF'], unexamined: true, authorized: false },
      { number: 'CN100000000A', urls: [], unexamined: false, authorized: false, error: '检索不到该号' },
    ])
    expect(read.failure).toBeUndefined()
  })

  it('treats a non-object payload as empty and carries a script-level failure', () => {
    expect(readCniprPdfLinksPayload(null)).toEqual({ items: [] })
    expect(readCniprPdfLinksPayload({ items: 'nope' })).toEqual({ items: [] })
    const read = readCniprPdfLinksPayload({ items: [], error: { code: 'login_required', message: '未检测到登录态' } })
    expect(read.items).toEqual([])
    expect(read.failure).toEqual({ code: 'login_required', message: '未检测到登录态' })
  })
})

describe('parseCniprLegalRecords', () => {
  const pageText = [
    '法律状态检索结果',
    '申请号：202311356097.5 法律状态公告日：2023.12.29 法律状态：实质审查的生效 法律状态信息：实质审查的生效 IPC(主分类):H01M4/62',
    '申请号：202311356097.5 法律状态公告日：2023.12.12 法律状态：公开 法律状态信息：公开',
    '共 2 条记录',
  ].join(' ')

  it('parses the count and every record', () => {
    expect(parseCniprLegalRecords(pageText)).toEqual({
      total: 2,
      records: [
        { app_number: '202311356097.5', announce_date: '2023.12.29', status: '实质审查的生效', status_info: '实质审查的生效 IPC(主分类):H01M4/62' },
        { app_number: '202311356097.5', announce_date: '2023.12.12', status: '公开', status_info: '公开' },
      ],
    })
  })

  it('reports a zero-hit page as null count rather than inventing zero', () => {
    // 零命中的结果页不输出「共 N 条记录」标记（实测），因此 total 必须是 null。
    expect(parseCniprLegalRecords('法律状态检索结果 没有检索到相关记录')).toEqual({ total: null, records: [] })
  })
})

describe('readCniprLegalPayload', () => {
  it('parses the page text a script returned for an application number', () => {
    const read = readCniprLegalPayload({
      items: [{
        number: '2023113560975',
        appNumber: '202311356097.5',
        text: '申请号：202311356097.5 法律状态公告日：2023.12.29 法律状态：实质审查的生效 法律状态信息：实质审查的生效',
      }],
    })
    expect(read.items).toEqual([{
      number: '2023113560975',
      appNumber: '202311356097.5',
      total: null,
      records: [{ app_number: '202311356097.5', announce_date: '2023.12.29', status: '实质审查的生效', status_info: '实质审查的生效' }],
    }])
    expect(read.failure).toBeUndefined()
  })

  it('keeps a resolved publication number and a per-number error', () => {
    const read = readCniprLegalPayload({
      items: [
        { number: 'CN122072823A', appNumber: '202311356097.5', resolvedFrom: 'CN122072823A', text: '共 1 条记录 申请号：202311356097.5 法律状态公告日：2023.12.29 法律状态：公开 法律状态信息：公开' },
        { number: 'CN100000000A', resolvedFrom: 'CN100000000A', error: '公开(公告)号 CN100000000A 未检索到申请号，无法查询法律状态' },
        { number: 'CN100000001A', appNumber: '' },
        { number: 'CN100000002A', appNumber: '202311356097.5', error: '等法律状态结果页失败' },
        { number: 'CN100000003A', appNumber: '202311356097.5' },
        { text: 'no number' },
      ],
    })
    expect(read.items).toEqual([
      {
        number: 'CN122072823A',
        appNumber: '202311356097.5',
        resolvedFrom: 'CN122072823A',
        total: 1,
        records: [{ app_number: '202311356097.5', announce_date: '2023.12.29', status: '公开', status_info: '公开' }],
      },
      {
        number: 'CN100000000A',
        appNumber: '',
        resolvedFrom: 'CN100000000A',
        total: null,
        records: [],
        error: '公开(公告)号 CN100000000A 未检索到申请号，无法查询法律状态',
      },
      // 没解析出申请号、脚本也没报错的条目：按无法查询处理，不静默返回空记录。
      { number: 'CN100000001A', appNumber: '', total: null, records: [], error: '号 CN100000001A 未解析出申请号，无法查询法律状态' },
      { number: 'CN100000002A', appNumber: '202311356097.5', total: null, records: [], error: '等法律状态结果页失败' },
      // 条目缺原文（脚本只在成功时带 text）：按零记录返回，不编造计数。
      { number: 'CN100000003A', appNumber: '202311356097.5', total: null, records: [] },
    ])
  })

  it('treats a non-object payload as empty and carries a script-level failure', () => {
    expect(readCniprLegalPayload(undefined)).toEqual({ items: [] })
    expect(readCniprLegalPayload({ items: 'nope' })).toEqual({ items: [] })
    expect(readCniprLegalPayload({ items: [], error: { code: 'page_state', message: '等检索结果页失败' } }).failure)
      .toEqual({ code: 'page_state', message: '等检索结果页失败' })
  })
})
