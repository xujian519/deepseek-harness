/**
 * `dsh plugin --profile <name> <args...>` — profile plugin management as a
 * thin pnpm forwarder: initialize the profile on first use, run
 * `pnpm <args...>` in the profile directory, then reconcile the
 * `dsh.profile.bundles` layer list against the installed state (a dependency
 * resolving to a package that declares `dsh.bundle` joins the layer stack; a
 * removed or bundle-less dependency leaves it). Reconciling by installed
 * state, not by dependency diff, means `update` activates a package that
 * gained its `dsh.bundle` declaration in a newer version.
 * @module @deepseek-ai/dsh/plugin
 */

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  DEFAULT_PROFILE_BUNDLES,
  divergentProfileCoreVersions,
  initProfile,
  PROFILE_TEMPLATES,
  profileCoreOverrides,
  readProfileManifest,
  resolveBundleDir,
  resolveProfileDir,
  writeProfileManifest,
  type ProfileManifest,
} from '@deepseek-ai/dsh-app-boot'
import { searchCatalog, fetchSourceManifest } from '@deepseek-ai/dsh-host-plugin-market/catalog'
import type { CatalogQuery, PluginMarketSource, SourceId } from '@deepseek-ai/dsh-host-plugin-market'
import { PluginMarketError } from '@deepseek-ai/dsh-host-plugin-market'
import { SOURCES_FILE, readSources, writeSources } from '@deepseek-ai/dsh-host-plugin-market/provider'
import { installPlugin, previewInstall, uninstallPlugin } from '@deepseek-ai/dsh-host-plugin-market/install'
import { INSTALL_ANCHOR } from './profile-boot.ts'

const NAME = 'dsh'

/** The `dsh plugin` verbs owned by the plugin-market pipeline, not pnpm. */
const MARKET_VERBS = new Set(['source', 'search', 'preview', 'install', 'uninstall'])

/**
 * Whether a resolved dependency exports a profile patch, i.e. is a bundle.
 * @param packageName - the dependency's package name.
 * @param profileDir - the profile directory (resolution anchor).
 * @returns true when the package manifest declares `dsh.bundle`.
 */
function exportsPatch(packageName: string, profileDir: string): boolean {
  let dir: string
  try {
    dir = resolveBundleDir(NAME, packageName, INSTALL_ANCHOR, profileDir)
  } catch {
    return false // pnpm reported success yet the package is unresolvable — treat as plain
  }
  const manifest = readProfileManifest(NAME, dir)
  return manifest.dsh?.bundle?.patch !== undefined
}

/**
 * Reconcile `dsh.profile.bundles` against the installed state: pnpm has
 * already written the real installed names (so a git/path/tarball/alias spec
 * on the command line reconciles by its true package name) and materialized
 * the packages. A dependency that resolves to a `dsh.bundle`-declaring
 * package joins the layer stack (appended in dependency order); a
 * dependency-listed name that no longer does — removed, or the installed
 * version dropped the declaration — leaves it. In-box bundles from the
 * profile template are not dependencies and are never touched. Warns once
 * per newly-added bundle-less dependency (a plain library is fine; the
 * warning is orientation).
 */
