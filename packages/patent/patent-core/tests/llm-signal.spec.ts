import { describe, expect, it } from 'vitest'
import {
  KeywordsHandler,
  type PatentModelPort,
  type StageProvider,
} from '@deepseek-ai/dsh-patent-core'

const STATE = { input: '一种过滤装置，包括壳体和滤芯。' }

describe('LLM signal 透传', () => {
  it('provider.callLLM 收到调用方同一个 signal', async () => {
    const controller = new AbortController()
    let seen: AbortSignal | undefined
    const provider: StageProvider = {
      callLLM: async (_prompt, _opts, signal) => {
        seen = signal
        return JSON.stringify({ keywords: ['过滤装置'] })
      },
    }
    const out = await new KeywordsHandler().execute({ state: STATE, provider, signal: controller.signal })
    expect(seen).toBe(controller.signal)
    expect(out.keywords).toEqual(['过滤装置'])
  })

  it('abort 经 callLLM 接缝传到调用方并降级', async () => {
    const controller = new AbortController()
    const provider: StageProvider = {
      callLLM: (_prompt, _opts, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
        }),
    }
    const pending = new KeywordsHandler().execute({ state: STATE, provider, signal: controller.signal })
    controller.abort()
    const out = await pending
    expect(String(out._error)).toContain('[keywords] LLM 调用失败: aborted')
  })

  it('provider.llm 端口收到同一个 signal', async () => {
    const controller = new AbortController()
    let seen: AbortSignal | undefined
    const port: PatentModelPort = {
      stream: async function* (_request, signal) {
        seen = signal
        yield { type: 'delta', text: JSON.stringify({ keywords: ['壳体'] }) }
        yield { type: 'done' }
      },
    }
    const out = await new KeywordsHandler().execute({
      state: STATE,
      provider: { llm: port },
      signal: controller.signal,
    })
    expect(seen).toBe(controller.signal)
    expect(out.keywords).toEqual(['壳体'])
  })
})
