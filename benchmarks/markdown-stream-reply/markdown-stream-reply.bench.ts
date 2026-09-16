/**
 * Long single-block streaming reply in the shipped Web composition: one
 * paragraph arriving four times faster than a 60 Hz frame, so the renderer can
 * freeze none of it and every frame re-parses the whole reply.
 *
 * The case reports the main-thread share, the longest task, and how many tasks
 * crossed a frame — and asserts only that the complete reply reaches the
 * transcript, which is the guarantee frame admission must not break. It
 * enforces no timing budget yet: `benchmarks/AGENTS.md` admits a budget only
 * after repeated measurements on CI hardware, and the reported numbers are
 * that record. Measured on macOS arm64, headless Chromium 141, 1202 chunks of
 * 340 characters (408 KB) at 2 ms pacing — shared TaskDuration across the
 * stream: 2512 ms of 2949 ms (85%), 13 tasks over 50 ms, before admission;
 * 1724 ms of 3013 ms (57%), 5 tasks over 50 ms, with it. A future budget would
 * bound the share (this run: 57%) rather than a duration, because the share is
 * dimensionless and both of its terms scale with the machine.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { chromium } from 'playwright'
import type { CDPSession, Page } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole, webSnapshotMode } from '../../apps/web/tests/scaffold.ts'
import { newEnglishPage } from '../../apps/web/tests/support.ts'
import { BLOCK_CHUNKS, DONE, FIRST, PACE_MS, SESSION_ID } from './markdown-stream.constants.ts'
import { blockReply, blockReplyText, streamingHistory } from './markdown-stream.fixture.ts'

/** Main-thread task time Chromium has accounted for so far, in milliseconds. */
async function taskMs(cdp: CDPSession): Promise<number> {
  const result = await cdp.send('Performance.getMetrics')
  const metric = result.metrics.find(entry => entry.name === 'TaskDuration')
  if (metric === undefined) throw new Error('Chromium TaskDuration missing')
  return metric.value * 1000
}

async function painted(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

/** The latest Assistant step's text, read the way the transcript shows it. */
async function latestReply(page: Page): Promise<string> {
  return page.evaluate(() => Array.from(document.querySelectorAll('[data-chat-flow-kind="assistant-step"]')).at(-1)?.textContent ?? '')
}

/** Resolve once the latest Assistant step shows visible `marker` text after the pacing. */
async function waitForMarker(page: Page, marker: string, timeout: number): Promise<void> {
  await page.waitForFunction((expected: string) => {
    const reply = Array.from(document.querySelectorAll('[data-chat-flow-kind="assistant-step"]')).at(-1)
    if (reply === undefined) return false
    const walk = document.createTreeWalker(reply, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walk.nextNode()) !== null) {
      if (node.textContent?.includes(expected) === true && node.parentElement?.checkVisibility({ checkVisibilityCSS: true }) === true) return true
    }
    return false
  }, marker, { polling: 'raf', timeout })
}

it('reports the main-thread cost of a long single-block stream and its completeness', async () => {
  if (webSnapshotMode() !== 'replay') throw new Error('browser benchmarks require keyless replay mode')
  const failures: unknown[] = []
  const root = await mkdtemp(join(tmpdir(), 'dsh-markdown-stream-'))
  try {
    const replayOverride = join(root, 'reply.json')
    await writeFile(replayOverride, JSON.stringify([{ kind: 'chunks', chunks: blockReply() }]))
    const scaffold = await launchWebScaffold({
      replayFixture: join(root, 'override-only.jsonl'),
      replayOverride,
      paceMs: PACE_MS,
      replayContextWindow: 10_000_000,
    })
    try {
      await seedSession(scaffold, streamingHistory(), SESSION_ID)
      const browser = await chromium.launch({ headless: true })
      try {
        const page = await newEnglishPage(browser)
        const consoleWatch = watchConsole(page)
        page.setDefaultTimeout(60_000)
        await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
        await page.waitForSelector('[class*="frame"]')
        await page.getByRole('treeitem').first().click()
        const turn = page.getByRole('treeitem').nth(1)
        await turn.waitFor()
        await turn.click()
        const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
        await composer.waitFor()
        const cdp = await page.context().newCDPSession(page)
        await cdp.send('Performance.enable')
        // Long tasks are the frames the user feels: the stream must not block
        // the thread for a whole animation frame, let alone for seconds.
        await page.evaluate(() => {
          (globalThis as unknown as { longTasks: number[] }).longTasks = []
          new PerformanceObserver(list => {
            for (const entry of list.getEntries()) (globalThis as unknown as { longTasks: number[] }).longTasks.push(entry.duration)
          }).observe({ entryTypes: ['longtask'] })
        })
        await composer.fill('Stream the long block now.')
        const settled = scaffold.whenTurnSettled(120_000).then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error }),
        )
        const beforeTask = await taskMs(cdp)
        const startedAt = performance.now()
        await page.keyboard.press('Enter')
        await waitForMarker(page, DONE, 120_000)
        const reachedDoneMs = performance.now() - startedAt
        const settlement = await settled
        if (!settlement.ok) throw settlement.error
        await painted(page)
        const streamWallMs = performance.now() - startedAt
        const streamTaskMs = await taskMs(cdp) - beforeTask
        const longTasks = await page.evaluate(() => (globalThis as unknown as { longTasks: number[] }).longTasks)
        const reply = await latestReply(page)
        const expected = blockReplyText()
        console.log(JSON.stringify({
          benchmark: 'markdown-stream-reply',
          blockChars: expected.length,
          chunks: BLOCK_CHUNKS + 2,
          paceMs: PACE_MS,
          reachedDoneMs,
          streamWallMs,
          streamTaskMs,
          dutyPct: streamTaskMs / streamWallMs * 100,
          longTasks: longTasks.length,
          maxLongTaskMs: longTasks.length === 0 ? 0 : Math.max(...longTasks),
          replyComplete: reply.includes(DONE),
          replyChars: reply.length,
          expectedChars: expected.length,
        }))
        expect(consoleWatch.pageErrors).toEqual([])
        expect(reply.includes(FIRST)).toBe(true)
        expect(reply.includes(DONE)).toBe(true)
        expect(reply).toBe(expected)
      } catch (error) { failures.push(error) } finally {
        await browser.close().catch((error: unknown) => failures.push(error))
      }
    } catch (error) { failures.push(error) } finally {
      await scaffold.close().catch((error: unknown) => failures.push(error))
    }
  } catch (error) { failures.push(error) } finally {
    await rm(root, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
  }
  if (failures.length > 0) throw new AggregateError(failures, 'markdown stream benchmark failed')
})
