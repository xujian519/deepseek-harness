/**
 * Assemble `apps/desktop/resources/<os>/`: `pnpm deploy --prod` of the dsh CLI
 * backend plus the platform Node binary, then verify the deploy tree carries
 * every plugin the `desktop` profile resolves at boot. The Node binary and the
 * backend's native addons are platform-specific, so resources live in per-OS
 * directories (`mac`, `win`, `linux`) and the backend must be deployed on the
 * target OS; only the Node binary can be cross-downloaded with `--platform`.
 */

import { spawnSync } from 'node:child_process'
import {
  cpSync, existsSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  currentDesktopPlatform, DEFAULT_NODE_VERSION, downloadNode, nodeDownloadSpec,
} from './desktop-download-node.ts'

const ROOT = resolve(import.meta.dirname, '..')

/**
 * Resource directory name for a Node platform key: `darwin-*` lands in `mac`,
 * `win-*` in `win`, `linux-*` in `linux`.
 */
export function resourcesDirForPlatform(platform: string): string {
  if (platform.startsWith('darwin')) return 'mac'
  if (platform.startsWith('win')) return 'win'
  if (platform.startsWith('linux')) return 'linux'
  throw new Error(`unsupported platform for desktop resources: ${platform}`)
}

/** Deployed backend tree for a platform, under the desktop app resources. */
function backendResourcesDir(platform: string): string {
  return resolve(ROOT, 'apps', 'desktop', 'resources', resourcesDirForPlatform(platform), 'backend')
}

/** Embedded Node runtime directory for a platform, under the app resources. */
function nodeResourcesDir(platform: string): string {
  return resolve(ROOT, 'apps', 'desktop', 'resources', resourcesDirForPlatform(platform), 'node')
}

/** The cli build output the deploy carries; absent until `build:lib` ran. */
const CLI_BIN = resolve(ROOT, 'apps', 'cli', 'lib', 'bin.js')

/**
 * Relative paths the deployed backend must contain for the `desktop` profile
 * to boot: the cli entry, the Cordis core, the profile bundles, the plugins
 * the base/web-app bundles reference, and the built web frontend dist.
 */
const REQUIRED_BACKEND_PATHS = [
  'lib/bin.js',
  'node_modules/@deepseek-ai/cordis/package.json',
  'node_modules/@deepseek-ai/dsh-base/package.json',
  'node_modules/@deepseek-ai/dsh-web-app/package.json',
  'node_modules/@deepseek-ai/dsh-desktop-app/package.json',
  'node_modules/@deepseek-ai/dsh-llm/package.json',
  'node_modules/@deepseek-ai/dsh-session/package.json',
  'node_modules/@deepseek-ai/dsh-host-webserver/package.json',
  'node_modules/@deepseek-ai/dsh-host-apiproxy/package.json',
  'node_modules/@deepseek-ai/dsh-host-frontend-static/package.json',
  'node_modules/@deepseek-ai/dsh-subagent/package.json',
  'node_modules/@deepseek-ai/dsh-system-prompt/package.json',
  'node_modules/@deepseek-ai/dsh-tools/package.json',
  'node_modules/@deepseek-ai/dsh-settings-file/package.json',
  'node_modules/@deepseek-ai/dsh-llm-deepseek/package.json',
  'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html',
  'node_modules/js-yaml/package.json',
]

/** Missing relative paths in a deployed backend tree; empty when complete. */
export function verifyBackendDeploy(backendDir: string): string[] {
  return REQUIRED_BACKEND_PATHS.filter(path => !existsSync(join(backendDir, path)))
}

/**
 * Package names resolvable from the top level of a node_modules directory,
 * scoped names expanded to `@scope/name`. Broken or dangling entries are
 * ignored.
 */
export function topLevelPackageNames(nodeModulesDir: string): Set<string> {
  const names = new Set<string>()
  if (!existsSync(nodeModulesDir)) {
    return names
  }
  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === '.pnpm') continue
    if (entry.name.startsWith('@')) {
      if (!entry.isDirectory()) continue
      const scopeDir = join(nodeModulesDir, entry.name)
      for (const sub of readdirSync(scopeDir, { withFileTypes: true })) {
        if (sub.isDirectory() || sub.isSymbolicLink()) {
          names.add(`${entry.name}/${sub.name}`)
        }
      }
    } else if (entry.isDirectory() || entry.isSymbolicLink()) {
      names.add(entry.name)
    }
  }
  return names
}