function reconcilePlugins(before: ProfileManifest, profileDir: string): void {
  const after = readProfileManifest(NAME, profileDir)
  const beforeDeps = new Set(Object.keys(before.dependencies ?? {}))
  const dependencies = Object.keys(after.dependencies ?? {})
  const plugins = after.dsh?.profile?.bundles ?? []
  let changed = false
  for (const packageName of dependencies) {
    const isBundle = exportsPatch(packageName, profileDir)
    if (isBundle && !plugins.includes(packageName)) {
      plugins.push(packageName)
      changed = true
    } else if (!isBundle && !beforeDeps.has(packageName)) {
      process.stderr.write(
        `${NAME}: warning: ${packageName} declares no dsh.bundle — installed as a plain dependency, not a profile layer `
        + '(a later update that gains one activates it automatically)\n',
      )
    }
  }
  const dependencySet = new Set(dependencies)
  for (const packageName of [...plugins]) {
    // Only dependency-managed entries are subject to removal; template
    // bundles (dsh-base and friends) are not dependencies.
    const wasDependency = beforeDeps.has(packageName) || dependencySet.has(packageName)
    const stillBundle = dependencySet.has(packageName) && exportsPatch(packageName, profileDir)
    if (wasDependency && !stillBundle) {
      plugins.splice(plugins.indexOf(packageName), 1)
      changed = true
    }
  }
  if (!changed) return
  after.dsh = { ...after.dsh, profile: { ...after.dsh?.profile, bundles: plugins } }
  writeProfileManifest(profileDir, after)
}

/**
 * Rewrite relative filesystem specs against the user's invoking directory.
 * pnpm runs with cwd = the profile directory, so a bare `.` or `../plugin`
 * (or their `file:`/`link:` forms) would silently resolve inside the profile
 * — `add .` from a plugin checkout would self-link the profile. Absolute
 * specs, registry names, and every other pnpm argument pass through
 * untouched.
 * @param argument - one pnpm argument, verbatim from argv.
 * @param cwd - the directory `dsh` was invoked from.
 * @returns the argument with a relative path spec anchored to `cwd`.
 */
function anchorPathSpec(argument: string, cwd: string): string {
  const match = /^(?<prefix>(?:file|link):)?(?<path>\.{1,2}(?:[/\\].*)?)$/.exec(argument)
  if (match?.groups?.path === undefined) return argument
  // A bare path stays bare and a prefixed spec keeps its prefix: pnpm's
  // link-vs-copy semantics differ between `file:` and a plain directory
  // path, and the anchor must not change which one the user asked for.
  const prefix = match.groups.prefix ?? ''
  return `${prefix}${resolve(cwd, match.groups.path)}`
}

/**
 * Run one `dsh plugin` invocation: init if needed, forward to pnpm, reconcile.
 * Market verbs (`source`, `search`, `preview`, `install`, `uninstall`) are
 * handled by the plugin-market pipeline instead of pnpm.
 * @param profile - the profile name.
 * @param args - pnpm arguments with relative path specs anchored to the invoking directory.
 * @returns the pnpm exit code.
 */
function runPlugin(profile: string, args: readonly string[]): number {
  const dir = resolveProfileDir(profile)
  if (!existsSync(join(dir, 'package.json'))) {
    const template = PROFILE_TEMPLATES[profile]
    initProfile(
      dir,
      template?.bundles ?? DEFAULT_PROFILE_BUNDLES,
      template?.patchReload,
      { overrides: profileCoreOverrides(INSTALL_ANCHOR) },
    )
    process.stderr.write(`${NAME}: initialized profile ${profile} at ${dir}\n`)
  }
  const before = readProfileManifest(NAME, dir)
  // Windows resolves pnpm through its .cmd shim, which spawn() refuses
  // without a shell since the CVE-2024-27980 hardening. stdout stays
  // inherited so progress and interactive pnpm flows keep their live
  // rendering; stderr is captured, echoed back verbatim, and kept for the
  // hint classification in {@link pnpmFailureHints}.
  const result = spawnSync('pnpm', args.map(argument => anchorPathSpec(argument, process.cwd())), {
    cwd: dir,
    stdio: ['inherit', 'inherit', 'pipe'],
    shell: process.platform === 'win32',
  })
  if (result.error !== undefined) {
    const code = (result.error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      process.stderr.write(`${NAME}: pnpm not found on PATH — install pnpm to manage profile plugins\n`)
      return 127
    }
    throw result.error
  }
  const stderr = result.stderr.toString()
  if (stderr.length > 0) process.stderr.write(stderr)
  const exitCode = result.status ?? 1
  if (exitCode === 0) {
    reconcilePlugins(before, dir)
    for (const divergent of divergentProfileCoreVersions(dir, INSTALL_ANCHOR)) {
      process.stderr.write(
        `${NAME}: warning: ${divergent} in profile ${profile} differs from the installation; `
        + `run 'pnpm install' in ${dir} so the scheduler handshake copies converge\n`,
      )
    }
  } else {
    process.stderr.write(`${NAME}: pnpm failed in profile directory ${dir}\n`)
    for (const line of pnpmFailureHints(stderr, dir)) process.stderr.write(`${line}\n`)
  }
  return exitCode
}

