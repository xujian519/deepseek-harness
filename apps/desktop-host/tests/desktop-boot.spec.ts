import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { apply as sidebarApply, name as sidebarName, inject as sidebarInject } from '@deepseek-ai/dsh-better-sidebar'
import { PortlessWebServer } from '../src/index.ts'

/**
 * Boot harness for the portless desktop surface. A full desktop-composition
 * unit boot is impossible here — the profile's plugin set is hoisted only into
 * a pnpm-deployed project (packages/bundle/* live as separate workspaces) — so
 * this boots a real cordis composition that activates the first-party sidebar
 * against the host-provided portless webServer/webRuntime, then serves one of
 * its fenced routes through the seam.
 *
 * The sidebar is wired through a fixture module (the same pattern as the
 * headless/web startup boots) rather than its bare package name: Loader's
 * native resolver walks the package `exports` to the built `lib/`, which CI
 * source plane never builds. The fixture delegates to the source-plane `apply`
 * imported here, so the composition exercises the real host half without an
 * artifact plane.
 */
describe('desktop composition boots the portless sidebar surface', () => {
  it('activates better-sidebar and serves its routes over the portless seam', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-boot-'))
    const root = join(dir, 'desktop.cordis.yml')
    // The fixture re-exports the sidebar plugin via the imported source-plane
    // apply, so Loader resolves it without reaching the package `exports`.
    const plugin = join(dir, 'sidebar-plugin.mjs')
    writeFileSync(plugin, [
      `export const name = ${JSON.stringify(sidebarName)}`,
      `export const inject = ${JSON.stringify(sidebarInject)}`,
      'export const apply = ctx => globalThis.__dshSidebarApply(ctx)',
      '',
    ].join('\n'))
    writeFileSync(root, JSON.stringify([{ id: 'better-sidebar', name: pathToFileURL(plugin).href }]))
    const hostDir = fileURLToPath(new URL('..', import.meta.url))
    const hostUrl = pathToFileURL(hostDir).href
    const web = new PortlessWebServer()
    const globals = globalThis as unknown as { __dshSidebarApply: typeof sidebarApply }
    globals.__dshSidebarApply = sidebarApply
    const ctx = await boot('dsh desktop', root, [], (hostCtx) => {
      hostCtx.provide('webServer', web)
      // The renderer loads dsh-app://app, so its Host authority is 'app'.
      hostCtx.provide('webRuntime', { trustedHosts: ['app'] })
      hostCtx.provide('sessions', { get: () => undefined })
      hostCtx.provide('tools', { register: () => () => {} })
    }, hostUrl)
    try {
      // The sidebar's /sidebar/upload route reads sessionId et al. and answers
      // the missing-parameter case with 400; a 404 would mean the route never
      // mounted (the asset handler answered instead). The fence treats the
      // renderer's Authority as trusted, so the request carries Host: app.
      const response = await web.dispatch(new Request('http://app/sidebar/upload', {
        method: 'POST',
        headers: { host: 'app' },
      }))
      expect(response).not.toBeNull()
      expect(response!.status).toBe(400)
    } finally {
      await ctx.fiber.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