/**
 * Every package inside a pnpm virtual store (`node_modules/.pnpm/<id>`),
 * keyed by full package name with the first occurrence winning. The store
 * directory for an entry holds the entry package itself plus the dependencies
 * it owns.
 */
export function virtualStorePackages(nodeModulesDir: string): Map<string, string> {
  const packages = new Map<string, string>()
  const storeDir = join(nodeModulesDir, '.pnpm')
  if (!existsSync(storeDir)) {
    return packages
  }
  for (const entry of readdirSync(storeDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const inner = join(storeDir, entry.name, 'node_modules')
    if (!existsSync(inner)) continue
    for (const item of readdirSync(inner, { withFileTypes: true })) {
      if (item.name.startsWith('@')) {
        if (!item.isDirectory()) continue
        const scopeDir = join(inner, item.name)
        for (const sub of readdirSync(scopeDir, { withFileTypes: true })) {
          if (!sub.isDirectory() && !sub.isSymbolicLink()) continue
          const fullName = `${item.name}/${sub.name}`
          if (!packages.has(fullName)) packages.set(fullName, join(scopeDir, sub.name))
        }
      } else if (item.isDirectory() || item.isSymbolicLink()) {
        if (!packages.has(item.name)) packages.set(item.name, join(inner, item.name))
      }
    }
  }
  return packages
}

/**
 * Link every virtual-store package into the top-level node_modules when no
 * same-named package resolves there, mirroring pnpm's default hoisting. The
 * dsh launcher resolves Cordis plugin names from its own install directory,
 * and `pnpm deploy` links only direct dependencies at the top level.
 * @returns the created link paths.
 */
export function hoistVirtualStore(nodeModulesDir: string): string[] {
  const created: string[] = []
  const topLevel = topLevelPackageNames(nodeModulesDir)
  for (const [name, realDir] of virtualStorePackages(nodeModulesDir)) {
    if (topLevel.has(name)) continue
    const linkPath = join(nodeModulesDir, ...name.split('/'))
    mkdirSync(dirname(linkPath), { recursive: true })
    // Relative so the packaged copy keeps resolving after installation.
    symlinkSync(relative(dirname(linkPath), realDir), linkPath, process.platform === 'win32' ? 'junction' : 'dir')
    created.push(linkPath)
  }
  return created
}

/** True when `dir` resolves inside `root` (path-wise, without symlinks). */
function isWithin(dir: string, root: string): boolean {
  const rel = relative(root, dir)
  return rel === '' || (!rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel) && rel !== '..')
}

/**
 * Replace every symlink whose target resolves outside the deployed tree with
 * a real copy of the target. pnpm `link:` dependencies (the vendored cosmokit
 * and schemastery, which depend on each other) stay relative links back into
 * the repository after deploy; in a packaged app those links dangle. The
 * external tree is copied recursively with every link re-pointed: in-tree
 * targets become relative links, other external targets are copied (once per
 * distinct target, re-pointing later links at the in-tree copy), which also
 * breaks the cosmokit/schemastery link cycle. In-tree links (the .pnpm store
 * and hoisted entries) are kept.
 * @returns the touched link paths.
 */
export function materializeExternalLinks(nodeModulesDir: string): string[] {
  const materialized: string[] = []
  const copies = new Map<string, string>()
  const linkType = process.platform === 'win32' ? 'junction' : 'dir'
  const copyExternal = (src: string, dest: string): void => {
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const srcPath = join(src, entry.name)
      const destPath = join(dest, entry.name)
      if (entry.isSymbolicLink()) {
        const resolved = resolve(dirname(srcPath), readlinkSync(srcPath))
        if (isWithin(resolved, nodeModulesDir)) {
          symlinkSync(relative(dirname(destPath), resolved), destPath, linkType)
        } else {
          const existing = copies.get(resolved)
          if (existing !== undefined) {
            symlinkSync(relative(dirname(destPath), existing), destPath, linkType)
          } else {
            copies.set(resolved, destPath)
            copyExternal(resolved, destPath)
          }
        }
        materialized.push(destPath)
      } else if (entry.isDirectory()) {
        mkdirSync(destPath, { recursive: true })
        copyExternal(srcPath, destPath)
      } else {
        cpSync(srcPath, destPath)
      }
    }
  }
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        const resolved = resolve(dirname(entryPath), readlinkSync(entryPath))
        if (isWithin(resolved, nodeModulesDir)) continue
        rmSync(entryPath)
        const existing = copies.get(resolved)
        if (existing !== undefined) {
          symlinkSync(relative(dirname(entryPath), existing), entryPath, linkType)
        } else {
          copies.set(resolved, entryPath)
          copyExternal(resolved, entryPath)
        }
        materialized.push(entryPath)
      } else if (entry.isDirectory()) {
        walk(entryPath)
      }
    }
  }
  walk(nodeModulesDir)
  return materialized
}