/**
 * Build the orientation lines printed after a failed pnpm run in a profile
 * directory. pnpm's own stderr is echoed verbatim before these lines; each
 * hint adds only what the diagnostics cannot know: which config home pnpm
 * 10.x actually enforces the git-hosted build allowlist from, and how a
 * store relocation is resolved. Failures matching neither class get no hint
 * — the forwarded spec's shape says nothing reliable about the cause.
 * @param stderr - the captured pnpm stderr text.
 * @param dir - the profile directory the pnpm run happened in.
 * @returns one complete stderr line per hint, without trailing newlines.
 */
export function pnpmFailureHints(stderr: string, dir: string): readonly string[] {
  if (stderr.includes('ERR_PNPM_UNEXPECTED_STORE')) {
    return [
      `${NAME}: this profile's node_modules was linked by a different pnpm major (the store location moved) — `
      + `run the pnpm major that installed the profile, or run 'pnpm install' in ${dir} to migrate the store, then re-run`,
    ]
  }
  if (stderr.includes('ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED')) {
    return [
      `${NAME}: git-hosted packages build via their prepare script, which pnpm blocks until allowlisted — add the exact `
      + `key pnpm printed above (name@<tarball-url-or-git-ref>) to "pnpm.onlyBuiltDependencies" in ${join(dir, 'package.json')}, `
      + 'then re-run (pnpm 10 enforces this from the package.json field even though its own output points at pnpm-workspace.yaml)',
    ]
  }
  return []
}

/**
 * Dispatch one `dsh plugin` invocation: market verbs run through the
 * plugin-market pipeline, everything else through the pnpm forwarder.
 * @param profile - the profile name.
 * @param args - the plugin arguments.
 * @returns the process exit code.
 */
export async function runPluginCommand(profile: string, args: readonly string[]): Promise<number> {
  if (MARKET_VERBS.has(args[0] ?? '')) return runMarket(profile, args)
  return runPlugin(profile, args)
}

/**
 * Run one market verb against the profile: source registration, catalog
 * search, preview, and the managed install/uninstall pipeline.
 * @param profile - the profile name.
 * @param args - the market verb and its arguments.
 * @returns the process exit code.
 */
