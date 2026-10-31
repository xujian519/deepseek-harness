/**
 * Keyless video-studio smoke: a video-preset session creates a project through
 * the real `video_project` tool, the production board discovers it, renders
 * shots, renders, the pending task, the ledger, and a Range-served media
 * preview, hands the file to the sidebar video renderer, and stacks at a phone
 * width.
 */
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/video-preset/session.v4.jsonl', import.meta.url))
const PROMPT = 'Call the video_project tool once with action init and title "Keyless Boot", then reply exactly VIDEO_SNAPSHOT_OK and stop.'
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const SHOT_DIR = fileURLToPath(new URL('../../../.artifacts/screenshots/video-studio', import.meta.url))
const run = promisify(execFile)

/** A one-second vertical clip; ffmpeg is a video-mode host prerequisite. */
async function clip(path: string): Promise<void> {
  await run('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#2a4a6b:s=320x568:d=1:r=24',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path,
  ])
}

async function successShot(page: Page, name: string): Promise<void> {
  await mkdir(SHOT_DIR, { recursive: true })
  await page.screenshot({ path: join(SHOT_DIR, `${name}-${process.pid}.png`), fullPage: true })
}

describe('video studio', () => {
  let ffmpeg = true
  let scaffold: WebScaffold
  let browser: Browser | undefined

  beforeAll(async () => {
    try {
      await run('ffmpeg', ['-version'])
    } catch {
      ffmpeg = false
    }
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, paceMs: 5, compareReplaySession: false })
  })

  afterAll(async () => {
    if (browser !== undefined) await browser.close()
    await scaffold.close()
  })

  it.skipIf(!ffmpeg)('renders a discovered project, previews media, and stacks on a phone', async () => {
    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    const consoleErrors = watchConsole(page)
    onTestFailed(async () => { await saveFailureShot(page, `screenshots/video-studio/failure-${process.pid}`) })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    // Select the video preset in the composer, then drive the recorded turn.
    await page.getByRole('button', { name: 'Standard mode', exact: true }).click()
    await page.getByRole('menuitem', { name: /^视频模式/ }).first().click()
    await page.getByRole('button', { name: '视频模式', exact: true }).waitFor({ timeout: 15_000 })
    const settled = scaffold.whenTurnSettled()
    const input = page.locator('[data-composer-input]').first()
    await input.fill(PROMPT)
    await input.press('Enter')
    await page.getByText('VIDEO_SNAPSHOT_OK', { exact: true }).waitFor({ timeout: 30_000 })
    const sessionId = await settled
    const cwd = scaffold.ctx.agents.get(sessionId)?.session.header.cwd
    if (cwd === undefined) throw new Error('settled Session has no workspace cwd')

    const root = join(cwd, 'video', 'keyless-boot')
    await mkdir(join(root, 'shots'), { recursive: true })
    await mkdir(join(root, 'out'), { recursive: true })
    await writeFile(join(root, 'shots', 's01.png'), TINY_PNG)
    await clip(join(root, 'shots', 's01.mp4'))
    await clip(join(root, 'out', 'ep01.mp4'))
    await writeFile(join(root, 'project.json'), `${JSON.stringify({
      schemaVersion: 1,
      id: 'keyless-boot',
      title: 'Studio Smoke',
      aspect: '9:16',
      targetSeconds: 30,
      budgetCny: 10,
      shots: [{
        id: 's01', index: 1, prompt: 'A door opens', durationSec: 1, status: 'ready',
        keyframePath: 'video/keyless-boot/shots/s01.png', clipPath: 'video/keyless-boot/shots/s01.mp4',
        provider: 'comfyui', model: 'wan2.2-ti2v-5b', costCny: 2,
      }],
      renders: [{ id: 'r1', path: 'video/keyless-boot/out/ep01.mp4', durationSec: 1, costCny: 3, createdAt: '2026-10-01T10:00:00.000Z' }],
      createdAt: '2026-10-01T09:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
    }, null, 2)}\n`)
    await writeFile(join(root, 'budget.json'), `${JSON.stringify({
      schemaVersion: 1,
      entries: [{ taskId: 't1', kind: 'video', model: 'MiniMax-H3', costCny: 3, at: '2026-10-01T10:00:00.000Z' }],
    })}\n`)
    await writeFile(join(root, 'tasks.json'), `${JSON.stringify({
      schemaVersion: 1,
      tasks: [{
        task: { id: 't2', provider: 'minimax', model: 'MiniMax-H3', kind: 'video', status: 'running' },
        submittedAt: 1,
        request: { kind: 'video', model: 'MiniMax-H3', prompt: 'She turns', durationSec: 4 },
        outputPath: 'video/keyless-boot/shots/s02.mp4',
      }],
    })}\n`)

    await page.getByRole('tab', { name: 'Video', exact: true }).click()
    const board = page.locator('[data-video-studio]')
    await board.waitFor({ timeout: 15_000 })
    await expect.poll(() => board.getByText('Studio Smoke', { exact: true }).count()).toBe(1)
    await expect.poll(() => board.getByText('3.00 / 10.00 CNY', { exact: true }).count()).toBe(1)
    await expect.poll(() => board.getByText('A door opens', { exact: true }).count()).toBe(1)
    await expect.poll(() => board.getByText('video · MiniMax-H3 · Running', { exact: true }).count()).toBe(1)
    await expect.poll(() => board.getByText('Cost 3.00 CNY', { exact: true }).count()).toBe(1)
    const preview = board.locator('[data-video-studio-video] video')
    await expect.poll(async () => (await preview.getAttribute('src'))?.includes('/api/file?')).toBe(true)
    await expect.poll(async () => (await preview.getAttribute('src'))?.includes('s01.mp4')).toBe(true)
    await successShot(page, 'desktop')

    await board.getByText('ep01.mp4', { exact: true }).click()
    await expect.poll(async () => (await preview.getAttribute('src'))?.includes('ep01.mp4')).toBe(true)

    // The sidebar renderer streams the same versioned route.
    if (await page.locator('[data-sidebar-right-expand]').isVisible()) {
      await page.locator('[data-sidebar-right-expand]').click()
    }
    await board.getByRole('button', { name: 'Open in sidebar', exact: true }).click()
    const sidebar = page.locator('[data-rightbar-col]')
    await sidebar.locator('[data-video-preview]').waitFor({ timeout: 15_000 })
    await expect.poll(async () => (await sidebar.locator('[data-video-preview] video').getAttribute('src'))?.includes('/api/file?')).toBe(true)

    // Close the preview tab so the narrow board is the visible surface.
    const activeTab = sidebar.locator('[data-dockkit-tab][aria-selected="true"]')
    await activeTab.hover()
    await activeTab.locator('[data-dockkit-tab-close]').click()
    if (await page.locator('[data-sidebar-right-toggle]').isVisible()) {
      await page.locator('[data-sidebar-right-toggle]').click()
    }
    await page.setViewportSize({ width: 390, height: 844 })
    const columns = page.locator('[data-video-studio-columns]')
    await expect.poll(() => columns.evaluate(node => getComputedStyle(node).flexDirection)).toBe('column')
    // The preview pane follows the lists instead of sitting beside them.
    await expect.poll(() => columns.evaluate((node) => {
      const preview = node.querySelector('[data-video-studio-preview]')?.getBoundingClientRect()
      const lists = node.firstElementChild?.getBoundingClientRect()
      return preview !== undefined && lists !== undefined && preview.top >= lists.bottom
    })).toBe(true)
    await expect.poll(() => columns.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await successShot(page, 'phone')
    expect(consoleErrors.pageErrors).toEqual([])
  })
})
