import { expect, it } from 'vitest'
import { runNodeWithPolicy, type GraphNode } from '@deepseek-ai/dsh-patent-core'

const okNode =
  (value: unknown): GraphNode =>
    async () => ({ key: value })

it('runNodeWithPolicy: 无策略直接成功', async () => {
  const outcome = await runNodeWithPolicy(okNode('v'), undefined, { state: {} })
  expect(outcome.ok).toBe(true)
  if (outcome.ok) expect(outcome.delta).toEqual({ key: 'v' })
})

it('runNodeWithPolicy: 重试成功（第 2 次成功）', async () => {
  let calls = 0
  const flaky: GraphNode = async () => {
    calls += 1
    if (calls < 2) throw new Error('boom')
    return { key: 'ok' }
  }
  const outcome = await runNodeWithPolicy(flaky, { maxRetries: 2, retryDelayMs: 1 }, { state: {} })
  expect(outcome.ok).toBe(true)
  expect(calls).toBe(2)
})

it('runNodeWithPolicy: 重试耗尽返回失败', async () => {
  let calls = 0
  const alwaysFail: GraphNode = async () => {
    calls += 1
    throw new Error('always')
  }
  const outcome = await runNodeWithPolicy(alwaysFail, { maxRetries: 3, retryDelayMs: 1 }, { state: {} })
  expect(outcome.ok).toBe(false)
  expect(calls).toBe(4)
})

it('runNodeWithPolicy: 超时跨重试截断（总时长含重试）', async () => {
  let calls = 0
  const slow: GraphNode = async () => {
    calls += 1
    await new Promise(resolve => setTimeout(resolve, 50))
    return { key: 'late' }
  }
  const outcome = await runNodeWithPolicy(slow, { maxRetries: 3, timeoutMs: 30, retryDelayMs: 1 }, { state: {} })
  expect(outcome.ok).toBe(false)
  // 超时后不再重试：仅 1 次调用。
  expect(calls).toBe(1)
  if (!outcome.ok) expect(outcome.error instanceof Error).toBe(true)
})

it('runNodeWithPolicy: 超时注入 AbortSignal（节点可感知）', async () => {
  let sawAbort = false
  const abortAware: GraphNode = async ({ signal }) => {
    await new Promise<void>((resolve) => {
      signal?.addEventListener('abort', () => {
        sawAbort = true
        resolve()
      })
      setTimeout(resolve, 200)
    })
    throw new Error('aborted')
  }
  const outcome = await runNodeWithPolicy(abortAware, { timeoutMs: 20 }, { state: {} })
  expect(outcome.ok).toBe(false)
  expect(sawAbort).toBe(true)
})

it('runNodeWithPolicy: sideEffect 丢弃 delta', async () => {
  const outcome = await runNodeWithPolicy(okNode('v'), { sideEffect: true }, { state: {} })
  expect(outcome.ok).toBe(true)
  if (outcome.ok) expect(outcome.delta).toEqual({})
})

it('runNodeWithPolicy: 节点同步抛错被捕获', async () => {
  const syncThrow: GraphNode = () => {
    throw new Error('sync')
  }
  const outcome = await runNodeWithPolicy(syncThrow, undefined, { state: {} })
  expect(outcome.ok).toBe(false)
})