async function runMarket(profile: string, args: readonly string[]): Promise<number> {
  const dir = resolveProfileDir(profile)
  const sourcesPath = join(dir, SOURCES_FILE)
  try {
    switch (args[0]) {
      case 'source':
        return await runSourceVerb(sourcesPath, args.slice(1))
      case 'search': {
        const query = parseSearchQuery(args.slice(1))
        let found = 0
        for (const source of readSources(sourcesPath)) {
          const page = await searchCatalog(source, query)
          for (const item of page.items) {
            process.stdout.write(`${item.package}@${item.version}\t${item.name}\t(from ${source.providerId})\n`)
            found += 1
          }
        }
        if (found === 0) process.stderr.write(`${NAME}: no catalog results (register a source with 'dsh plugin source add')\n`)
        return 0
      }
      case 'preview': {
        const ref = args[1]
        if (ref === undefined) return usage('preview <name@version>')
        const preview = await previewInstall(ref)
        process.stdout.write(
          `${preview.package}@${preview.version}: ${preview.verified ? 'verified' : 'rejected'}`,
        )
        for (const reason of preview.reasons) process.stdout.write(`\n  - ${reason}`)
        if (!preview.compatible) process.stdout.write('\n  - Node engine constraint not satisfied')
        process.stdout.write('\n')
        return preview.verified ? 0 : 1
      }
      case 'install': {
        const ref = args[1]
        if (ref === undefined) return usage('install <name@version>')
        const preview = await previewInstall(ref)
        if (!preview.verified) {
          process.stderr.write(`${NAME}: install rejected by preview: ${preview.reasons.join('; ') || 'unverified'}\n`)
          return 1
        }
        const before = readProfileManifest(NAME, dir)
        const receipt = installPlugin(dir, ref)
        reconcilePlugins(before, dir)
        process.stdout.write(`${NAME}: installed ${receipt.package}@${receipt.version} (receipt ${receipt.id})\n`)
        return 0
      }
      case 'uninstall': {
        const receiptId = args[1]
        if (receiptId === undefined) return usage('uninstall <receipt-id>')
        const before = readProfileManifest(NAME, dir)
        uninstallPlugin(dir, receiptId)
        // Mirror the install path: a removed market package must leave the
        // bundle layer list, or the next profile load cannot resolve it.
        reconcilePlugins(before, dir)
        process.stdout.write(`${NAME}: uninstalled receipt ${receiptId}\n`)
        return 0
      }
      default:
        return usage(args[0] ?? '')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${NAME}: ${error instanceof PluginMarketError ? error.code : 'plugin-market'} error: ${message}\n`)
    return 1
  }
}

/** Handle the `source` verb's subcommands. */
async function runSourceVerb(sourcesPath: string, args: readonly string[]): Promise<number> {
  switch (args[0]) {
    case 'list':
      for (const source of readSources(sourcesPath)) {
        process.stdout.write(`${source.id}\t${source.providerId}\t${source.endpoint}\n`)
      }
      return 0
    case 'add': {
      const url = args[1]
      if (url === undefined) return usage('source add <manifest-url>')
      const source = await fetchSourceManifest(url)
      const sources = readSources(sourcesPath)
      const existing = sources.find(candidate => candidate.providerId === source.providerId)
      // The host identity is minted like the service provider's: a fresh UUID
      // on first registration, the existing id preserved on re-add.
      const persisted: PluginMarketSource = {
        ...source,
        id: existing?.id ?? (randomUUID() as SourceId),
      }
      const next = existing === undefined ? [...sources, persisted]
        : sources.map(candidate => candidate.providerId === existing.providerId ? persisted : candidate)
      writeSources(sourcesPath, next)
      process.stdout.write(`${NAME}: registered source ${persisted.id} (${source.name})\n`)
      return 0
    }
    case 'remove': {
      const id = args[1]
      if (id === undefined) return usage('source remove <id>')
      const sources = readSources(sourcesPath)
      const next = sources.filter(source => source.id !== id)
      if (next.length === sources.length) {
        process.stderr.write(`${NAME}: no source ${id}\n`)
        return 1
      }
      writeSources(sourcesPath, next)
      process.stdout.write(`${NAME}: removed source ${id}\n`)
      return 0
    }
    default:
      return usage('source <list|add|remove>')
  }
}

/** Parse the search verb's `key=value` arguments into a query. */
function parseSearchQuery(args: readonly string[]): CatalogQuery {
  const query: CatalogQuery = {}
  for (const argument of args) {
    const separator = argument.indexOf('=')
    if (separator <= 0) continue
    const key = argument.slice(0, separator) as keyof CatalogQuery
    const value = argument.slice(separator + 1)
    if (key === 'limit') query.limit = Number(value)
    else (query as Record<string, string>)[key] = value
  }
  return query
}

/** Print a usage line and return the usage exit code. */
function usage(expectation: string): number {
  process.stderr.write(`${NAME}: usage: dsh plugin ${expectation}\n`)
  return 2
}