export interface PrepareResourcesOptions {
  /** Node platform key (defaults to the packager host). */
  platform?: string
  /** Re-download the Node binary even when already present. */
  forceNode?: boolean
  /** Do not download the Node binary (backend deploy only). */
  skipNode?: boolean
}

/** Deploy the backend and Node runtime into the platform's desktop resources. */
export async function prepareDesktopResources(options: PrepareResourcesOptions = {}): Promise<void> {
  if (!existsSync(CLI_BIN)) {
    throw new Error(`missing ${CLI_BIN}; run \`pnpm run build:lib\` (or \`pnpm run build:desktop\`) first`)
  }
  const platform = options.platform ?? currentDesktopPlatform()
  const backendDir = backendResourcesDir(platform)
  const nodeDir = nodeResourcesDir(platform)
  rmSync(backendDir, { recursive: true, force: true })
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const deploy = spawnSync(pnpm, ['--filter', '@deepseek-ai/dsh', 'deploy', '--legacy', '--prod', backendDir], {
    cwd: ROOT,
    stdio: 'inherit',
    encoding: 'utf8',
  })
  if (deploy.status !== 0) {
    throw new Error(`pnpm deploy failed (status ${String(deploy.status)})`)
  }
  // `pnpm deploy` rewrites the workspace state with its production/filter
  // context, which makes every later pnpm command treat the settings as
  // changed and auto-run `pnpm install --production`. Re-run a plain install
  // to restore the state the rest of the repo expects.
  const refresh = spawnSync(pnpm, ['install'], { cwd: ROOT, stdio: 'inherit', encoding: 'utf8' })
  if (refresh.status !== 0) {
    throw new Error(`pnpm install refresh failed (status ${String(refresh.status)})`)
  }
  // pnpm 11's deploy also writes an empty `apps/desktop/resources/...` module
  // skeleton into the vendored `link:` dependencies (vendor/schemastery). It
  // is 0-byte and untracked, but materializing it recursively copies repo
  // store content into the backend, so drop it before the link pass.
  const vendorSkeleton = resolve(ROOT, 'vendor', 'schemastery', 'apps')
  rmSync(vendorSkeleton, { recursive: true, force: true })
  // The deploy tree's virtual store mirrors the top-level node_modules under
  // `.pnpm/node_modules` (relative links into the same store entries). It is
  // redundant with the hoisted top level and makes electron-builder's 7za
  // compress the whole store twice, so remove it before the link pass.
  const storeMirror = join(backendDir, 'node_modules', '.pnpm', 'node_modules')
  rmSync(storeMirror, { recursive: true, force: true })
  const hoisted = hoistVirtualStore(join(backendDir, 'node_modules'))
  console.log(`hoisted ${hoisted.length} virtual-store packages to the top level`)
  const materialized = materializeExternalLinks(join(backendDir, 'node_modules'))
  if (materialized.length > 0) {
    console.log(`materialized ${materialized.length} out-of-tree symlinks in the backend`)
  }
  const missing = verifyBackendDeploy(backendDir)
  if (missing.length > 0) {
    throw new Error(`backend deploy is missing required paths: ${missing.join(', ')}`)
  }
  if (!options.skipNode) {
    const spec = nodeDownloadSpec(platform, DEFAULT_NODE_VERSION)
    const target = await downloadNode({ spec, targetDir: nodeDir, force: options.forceNode ?? false })
    console.log(`node ${spec.version} (${spec.platform}) -> ${target}`)
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      platform: { type: 'string' },
      'force-node': { type: 'boolean', default: false },
      'skip-node': { type: 'boolean', default: false },
    },
  })
  const command = positionals[0] ?? 'prepare'
  if (command !== 'prepare') {
    throw new Error(`unknown command: ${command}`)
  }
  const platform = values.platform ?? currentDesktopPlatform()
  await prepareDesktopResources({
    platform,
    forceNode: values['force-node'],
    skipNode: values['skip-node'],
  })
  console.log(`backend deploy -> ${backendResourcesDir(platform)}`)
  console.log(`node resources -> ${nodeResourcesDir(platform)}`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
