#!/usr/bin/env node
/** Keyless smoke driver: apply the real OpenDesign overlay, then print the skill catalog. */

import { fileURLToPath } from 'node:url'
import { boot, installFailLoud, loadOverlayPatches, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
// The overlay mounts the skill registry; this import merges `Context.skills` into the cordis type.
import type {} from '@deepseek-ai/dsh-skill'

const NAME = 'opendesign-smoke-driver'
const [baseConfigPath] = process.argv.slice(2)
if (baseConfigPath === undefined) {
  throw new Error(`${NAME}: expected <base-config-path>`)
}

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Awaited<ReturnType<typeof boot>> | undefined
try {
  // Parse the real overlay with the same schema and apply it through the same
  // patch algorithm the dsh app uses for `--patch` files and user layers.
  const overlayPath = fileURLToPath(new URL('../../cordis.yml', import.meta.url))
  const patches = loadOverlayPatches(NAME, overlayPath)
  ctx = await boot(NAME, resolveConfigPath(baseConfigPath, undefined), patches)
  const names = (await ctx.skills.list()).map(skill => skill.name).sort()
  process.stdout.write(`SKILL_CATALOG ${names.join(',')}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
