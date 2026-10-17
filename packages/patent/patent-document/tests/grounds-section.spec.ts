import { expect, it } from 'vitest'
import { renderGroundsSection } from '../src/document/draftConverter/grounds.ts'
import type { DraftGroundItem } from '@deepseek-ai/dsh-patent-core'

const item = (over: Partial<DraftGroundItem> = {}): DraftGroundItem => ({
  article: '专利法第22条第3款',
  ground: '创造性',
  claimNos: [1, 2],
  facts: '事实。',
  evidence: '证据。',
  conclusion: '结论。',
  ...over,
})

it('节标题由节序、被主张权项、理由名与法条生成', () => {
  const html = renderGroundsSection([item()], '4')
  expect(html).toContain('<h3>4.1 权利要求 1、2 不具备创造性（专利法第22条第3款）</h3>')
  // 四项正文按「事实认定 / 证据分析 / 法条适用与结论」三段给出（法条适用与结论合为一段）。
  expect(html).toContain('<h4>事实认定</h4><p>事实。</p>')
  expect(html).toContain('<h4>证据分析</h4><p>证据。</p>')
  expect(html).toContain('<h4>法条适用与结论</h4><p>结论。</p>')
})

it('多项按提交顺序连续编号，缺节序前缀时只出序号', () => {
  const html = renderGroundsSection([
    item(),
    item({ article: '专利法第33条', ground: '修改超范围', claimNos: [4] }),
  ], '4')
  expect(html).toContain('<h3>4.1 ')
  expect(html).toContain('<h3>4.2 权利要求 4 不具备修改超范围（专利法第33条）</h3>')
  expect(renderGroundsSection([item()], '')).toContain('<h3>.1 ')
})

it('理由名与法条转义，不可注入标签', () => {
  const html = renderGroundsSection([item({ ground: '<b>创造性</b>', article: 'A22.3 & 细则' })], '4')
  expect(html).toContain('&lt;b&gt;创造性&lt;/b&gt;')
  expect(html).toContain('A22.3 &amp; 细则')
  expect(html).not.toContain('<b>创造性</b>')
})

it('关系词随模板体例：被请求人侧的小节按主题命名，不套用请求人侧的「不具备」', () => {
  const html = renderGroundsSection([item({ ground: '创造性' })], '5', '的')
  expect(html).toContain('<h3>5.1 权利要求 1、2 的创造性（专利法第22条第3款）</h3>')
  expect(html).not.toContain('不具备')
  // 关系词同样转义，不可注入标签。
  expect(renderGroundsSection([item()], '5', '<b>')).toContain('&lt;b&gt;')
})
