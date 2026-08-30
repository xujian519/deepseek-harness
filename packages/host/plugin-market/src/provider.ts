/**
 * Default `ctx.pluginMarket` provider: persists registered catalog sources
 * under the profile, and composes the catalog client with the managed install
 * pipeline. Directory defaults come from the provider config so the same
 * package serves both the web host and the CLI.
 * @module @deepseek-ai/dsh-host-plugin-market/provider
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { CatalogPage, CatalogQuery, InstallPreview, InstallReceipt, PluginMarketSource, SourceId } from './index.ts'
import PluginMarket, { PluginMarketError } from './index.ts'
import { fetchSourceManifest, searchCatalog } from './catalog.ts'
import { BUILTIN_SOURCE, BUILTIN_SOURCE_ID, searchBuiltinCatalog } from './builtin-catalog.ts'
import { DEFAULT_REGISTRY, installPlugin, listReceipts, previewInstall, readReceipt, receiptDirFor, uninstallPlugin, type InstallOptions } from './install.ts'

/** Provider configuration; the Loader-facing schema is {@link Config}. */
export interface ProviderConfig {
  /**
   * Profile directory whose package manager this provider drives. Optional: a
   * deployment without a writable profile (the web host) omits it and gets a
   * read-only discovery mode — {@link listSources}/{@link search}/{@link preview}
   * work, while {@link install}/{@link uninstall}/{@link listInstallations}
   * reject with `install-unavailable`, steering installs to the profile CLI.
   * At least one of `profileDir`/`sourceFile` must be set; neither means there
   * is no place to persist registered sources.
   */
  profileDir?: string
  /** File persisting registered sources (default `<profileDir>/.dsh-plugin-market/sources.json`). */
  sourceFile?: string
  /** npm registry for previews (default the public registry). */
  registry?: string
  /** Package-manager runner (defaults to `pnpm`). */
  runPnpm?: (cwd: string, args: readonly string[]) => { status: number; stderr: string }
}

/** Loader-facing config schema; `profileDir`/`sourceFile`/`registry` default to the empty sentinel. */
export const Config: z<ProviderConfig> = z.object({
  profileDir: z.string().default(''),
  sourceFile: z.string().default(''),
  registry: z.string().default(DEFAULT_REGISTRY),
})

/** The sources file name under the profile. */
export const SOURCES_FILE = '.dsh-plugin-market/sources.json'

/** The provider implementation behind `ctx.pluginMarket`. */
export class MarketProvider extends PluginMarket {
  private readonly sourcesPath: string
  private readonly ownedProfileDir: string | undefined

  constructor(ctx: Context, private readonly config: ProviderConfig) {
    super(ctx)
    const profileDir = config.profileDir === '' ? undefined : config.profileDir
    this.ownedProfileDir = profileDir
    const persistedSources = config.sourceFile ?? (
      profileDir === undefined ? undefined : join(profileDir, SOURCES_FILE)
    )
    if (persistedSources === undefined) {
      throw new PluginMarketError(
        'source-invalid',
        'plugin-market needs a sourceFile or a profileDir to persist registered sources',
      )
    }
    this.sourcesPath = persistedSources
  }

  override listSources(): Promise<readonly PluginMarketSource[]> {
    // The bundled source is always present and never persisted; user sources
    // are read from the sources file.
    return Promise.resolve([BUILTIN_SOURCE, ...readSources(this.sourcesPath)])
  }

  override async addSource(url: string): Promise<PluginMarketSource> {
    let source: PluginMarketSource
    try {
      source = await fetchSourceManifest(url)
    } catch (error) {
      /* v8 ignore next -- fetchSourceManifest throws Error instances only. */
      throw new PluginMarketError('source-invalid', error instanceof Error ? error.message : String(error))
    }
    const sources = readSources(this.sourcesPath)
    // The fetched manifest's id equals its providerId; match the persisted
    // providerId so re-adding a source updates it instead of duplicating.
    const existing = sources.find(candidate => candidate.providerId === source.providerId)
    const persisted: PluginMarketSource = {
      ...source,
      id: existing?.id ?? (randomUUID() as SourceId),
    }
    const next = existing === undefined
      ? [...sources, persisted]
      : sources.map(candidate => candidate.id === existing.id ? persisted : candidate)
    writeSources(this.sourcesPath, next)
    return persisted
  }

  override removeSource(id: string): Promise<void> {
    if (id === BUILTIN_SOURCE_ID) {
      return Promise.reject(new PluginMarketError('source-invalid', 'the bundled catalog source cannot be removed'))
    }
    const sources = readSources(this.sourcesPath)
    const next = sources.filter(source => source.id !== id)
    if (next.length === sources.length) return Promise.reject(new PluginMarketError('source-not-found', `no source ${id}`))
    writeSources(this.sourcesPath, next)
    return Promise.resolve()
  }

  override async search(sourceId: string, query: CatalogQuery = {}): Promise<CatalogPage> {
    if (sourceId === BUILTIN_SOURCE_ID) return Promise.resolve(searchBuiltinCatalog(query))
    const source = readSources(this.sourcesPath).find(candidate => candidate.id === sourceId)
    if (source === undefined) throw new PluginMarketError('source-not-found', `no source ${sourceId}`)
    try {
      return await searchCatalog(source, query)
    } catch (error) {
      /* v8 ignore next -- searchCatalog throws Error instances only. */
      throw new PluginMarketError('network', error instanceof Error ? error.message : String(error))
    }
  }

