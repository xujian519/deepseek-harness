// Web e2e scenario: the durable PatentTeams chat card and the fixed Teams
// conversation view over the real web composition. No model call is involved
// — the seeded session log carries the `patent-teams/*` events, and the
// assertion chain is the whole delivery path: log replay → session history +
// live events → Conversation Node fold → the keyed chat card and the
// `patentTeams` view snapshot behind the Teams tab.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('./snapshots/patent-teams-panel/session.jsonl', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/patent-teams-panel', import.meta.url))
const CARD_EXPECTED = join(SNAPSHOT_DIR, 'card.expected.md')
const TEAMS_VIEW_EXPECTED = join(SNAPSHOT_DIR, 'teams-view.expected.md')
const MODE = webSnapshotMode()
const SEED_ID = 'patent-teams-panel-web-e2e'

describe.skipIf(MODE === 'record')('web e2e: patent-teams card and Teams view', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await readFile(FIXTURE, 'utf8'), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()

    // The folded card lands in the seeded turn once history replay reaches
    // the browser; its header is the team-name disclosure row.
    await page.locator('[data-patent-teams-card]').waitFor({ timeout: 15_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('renders the durable team card expanded with members, tasks, and verdicts', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-patent-teams-card'))
    const card = page.locator('[data-patent-teams-card]')
    await expect.poll(() => card.first().getAttribute('data-team-status')).toBe('active')
    // An active team mounts expanded; the header stays a disclosure control.
    await expect.poll(() => card.getByRole('button', { name: /search-team/ }).first().getAttribute('aria-expanded')).toBe('true')
    await card.getByText('alice').first().waitFor({ timeout: 10_000 })
    await card.getByText('Search CNIPR for the filing family').waitFor({ timeout: 10_000 })

    const snapshot = (await captureStableAria(page, '[data-patent-teams-card]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(CARD_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('shows the same fold behind the fixed Teams tab', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-patent-teams-view'))
    await page.getByRole('tab', { name: 'Teams' }).click()
    await page.locator('[data-patent-teams-team="search-team"]').waitFor({ timeout: 15_000 })
    const view = page.locator('[data-patent-teams-team="search-team"]')
    await view.getByText('Search CNIPR for the filing family').waitFor({ timeout: 10_000 })

    const snapshot = (await captureStableAria(page, '[data-patent-teams-team="search-team"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(TEAMS_VIEW_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.jsonl', 'card.expected.md', 'teams-view.expected.md'])
  })
})
