/** Reservation and process ownership across asynchronous preparation and cancellation. */
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createConnection, type Socket } from 'node:net'
import { join } from 'node:path'
import { once } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { RemoteProcesses } from '../src/helper-processes.ts'
import { authenticateStream } from '../src/stream-security.ts'

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return { ...actual, mkdir: vi.fn(actual.mkdir) }
})

const request = { argv: ['true'], cwd: '/tmp', graceMs: 100, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' } }

describe.skipIf(process.platform === 'win32')('SSH helper allocation ownership', () => {
  it('joins directory and listener allocation before completing close', async () => {
    const root = await mkdtemp('/tmp/dsh-ssh-life-')
    const owner = new RemoteProcesses(new Context(), root, 1, 5000)
    try {
      const prepared = owner.prepare(request)
      const rejected = expect(prepared).rejects.toThrow('closed')
      await owner.close()
      await rejected
      expect(await readdir(root)).toEqual([])
      await expect(owner.prepare(request)).rejects.toThrow('capacity unavailable')
    } finally { await owner.close(); await rm(root, { recursive: true, force: true }) }
  })

  it('reserves capacity before asynchronous listener allocation', async () => {
    const root = await mkdtemp('/tmp/dsh-ssh-life-')
    const owner = new RemoteProcesses(new Context(), root, 1, 5000)
    try {
      const first = owner.prepare(request)
      await expect(owner.prepare(request)).rejects.toThrow('capacity unavailable')
      await first
    } finally { await owner.close(); await rm(root, { recursive: true, force: true }) }
  })

  it('fails the reservation and removes its directory when a stream socket cannot bind', async () => {
    const root = await mkdtemp('/tmp/dsh-ssh-bind-')
    const owner = new RemoteProcesses(new Context(), root, 1, 5000)
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    try {
      vi.mocked(mkdir).mockImplementationOnce(async (path, options) => {
        await actual.mkdir(path, options)
        // A file at the reserved socket path makes the real bind fail with EADDRINUSE.
        await writeFile(join(String(path), 'stdout'), '')
      })
      await expect(owner.prepare(request)).rejects.toMatchObject({ code: 'EADDRINUSE' })
      expect(await readdir(root)).toEqual([])
    } finally { await owner.close(); await rm(root, { recursive: true, force: true }) }
  })

  it('does not publish a process after termination interrupts cwd resolution', async () => {
    const root = await mkdtemp('/tmp/dsh-ssh-life-')
    const ctx = new Context()
    const resolving = Promise.withResolvers<undefined>()
    const releaseCwd = Promise.withResolvers<never>()
    const spawn = vi.fn()
    ctx.provide('fs', {
      resolve: () => { resolving.resolve(undefined); return releaseCwd.promise }, processPath: () => root,
    } as never)
    ctx.provide('subprocess', { spawn } as never)
    const owner = new RemoteProcesses(ctx, root, 1, 5000)
    const sockets: Socket[] = []
    try {
      const prepared = await owner.prepare(request)
      for (const endpoint of Object.values(prepared.streams)) {
        const socket = createConnection(endpoint.path)
        await once(socket, 'connect')
        sockets.push(await authenticateStream(socket, endpoint.capability, 5000))
      }
      const started = owner.start(prepared.id)
      const rejected = expect(started).rejects.toThrow('termination requested')
      await resolving.promise
      const stopped = owner.terminate(prepared.id)
      releaseCwd.resolve({} as never)
      await Promise.all([stopped, rejected])
      expect(spawn).not.toHaveBeenCalled()
      expect(await readdir(root)).toEqual([])
    } finally {
      for (const socket of sockets) socket.destroy()
      await owner.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
