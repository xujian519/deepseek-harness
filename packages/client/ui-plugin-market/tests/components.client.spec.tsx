// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CatalogPage, InstallPreview, PluginMarketSource } from '@deepseek-ai/dsh-api-remotes/client'
import { PluginMarketTab } from '../src/client/PluginMarketTab.tsx'
import type {
  PluginMarketTabInjected,
  PluginMarketTabProps,
} from '../src/client/PluginMarketTab.tsx'
import { en, type PluginMarketLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: PluginMarketLocaleKey): string => en[key]) as PluginMarketTabProps['t']

const SOURCES: readonly PluginMarketSource[] = [
  {
    id: 'official' as PluginMarketSource['id'],
    providerId: 'official',
    name: 'Official',
    attribution: { name: 'Official', url: 'https://example.com' },
    endpoint: 'https://catalog.example.com',
    query: { supported: ['q', 'category'] },
    builtin: true,
  },
  {
    id: 'community' as PluginMarketSource['id'],
    providerId: 'community',
    name: 'Community',
    attribution: { name: 'Community', url: 'https://c.example.com' },
    endpoint: 'https://c.example.com',
    query: { supported: ['q'] },
  },
]

const PAGE: CatalogPage = {
  items: [
    { id: 'doc', name: 'Docs Plugin', package: '@fixture/docs', version: '1.0.0', description: 'Adds docs', category: 'doc', capability: ['docs'], source: 'official' },
    { id: 'clip', name: 'Clipboard Plugin', package: '@fixture/clip', version: '2.0.0', description: 'Adds clipboard', capability: ['clipboard'], source: 'official' },
    { id: 'bare', name: 'Bare Plugin', package: '@fixture/bare', version: '0.1.0', description: 'No capabilities', source: 'official' },
  ],
}

const EMPTY_PAGE: CatalogPage = { items: [] }

const VERIFIED: InstallPreview = {
  package: '@fixture/docs', version: '1.0.0', verified: true, reasons: [], lifecycleScripts: [], compatible: true,
}

const REJECTED: InstallPreview = {
  package: '@fixture/docs', version: '1.0.0', verified: false, reasons: ['needs an approval'], lifecycleScripts: [], compatible: false,
}

function props(overrides: Partial<PluginMarketTabInjected>): PluginMarketTabProps {
  const listSources = overrides.listSources ?? vi.fn(async () => SOURCES)
  const search = overrides.search ?? vi.fn(async () => PAGE)
  const preview = overrides.preview ?? vi.fn(async () => VERIFIED)
  return { t, listSources, search, preview } as PluginMarketTabProps
}

async function selectSource(view: HTMLElement): Promise<void> {
  const select = view.querySelector('select')!
  fireEvent.change(select, { target: { value: 'official' } })
}

