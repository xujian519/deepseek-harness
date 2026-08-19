import { describe, expect, it } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { collectPortText, createLlmModelPort } from '@deepseek-ai/dsh-patent-core'

function streamOf(chunks: StreamChunk[]): (options: GenerateOptions) => AsyncIterable<StreamChunk> {
  return async function* (options: GenerateOptions) {
    captured = options
    for (const chunk of chunks) yield chunk
  }
}

let captured: GenerateOptions | undefined

describe('createLlmModelPort', () => {
  it('maps text deltas to delta events and finish to done with usage', async () => {
    captured = undefined
    const port = createLlmModelPort(
      streamOf([
        { type: 'text-delta', index: 0, text: '你' },
        { type: 'text-delta', index: 0, text: '好' },
        { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } },
        { type: 'finish', reason: { kind: 'stop' } },
      ]),
      { provider: 'deepseek', model: 'deepseek-chat' },
    )
    const events = []
    for await (const event of port.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      events.push(event)
    }
    expect(events).toEqual([
      { type: 'delta', text: '你' },
      { type: 'delta', text: '好' },
      { type: 'done', usage: { inputTokens: 10, outputTokens: 2 } },
    ])
  })

  it('translates messages into GenerateOptions (system slot + user message)', async () => {
    captured = undefined
    const port = createLlmModelPort(streamOf([{ type: 'finish', reason: { kind: 'stop' } }]), {
      provider: 'deepseek',
      model: 'deepseek-chat',
    })
    await collectPortText(port, '你好')
    expect(captured!.provider).toBe('deepseek')
    expect(captured!.model).toBe('deepseek-chat')
    expect(captured!.messages).toHaveLength(1)
    expect(captured!.messages[0]!.role).toBe('user')
    expect(captured!.messages[0]!.content).toEqual([{ type: 'text', text: '你好' }])
    expect(captured!.messages[0]!.source).toEqual({ kind: 'user' })
  })

  it('collapses system-role messages into GenerateOptions.system', async () => {
    captured = undefined
    const port = createLlmModelPort(streamOf([{ type: 'finish', reason: { kind: 'stop' } }]), {
      provider: 'deepseek',
      model: 'deepseek-chat',
    })
    const events = []
    for await (const event of port.stream({
      messages: [
        { role: 'system', content: '你是助手' },
        { role: 'user', content: '你好' },
      ],
    })) events.push(event)
    expect(captured!.system).toBe('你是助手')
    expect(captured!.messages).toHaveLength(1)
    expect(captured!.messages[0]!.role).toBe('user')
  })

  it('skips reasoning and tool chunks (text-only canonical form)', async () => {
    captured = undefined
    const port = createLlmModelPort(
      streamOf([
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'reasoning-delta', index: 0, text: 'thinking' },
        { type: 'text-delta', index: 0, text: '答' },
        { type: 'block-end', index: 0, block: { type: 'text', text: '答' } },
        { type: 'finish', reason: { kind: 'stop' } },
      ]),
      { provider: 'deepseek', model: 'deepseek-chat' },
    )
    const events = []
    for await (const event of port.stream({ messages: [{ role: 'user', content: 'x' }] })) {
      events.push(event)
    }
    expect(events).toEqual([{ type: 'delta', text: '答' }, { type: 'done' }])
  })

  it('rethrows an error finish so the atoms degrade the stage', async () => {
    captured = undefined
    const port = createLlmModelPort(
      streamOf([{ type: 'finish', reason: { kind: 'error', failure: { message: 'provider down', code: 'DOWN' } } }]),
      { provider: 'deepseek', model: 'deepseek-chat' },
    )
    await expect(async () => {
      for await (const _ of port.stream({ messages: [{ role: 'user', content: 'x' }] })) {
        void _
      }
    }).rejects.toThrow('provider down')
  })
})

describe('collectPortText', () => {
  it('concatenates visible text deltas', async () => {
    captured = undefined
    const port = createLlmModelPort(
      streamOf([
        { type: 'text-delta', index: 0, text: '结论' },
        { type: 'text-delta', index: 0, text: '是' },
        { type: 'finish', reason: { kind: 'stop' } },
      ]),
      { provider: 'deepseek', model: 'deepseek-chat' },
    )
    expect(await collectPortText(port, '问题')).toBe('结论是')
  })
})

describe('mapChunks failure code preservation', () => {
  it('rethrows error finish with the failure.code attached', async () => {
    const port = createLlmModelPort(
      streamOf([
        { type: 'finish', reason: { kind: 'error', failure: { message: 'stub', code: 'setup_required' } } },
      ]),
      { provider: 'deepseek', model: 'deepseek-chat' },
    )
    await expect(collectPortText(port, '问题')).rejects.toMatchObject({ message: 'stub', code: 'setup_required' })
  })
})

describe('per-call temperature', () => {
  it('passes request.temperature into GenerateOptions, overriding the fixed default', async () => {
    let capturedOptions: unknown
    const port = createLlmModelPort(
      async function* (options) {
        capturedOptions = options
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
      { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.7 },
    )
    await collectPortText(port, '问题', undefined, { temperature: 0 })
    expect((capturedOptions as { temperature?: number }).temperature).toBe(0)
  })
})
