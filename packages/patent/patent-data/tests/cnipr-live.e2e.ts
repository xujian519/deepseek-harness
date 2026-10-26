// CNIPR 真机探测：真实 ego lite 会话与 search.cnipr.com 登录态，覆盖「生成脚本 →
// 页面交互 → 收据读取」整条链路。单测只能验证脚本文本与页面回调的作用域，页面本身
// 的变化（表单、结果行、直链布局）只有这里能看到。
//
// 默认跳过：探测会驱动真实站点并占用部署的登录态，必须显式设置 DSH_CNIPR_LIVE=1。
// 没有 ego-browser 的机器同样跳过。
import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { CniprChannel, EgoBrowserSession } from '@deepseek-ai/dsh-patent-data'
import type { EgoSpawnResult, EgoSpawnRunner, EgoSpawnSpec } from '@deepseek-ai/dsh-patent-data'

/** Opt-in switch for driving the live site. */
const LIVE_ENV = 'DSH_CNIPR_LIVE'

/** SIGTERM-to-SIGKILL grace after a run exceeds its deadline. */
const KILL_GRACE_MS = 3_000

/** Spawn ego-browser directly: the live probe owns its process, not the product subprocess seam. */
const liveRunner: EgoSpawnRunner = {
  async spawn(spec: EgoSpawnSpec): Promise<EgoSpawnResult> {
    const [command, ...args] = spec.argv
    if (command === undefined) throw new Error('ego-browser spawn spec has no command')
    const startedAt = Date.now()
    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: spec.cwd, env: spec.env })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS).unref()
      }, spec.timeoutMs)
      timer.unref()
      const abort = (): void => { child.kill('SIGTERM') }
      spec.signal?.addEventListener('abort', abort, { once: true })
      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
      child.on('error', reject)
      child.on('close', (exitCode) => {
        clearTimeout(timer)
        spec.signal?.removeEventListener('abort', abort)
        resolve({ exitCode, stdout, stderr, timedOut, durationMs: Date.now() - startedAt })
      })
      child.stdin?.end(spec.stdinData ?? '')
    })
  },
}

function skipReason(): string | undefined {
  if (process.env[LIVE_ENV] !== '1') return `set ${LIVE_ENV}=1 to drive the live CNIPR site`
  const availability = new EgoBrowserSession().checkAvailability()
  return availability.ok ? undefined : availability.reason
}

const reason = skipReason()

describe.skipIf(reason !== undefined)('CNIPR channel against the live site', () => {
  const channel = new CniprChannel({
    session: new EgoBrowserSession({ runner: liveRunner }),
    cwd: process.cwd(),
  })

  it('takes a CN publication number to its full-text link', { timeout: 180_000 }, async () => {
    const [item] = await channel.pdfLinks(['CN113833595A'])
    expect(item?.error).toBeUndefined()
    expect(item?.urls[0]).toMatch(/^http:\/\/pic\.cnipr\.com\/pdfcn\//)
  })

  it('returns titled rows for a keyword search', { timeout: 180_000 }, async () => {
    const result = await channel.search('石墨烯电池', { limit: 3 })
    expect(result.total).toBeGreaterThan(0)
    expect(result.hits.length).toBeGreaterThan(0)
    expect(result.hits[0]?.patent).not.toBe('')
    expect(result.hits[0]?.title).not.toBe('')
    expect(result.hits[0]?.publicationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('resolves a legal status for an application number', { timeout: 180_000 }, async () => {
    const [item] = await channel.legalStatus(['2023113560975'])
    expect(item?.error).toBeUndefined()
    expect(item?.records.length).toBeGreaterThan(0)
  })
})