describe('PluginMarketTab', () => {
  it('renders catalogs after loading sources', async () => {
    const listSources = vi.fn(async () => SOURCES)
    const view = render(<PluginMarketTab {...props({ listSources })} />)
    expect(screen.getByText(en.loading)).toBeTruthy()

    const select = await screen.findByRole('combobox')
    expect(view.container.querySelector('[data-source-count]')?.getAttribute('data-source-count')).toBe('2')
    expect(select.textContent).toContain('Official')
    expect(select.textContent).toContain('Community')
    expect(view.container.querySelectorAll('option')[1]?.textContent).toBe('Official · Built-in')
  })

  it('shows an empty hint when no catalog source is registered', async () => {
    render(<PluginMarketTab {...props({ listSources: vi.fn(async () => []) })} />)
    expect(await screen.findByText(en.noSources)).toBeTruthy()
  })

  it('searches a selected source and renders result cards', async () => {
    const search = vi.fn(async () => PAGE)
    const view = render(<PluginMarketTab {...props({ search })} />)
    await screen.findByRole('combobox')
    await selectSource(view.container)
    fireEvent.click(screen.getByRole('button', { name: en.searchButton }))

    expect(await screen.findByText('Docs Plugin')).toBeTruthy()
    expect(screen.getByText('@fixture/docs@1.0.0')).toBeTruthy()
    expect(view.container.querySelector('[data-result-count]')?.getAttribute('data-result-count')).toBe('3')
    expect(screen.getByText('docs')).toBeTruthy()
    expect(screen.getByText('clipboard')).toBeTruthy()
    expect(search).toHaveBeenCalledWith('official', {})
  })

  it('filters cards by the local free-text query', async () => {
    const view = render(<PluginMarketTab {...props({ search: vi.fn(async () => PAGE) })} />)
    await screen.findByRole('combobox')
    await selectSource(view.container)
    fireEvent.click(screen.getByRole('button', { name: en.searchButton }))
    await screen.findByText('Docs Plugin')

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'clipboard' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getAllByText('Clipboard Plugin')).toHaveLength(1)
    expect(screen.queryByText('Docs Plugin')).toBeNull()
  })

  it('builds a filtered query and resets the page when the source selection is cleared', async () => {
    const search = vi.fn(async () => PAGE)
    const view = render(<PluginMarketTab {...props({ search })} />)
    await screen.findByRole('combobox')

    fireEvent.change(screen.getByPlaceholderText(en.category), { target: { value: 'docs' } })
    fireEvent.change(screen.getByPlaceholderText(en.capability), { target: { value: 'doc' } })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'docs' } })
    await selectSource(view.container)
    fireEvent.click(screen.getByRole('button', { name: en.searchButton }))

    expect(await screen.findByText('Docs Plugin')).toBeTruthy()
    expect(search).toHaveBeenCalledWith('official', { q: 'docs', category: 'docs', capability: 'doc' })

    fireEvent.change(view.container.querySelector('select')!, { target: { value: '' } })
    expect(view.container.querySelector('[data-result-count]')).toBeNull()

    await selectSource(view.container)
    fireEvent.click(screen.getByRole('button', { name: en.searchButton }))
    expect(await screen.findByText('Docs Plugin')).toBeTruthy()
    expect(search).toHaveBeenCalledTimes(2)
  })

  it('a sparse catalog card is filtered out when no field matches', async () => {
    // A card with neither description/category/capability: the free-text filter
    // walks past each missing field's nullish fallback to decide the match.
    const search = vi.fn(async () => ({
      items: [
        { id: 'sparse', name: 'SparsePlugin', package: '@fixture/sparse', version: '1.0.0', source: 'official' },
      ],
    }))
    const view = render(<PluginMarketTab {...props({ search })} />)
    await screen.findByRole('combobox')
    await selectSource(view.container)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzz' } })
    fireEvent.click(screen.getByRole('button', { name: en.searchButton }))
    expect(await screen.findByText(en.emptySearch)).toBeTruthy()
  })

  it('surfaces a search failure and clears prior results', async () => {
    const search = vi.fn()
      .mockResolvedValueOnce(PAGE)
      .mockRejectedValueOnce(new Error('network down'))
    const view = render(<PluginMarketTab {...props({ search })} />)
    await screen.findByRole('combobox')
    await selectSource(view.container)
    fireEvent.click(screen.getByRole('button', { name: en.searchButton }))

    await screen.findByText('Docs Plugin')
    fireEvent.click(screen.getByRole('button', { name: en.searchButton }))

    expect((await screen.findByRole('alert')).textContent).toBe(en.searchError)
    expect(screen.queryByText('Docs Plugin')).toBeNull()
  })

  it('previews a verified and a rejected reference', async () => {
    const preview = vi.fn(async () => VERIFIED)
    render(<PluginMarketTab {...props({ preview })} />)
    await screen.findByRole('combobox')

    fireEvent.change(screen.getByPlaceholderText(en.previewPlaceholder), { target: { value: '@fixture/docs@1.0.0' } })
    fireEvent.click(screen.getByRole('button', { name: en.preview }))
    expect(await screen.findByText(en.verified, { exact: false })).toBeTruthy()
    expect(preview).toHaveBeenCalledWith('@fixture/docs@1.0.0')

    preview.mockRejectedValueOnce(new Error('not found'))
    fireEvent.change(screen.getByPlaceholderText(en.previewPlaceholder), { target: { value: '@fixture/missing@9.9.9' } })
    fireEvent.click(screen.getByRole('button', { name: en.preview }))
    expect((await screen.findByRole('alert')).textContent).toBe(en.previewRejected)
  })

  it('renders a non-verified preview with lifecycle reasons and no version line', async () => {
    const preview = vi.fn(async () => REJECTED)
    render(<PluginMarketTab {...props({ preview })} />)
    await screen.findByRole('combobox')

    fireEvent.change(screen.getByPlaceholderText(en.previewPlaceholder), { target: { value: '@fixture/docs@1.0.0' } })
    fireEvent.click(screen.getByRole('button', { name: en.preview }))

    expect(await screen.findByText(en.previewRejected)).toBeTruthy()
    expect(screen.getByText('needs an approval')).toBeTruthy()
    expect(screen.queryByText(en.version, { exact: false })).toBeNull()
    const seat = screen.getByText(en.previewRejected).closest('[data-preview-verified]')!
    expect(seat.getAttribute('data-preview-verified')).toBe('false')
  })

  it('previews a reference through a catalog card button', async () => {
    const preview = vi.fn(async () => VERIFIED)
    const view = render(<PluginMarketTab {...props({ preview, search: vi.fn(async () => PAGE) })} />)
    await screen.findByRole('combobox')
    await selectSource(view.container)
    fireEvent.click(screen.getByRole('button', { name: en.searchButton }))

    const cardButton = (await screen.findByText('Docs Plugin')).closest('li')!.querySelector('button')!
    fireEvent.click(cardButton)
    expect(await screen.findByText(en.verified, { exact: false })).toBeTruthy()
    expect(preview).toHaveBeenCalledWith('@fixture/docs@1.0.0')
  })

  it('shows the empty seat for an empty page and the no-match seat for a filtered-out page', async () => {
    const empty = render(<PluginMarketTab {...props({ search: vi.fn(async () => EMPTY_PAGE) })} />)
    await screen.findByRole('combobox')
    await selectSource(empty.container)
    fireEvent.click(screen.getByRole('button', { name: en.searchButton }))
    expect(await screen.findByText(en.empty)).toBeTruthy()

    empty.unmount()

    const view = render(<PluginMarketTab {...props({ search: vi.fn(async () => PAGE) })} />)
    await screen.findByRole('combobox')
    await selectSource(view.container)
    fireEvent.click(screen.getByRole('button', { name: en.searchButton }))
    await screen.findByText('Docs Plugin')

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nope' } })
    expect(await screen.findByText(en.emptySearch)).toBeTruthy()
  })

  it('shows a generic failure and retries into the ready state', async () => {
    const listSources = vi.fn<PluginMarketTabInjected['listSources']>()
      .mockRejectedValueOnce(new Error('private transport detail'))
      .mockResolvedValueOnce(SOURCES)
    render(<PluginMarketTab {...props({ listSources })} />)

    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    expect(screen.queryByText('private transport detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(listSources).toHaveBeenCalledTimes(2) })
    expect(await screen.findByRole('combobox')).toBeTruthy()
  })

  it('contains a synchronous failure and ignores a result after unmount', async () => {
    const syncFailure = vi.fn(() => { throw new Error('namespace unavailable') }) as PluginMarketTabInjected['listSources']
    const failed = render(<PluginMarketTab {...props({ listSources: syncFailure })} />)
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    failed.unmount()

    const deferred = Promise.withResolvers<readonly PluginMarketSource[]>()
    const pending = render(<PluginMarketTab {...props({ listSources: vi.fn(() => deferred.promise) })} />)
    pending.unmount()
    await act(async () => { deferred.resolve(SOURCES) })

    const deferredFailure = Promise.withResolvers<readonly PluginMarketSource[]>()
    const pendingFailure = render(<PluginMarketTab {...props({ listSources: vi.fn(() => deferredFailure.promise) })} />)
    pendingFailure.unmount()
    await act(async () => { deferredFailure.reject(new Error('late failure')) })
  })
})
