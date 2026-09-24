import { describe, expect, it, vi } from 'vitest'
import { TerminalProtocolQueue } from '@deepseek-ai/dsh-terminal-bash/src/terminal-protocol-queue.ts'

/** A queue whose reply writes are recorded, with the emulator size fixed for tests. */
function makeQueue(
  writeReply: (data: string) => Promise<void> = async () => {},
  onFailure: (error: unknown) => void = () => {},
): TerminalProtocolQueue {
  return new TerminalProtocolQueue(writeReply, 80, 24, () => {}, onFailure)
}

describe('TerminalProtocolQueue', () => {
  it('answers a cursor-position query through the provider write', async () => {
    const replies: string[] = []
    const queue = makeQueue(async (data) => { replies.push(data) })

    queue.accept('\x1b[6n')
    await queue.drain()

    expect(replies).toEqual(['\x1b[1;1R'])
  })

  it('reports a reply failure while the queue is open', async () => {
    const failures: unknown[] = []
    const queue = makeQueue(
      () => Promise.reject(new Error('reply write failed')),
      (error) => { failures.push(error) },
    )

    queue.accept('\x1b[6n')
    await queue.drain()

    expect(failures).toHaveLength(1)
  })

  it('drops a reply failure that lands after the queue closed', async () => {
    const replies: PromiseWithResolvers<undefined>[] = []
    const failures: unknown[] = []
    const queue = makeQueue(
      () => {
        const reply = Promise.withResolvers<undefined>()
        replies.push(reply)
        return reply.promise
      },
      (error) => { failures.push(error) },
    )

    queue.accept('\x1b[6n')
    await vi.waitFor(() => { expect(replies).toHaveLength(1) })
    queue.close()
    replies[0]!.reject(new Error('late reply failure'))
    await queue.drain()

    expect(failures).toEqual([])
  })

  it('stops accepting output after close and tolerates a repeated close', async () => {
    const replies: string[] = []
    const queue = makeQueue(async (data) => { replies.push(data) })

    queue.close()
    queue.close()
    queue.accept('\x1b[6n')
    await queue.drain()

    expect(replies).toEqual([])
    expect(queue.pending).toBe(false)
  })
})
