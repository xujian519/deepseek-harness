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
import { DEFAULT_REGISTRY, installPlugin, listReceipts, previewInstall, readReceipt, receiptDirFor, uninstallPlugin, type InstallOptions } from './install.ts'

/** Provider configuration; the Loader-facing schema is {@link Config}. */
export interface ProviderConfig {
  /** The profile directory whose package manager this provider drives. */
  profileDir: string
  /** File persisting registered sources (default `<profileDir>/.dsh-plugin-market/sources.json`). */
  sourceFile?: string
  /** npm registry for previews (default the public registry). */
  registry?: string
  /** Package-manager runner (defaults to `pnpm`). */
  runPnpm?: (cwd: string, args: readonly string[]) => { status: number; stderr: string }
}

/** Loader-facing config schema; `sourceFile`/`registry` default to the empty sentinel. */
export const Config: z<ProviderConfig> = z.object({
  profileDir: z.string(),
  sourceFile: z.string().default(''),
  registry: z.string().default(DEFAULT_REGISTRY),
})

/** The sources file name under the profile. */
export const SOURCES_FILE = '.dsh-plugin-market/sources.json'

/** The provider implementation behind `ctx.pluginMarket`. */
export class MarketProvider extends PluginMarket {
  private readonly sourcesPath: string

  constructor(ctx: Context, private readonly config: ProviderConfig) {
    super(ctx)
    this.sourcesPath = config.sourceFile ?? join(config.profileDir, SOURCES_FILE)
  }

  override listSources(): Promise<readonly PluginMarketSource[]> {
    return Promise.resolve(readSources(this.sourcesPath))
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
    const sources = readSources(this.sourcesPath)
    const next = sources.filter(source => source.id !== id)
    if (next.length === sources.length) return Promise.reject(new PluginMarketError('source-not-found', `no source ${id}`))
    writeSources(this.sourcesPath, next)
    return Promise.resolve()
  }

  override async search(sourceId: string, query: CatalogQuery = {}): Promise<CatalogPage> {
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
      return installPlugin(this.config.profileDir, ref, options)
    } catch (error) {
      if (error instanceof PluginMarketError) throw error
      /* v8 ignore next -- installPlugin throws Error instances only. */
      throw new PluginMarketError('install-failed', error instanceof Error ? error.message : String(error))
    }
  }

  override uninstall(receiptId: string): Promise<void> {
    const options: InstallOptions = this.config.runPnpm !== undefined ? { runPnpm: this.config.runPnpm } : {}
    // Receipt-level failures (missing, malformed, or profile-mismatched) are
    // the caller's input problem; a failed `pnpm remove` is an install failure.
    let receipt: InstallReceipt
    try {
      receipt = readReceipt(receiptDirFor(this.config.profileDir, options), receiptId)
    } catch (error) {
      /* v8 ignore next -- readReceipt throws Error instances only. */
      return Promise.reject(new PluginMarketError('receipt-mismatch', error instanceof Error ? error.message : String(error)))
    }
    if (receipt.profile !== this.config.profileDir) {
      return Promise.reject(
        new PluginMarketError('receipt-mismatch', `receipt ${receiptId} belongs to ${receipt.profile}, not ${this.config.profileDir}`),
      )
    }
    try {
      uninstallPlugin(this.config.profileDir, receiptId, options)
    } catch (error) {
      /* v8 ignore next -- uninstallPlugin throws Error instances only. */
      return Promise.reject(new PluginMarketError('install-failed', error instanceof Error ? error.message : String(error)))
    }
    return Promise.resolve()
  }

  override listInstallations(): Promise<readonly InstallReceipt[]> {
    return Promise.resolve(listReceipts(join(this.config.profileDir, '.dsh-plugin-market', 'receipts')))
  }
}

/** Read the persisted sources (empty when none exist yet). */
export function readSources(path: string): PluginMarketSource[] {
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PluginMarketSource[]
  } catch {
    throw new PluginMarketError('source-invalid', `sources file ${path} is malformed`)
  }
}

/** Persist the sources (a diagnostic file; a failed write surfaces as an error). */
export function writeSources(path: string, sources: readonly PluginMarketSource[]): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(sources, null, 2)}\n`)
}

export default function apply(ctx: Context, config: ProviderConfig): void {
  ctx.plugin(MarketProvider, {
    profileDir: config.profileDir,
    ...config.sourceFile !== undefined && config.sourceFile !== '' ? { sourceFile: config.sourceFile } : {},
    ...config.registry !== undefined && config.registry !== DEFAULT_REGISTRY ? { registry: config.registry } : {},
  })
}