  override async preview(ref: string): Promise<InstallPreview> {
    try {
      return await previewInstall(ref, this.config.registry !== undefined ? { registry: this.config.registry } : {})
    } catch (error) {
      /* v8 ignore next -- previewInstall throws Error instances only. */
      throw new PluginMarketError('preview-failed', error instanceof Error ? error.message : String(error))
    }
  }

  override async install(sourceId: string, ref: string): Promise<InstallReceipt> {
    const profileDir = this.ownedProfileDir
    if (profileDir === undefined) {
      throw new PluginMarketError(
        'install-unavailable',
        'install needs a profileDir; run dsh plugin install on a profile',
      )
    }
    const source = readSources(this.sourcesPath).find(candidate => candidate.id === sourceId)
    if (source === undefined) throw new PluginMarketError('source-not-found', `no source ${sourceId}`)
    const options: InstallOptions = {
      ...this.config.registry !== undefined ? { registry: this.config.registry } : {},
      ...this.config.runPnpm !== undefined ? { runPnpm: this.config.runPnpm } : {},
    }
    try {
      // The preview is the managed gate: deprecated, dist-less, or
      // lifecycle-script packages never reach the profile through the market.
      const preview = await previewInstall(ref, options)
      if (!preview.verified) {
        throw new PluginMarketError('install-failed', `preview rejected ${ref}: ${preview.reasons.join('; ')}`)
      }
      return installPlugin(profileDir, ref, options)
    } catch (error) {
      if (error instanceof PluginMarketError) throw error
      /* v8 ignore next -- installPlugin throws Error instances only. */
      throw new PluginMarketError('install-failed', error instanceof Error ? error.message : String(error))
    }
  }

  override uninstall(receiptId: string): Promise<void> {
    const profileDir = this.ownedProfileDir
    if (profileDir === undefined) {
      return Promise.reject(new PluginMarketError(
        'install-unavailable',
        'uninstall needs a profileDir; run dsh plugin uninstall on a profile',
      ))
    }
    const options: InstallOptions = this.config.runPnpm !== undefined ? { runPnpm: this.config.runPnpm } : {}
    // Receipt-level failures (missing, malformed, or profile-mismatched) are
    // the caller's input problem; a failed `pnpm remove` is an install failure.
    let receipt: InstallReceipt
    try {
      receipt = readReceipt(receiptDirFor(profileDir, options), receiptId)
    } catch (error) {
      /* v8 ignore next -- readReceipt throws Error instances only. */
      return Promise.reject(new PluginMarketError('receipt-mismatch', error instanceof Error ? error.message : String(error)))
    }
    if (receipt.profile !== profileDir) {
      return Promise.reject(
        new PluginMarketError('receipt-mismatch', `receipt ${receiptId} belongs to ${receipt.profile}, not ${profileDir}`),
      )
    }
    try {
      uninstallPlugin(profileDir, receiptId, options)
    } catch (error) {
      /* v8 ignore next -- uninstallPlugin throws Error instances only. */
      return Promise.reject(new PluginMarketError('install-failed', error instanceof Error ? error.message : String(error)))
    }
    return Promise.resolve()
  }

  override listInstallations(): Promise<readonly InstallReceipt[]> {
    const profileDir = this.ownedProfileDir
    if (profileDir === undefined) {
      return Promise.reject(new PluginMarketError(
        'install-unavailable',
        'listing installs needs a profileDir; run dsh plugin on a profile',
      ))
    }
    return Promise.resolve(listReceipts(join(profileDir, '.dsh-plugin-market', 'receipts')))
  }
}

/**
 * Read the persisted sources (empty when none exist yet).
 * @param path - the sources file path.
 * @returns the persisted sources.
 */
export function readSources(path: string): PluginMarketSource[] {
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PluginMarketSource[]
  } catch {
    throw new PluginMarketError('source-invalid', `sources file ${path} is malformed`)
  }
}

/**
 * Persist the sources (a diagnostic file; a failed write surfaces as an error).
 * @param path - the sources file path.
 * @param sources - the sources to persist.
 */
export function writeSources(path: string, sources: readonly PluginMarketSource[]): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(sources, null, 2)}\n`)
}

/** The loader-facing plugin name; rows reference the `provider` subpath. */
export const name = '@deepseek-ai/dsh-host-plugin-market'

/** The provider needs no injected service; `MarketProvider` registers itself. */
export const inject: string[] = []

/**
 * Mount the provider as `ctx.pluginMarket` from a `cordis.yml` row. Folds the
 * loader's empty-sentinel config into an explicit {@link ProviderConfig}: an
 * empty `profileDir` is omitted so a web-host row gets read-only discovery.
 */
export function apply(ctx: Context, config: ProviderConfig): void {
  ctx.plugin(MarketProvider, {
    ...config.profileDir !== undefined && config.profileDir !== '' ? { profileDir: config.profileDir } : {},
    ...config.sourceFile !== undefined && config.sourceFile !== '' ? { sourceFile: config.sourceFile } : {},
    ...config.registry !== undefined && config.registry !== DEFAULT_REGISTRY ? { registry: config.registry } : {},
    ...config.runPnpm !== undefined ? { runPnpm: config.runPnpm } : {},
  })
}
