// Web e2e scenario: the fixed Deliverables conversation view over the real web
// composition. No model call is involved — the seeded session log carries one
// `document_deliver` registration call, and the assertion chain is the whole
// delivery path: log replay → session history → Conversation Node fold → the
// `documentDeliverables` view snapshot behind the Deliverables tab → the
// preview read of a produced file through the session's `workspaceFiles`
// Remote. The tab is activated by its slot id, so this guards the
// slot-id-equals-target contract: a mismatched id leaves the target
// unactivated and the view stuck on its empty state, which is exactly the
// regression this scenario rejects.
import { readFile, writeFile } from 'node:fs/promises'
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

const FIXTURE = fileURLToPath(new URL('./snapshots/document-studio-panel/session.jsonl', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/document-studio-panel', import.meta.url))
const STUDIO_EXPECTED = join(SNAPSHOT_DIR, 'studio.expected.md')
const MODE = webSnapshotMode()
const SEED_ID = 'document-studio-panel-web-e2e'

// The registration log names the produced files; the preview reads their bytes
// from the Session workspace, so the scenario writes the same two paths there.
const CLAIMS_HTML = '<!doctype html><h1>CLAIMS_FIXTURE</h1>'
const SPECIFICATION_MD = '# SPECIFICATION_FIXTURE\n\nDelivered claims, as text.'

describe.skipIf(MODE === 'record')('web e2e: document studio Deliverables view', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await readFile(FIXTURE, 'utf8'), SEED_ID)
    await writeFile(join(scaffold.workspaceCwd, 'claims.html'), CLAIMS_HTML)
    await writeFile(join(scaffold.workspaceCwd, 'specification.md'), SPECIFICATION_MD)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('renders the delivered files behind the fixed Deliverables tab', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-document-studio-view'))
    await page.getByRole('tab', { name: 'Deliverables' }).click()
    // The folded list lands once the shell activates the `documentDeliverables`
    // target by its slot id; a missing list means the view never activated.
    const list = page.locator('[data-document-deliverables-list]')
    await list.waitFor({ timeout: 15_000 })
    await list.locator('[data-document-deliverable="specification.md"]').waitFor({ timeout: 10_000 })
    await list.locator('[data-document-deliverable="claims.html"]').waitFor({ timeout: 10_000 })

    const snapshot = await captureStableAria(page, '[data-document-deliverables-list]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(STUDIO_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.jsonl', 'studio.expected.md'])
  })

  it('previews a produced file through the session workspace read', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-document-studio-preview'))
    await page.getByRole('tab', { name: 'Deliverables' }).click()
    const list = page.locator('[data-document-deliverables-list]')
    await list.waitFor({ timeout: 15_000 })
    // HTML renders in the sandboxed frame, whose document is the host read.
    await list.locator('[data-document-deliverable="claims.html"]').click()
    const frame = page.locator('iframe[title="claims.html"]')
    await expect.poll(() => frame.getAttribute('srcdoc'), { timeout: 15_000 }).toContain('CLAIMS_FIXTURE')
    expect(await frame.getAttribute('sandbox')).toBe('')
    // Markdown renders as text in the pane instead.
    await list.locator('[data-document-deliverable="specification.md"]').click()
    await page.getByText('SPECIFICATION_FIXTURE', { exact: false }).first().waitFor({ timeout: 15_000 })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
