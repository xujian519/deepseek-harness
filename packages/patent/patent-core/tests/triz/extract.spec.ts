import { expect, it } from 'vitest'
import { extractTrizContradictions, type PatentModelEvent, type PatentModelPort, type PatentModelRequest } from '@deepseek-ai/dsh-patent-core'

/** 记录调用并回放固定文本的假端口。 */
function fakePort(reply: string): PatentModelPort & { requests: PatentModelRequest[] } {
  const requests: PatentModelRequest[] = []
  return {
    requests,
    async *stream(request: PatentModelRequest): AsyncIterable<PatentModelEvent> {
      requests.push(request)
      yield { type: 'delta', text: reply }
      yield { type: 'done' }
    },
  }
}

/** 直接抛错的假端口（模拟提供方故障）。 */
function failingPort(message: string): PatentModelPort {
  return {
    async *stream(): AsyncIterable<PatentModelEvent> {
      throw new Error(message)
    },
  }
}

it('抽取: 合法 JSON → ok 并带回原样结果', async () => {
  const port = fakePort(JSON.stringify({
    contradictions: [{ improving: 9, worsening: 25, statement: '提速牺牲节拍', evidence: '节拍下降' }],
  }))
  const outcome = await extractTrizContradictions(port, '交底书原文：提速后节拍下降。')

  expect(outcome.ok).toBe(true)
  if (!outcome.ok) return
  expect(outcome.extraction.contradictions).toEqual([
    { improving: 9, worsening: 25, statement: '提速牺牲节拍', evidence: '节拍下降' },
  ])
  expect(port.requests).toHaveLength(1)
})

it('抽取: 代码围栏包裹的 JSON → 仍可解析', async () => {
  const port = fakePort('```json\n{"contradictions":[]}\n```')
  const outcome = await extractTrizContradictions(port, '原文')

  expect(outcome.ok).toBe(true)
})

it('抽取: 非 JSON 输出 → 失败结果（不抛错）', async () => {
  const outcome = await extractTrizContradictions(fakePort('这不是 JSON'), '原文')

  expect(outcome.ok).toBe(false)
  if (outcome.ok) return
  expect(outcome.message).toContain('JSON')
})

it('抽取: 端口抛错 → 失败结果并带原因', async () => {
  const outcome = await extractTrizContradictions(failingPort('provider down'), '原文')

  expect(outcome.ok).toBe(false)
  if (outcome.ok) return
  expect(outcome.message).toContain('provider down')
})

it('抽取: 提示包含 39 参数清单与交底书原文', async () => {
  const port = fakePort('{"contradictions":[]}')
  await extractTrizContradictions(port, '交底书正文内容', { focus: '节拍' })

  const request = port.requests[0]!
  const content = request.messages[0]!.content
  expect(content).toContain('交底书正文内容')
  expect(content).toContain('39 生产率')
  expect(content).toContain('关注方向：节拍')
  expect(request.schema).toBeDefined()
  expect(request.temperature).toBe(0.2)
})
