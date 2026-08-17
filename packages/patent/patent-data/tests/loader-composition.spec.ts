// Real-composition test: boots a test cordis.yml through the real Loader
// mounting @deepseek-ai/dsh-patent-data over @deepseek-ai/dsh-subprocess-local,
// and asserts ctx.patentData plus its search provider over the mocked nuo module seam.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import PatentData from '@deepseek-ai/dsh-patent-data'
import { searchPatents } from '@deepseek-ai/nuo-patent'
import type { PatentSearchResult } from '@deepseek-ai/nuo-patent'

vi.mock('@deepseek-ai/nuo-patent', () => ({
  searchPatents: vi.fn(),
}))

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-patent-data-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-subprocess-local'",
    "- name: '@deepseek-ai/dsh-patent-data'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-subprocess-local', LocalSubprocessRuntime],
    ['@deepseek-ai/dsh-patent-data', PatentData],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

function makeSearchResult(): PatentSearchResult {
  return {
    query: 'thermal',
    total: 1,
    hits: [
      {
        patent: 'US11452699B2',
        title: 'Thermal management system',
        assignee: 'Apple Inc.',
        publication_date: '2022-09-27',
        priority_date: '2019-12-31',
        abstract: 'A thermal management system.',
        url: 'https://patents.google.com/patent/US11452699B2',
      },
    ],
    warnings: [],
  }
}

describe('patent-data real Loader composition through cordis.yml', () => {
  it('mounts ctx.patentData and serves the search provider over the mocked nuo seam', async () => {
    vi.mocked(searchPatents).mockResolvedValue(makeSearchResult())

    const ctx = await boot()
    expect(ctx.patentData).toBeInstanceOf(PatentData)

    const provider = ctx.patentData.createSearchProvider()
    const first = await provider.search!('thermal')
    const second = await provider.search!('thermal')

    expect(first[0]?.title).toBe('Thermal management system')
    expect(first).toEqual(second)
    expect(vi.mocked(searchPatents)).toHaveBeenCalledTimes(1)
  }, 30_000)
})
