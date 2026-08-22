/**
 * Desktop print-to-PDF helper: hidden-window rasterization, save-dialog
 * anchoring, byte writing, and the failure/cancellation surfaces.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  writeFile: vi.fn(),
  dialogShowSaveDialog: vi.fn(),
  loadURL: vi.fn(),
  printToPDF: vi.fn(),
  destroy: vi.fn(),
  isDestroyed: vi.fn(() => false),
}))

vi.mock('node:fs/promises', () => ({ writeFile: mocks.writeFile }))
vi.mock('electron', () => ({
  dialog: { showSaveDialog: (...args: unknown[]) => mocks.dialogShowSaveDialog(...args) },
  BrowserWindow: vi.fn(function (this: unknown) {
    return {
      loadURL: mocks.loadURL,
      webContents: { printToPDF: mocks.printToPDF },
      destroy: mocks.destroy,
      isDestroyed: mocks.isDestroyed,
    }
  }),
}))

import { printHtmlToPdf } from '../src/print.ts'

// Default mock behavior, seeded once; afterEach clears call records only.
mocks.loadURL.mockResolvedValue(undefined)
mocks.printToPDF.mockResolvedValue(Buffer.from('%PDF'))

afterEach(() => {
  vi.clearAllMocks()
  mocks.loadURL.mockReset().mockResolvedValue(undefined)
  mocks.printToPDF.mockReset().mockResolvedValue(Buffer.from('%PDF'))
  mocks.isDestroyed.mockReturnValue(false)
})

describe('printHtmlToPdf', () => {
  it('rasterizes the HTML, saves through the dialog, and returns the path', async () => {
    mocks.dialogShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/out.pdf' })
    mocks.writeFile.mockResolvedValue(undefined)

    const result = await printHtmlToPdf({} as never, '<h1>报告</h1>', 'deck')

    expect(mocks.loadURL).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('<h1>报告</h1>')))
    expect(mocks.printToPDF).toHaveBeenCalledWith({ printBackground: true, pageSize: 'A4' })
    expect(mocks.dialogShowSaveDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ defaultPath: 'deck.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] }),
    )
    expect(mocks.writeFile.mock.calls[0]?.[0]).toBe('/tmp/out.pdf')
    expect(Buffer.from(mocks.writeFile.mock.calls[0]?.[1] as Uint8Array).toString()).toBe('%PDF')
    expect(result).toEqual({ path: '/tmp/out.pdf' })
    expect(mocks.destroy).toHaveBeenCalled()
  })

  it('keeps an existing .pdf suffix on the suggested name', async () => {
    mocks.dialogShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/a.pdf' })
    mocks.writeFile.mockResolvedValue(undefined)

    await printHtmlToPdf({} as never, '<h1>x</h1>', 'already.pdf')

    expect(mocks.dialogShowSaveDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ defaultPath: 'already.pdf' }),
    )
  })

  it('reports cancellation without writing', async () => {
    mocks.dialogShowSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })

    const result = await printHtmlToPdf({} as never, '<h1>x</h1>', 'doc')

    expect(result).toEqual({ cancelled: true })
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('reports raster or save failures as an error and still destroys the window', async () => {
    mocks.printToPDF.mockRejectedValue(new Error('printer offline'))

    const result = await printHtmlToPdf({} as never, '<h1>x</h1>', 'doc')

    expect(result).toEqual({ error: 'printer offline' })
    expect(mocks.destroy).toHaveBeenCalled()
  })

  it('tolerates an already-destroyed print window on teardown', async () => {
    mocks.dialogShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/tmp/o.pdf' })
    mocks.writeFile.mockResolvedValue(undefined)
    mocks.isDestroyed.mockReturnValue(true)

    const result = await printHtmlToPdf({} as never, '<h1>x</h1>', 'doc')

    expect(result).toEqual({ path: '/tmp/o.pdf' })
    expect(mocks.destroy).not.toHaveBeenCalled()
  })
})
