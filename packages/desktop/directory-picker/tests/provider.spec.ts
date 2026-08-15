/**
 * Tests for the Electron-backed directory picker provider.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import ElectronDirectoryPicker, { type DirectoryPickerElectronCapability } from '../src/index.ts'

describe('ElectronDirectoryPicker', () => {
  it('registers the electron capability', () => {
    const ctx = new Context()
    ctx.provide('desktop', {
      showOpenDialog: async () => ['/workspace'],
    } as unknown as import('@deepseek-ai/dsh-desktop').Desktop)
    const picker = new ElectronDirectoryPicker(ctx)
    const capability = picker.capability()
    expect(capability.kind).toBe('electron')
  })

  it('delegates pick to ctx.desktop.showOpenDialog', async () => {
    const ctx = new Context()
    ctx.provide('desktop', {
      showOpenDialog: async () => ['/workspace'],
    } as unknown as import('@deepseek-ai/dsh-desktop').Desktop)
    const picker = new ElectronDirectoryPicker(ctx)
    const capability = picker.capability() as DirectoryPickerElectronCapability
    const result = await capability.pick(new AbortController().signal)
    expect(result).toBe('/workspace')
  })

  it('returns null when the operator cancels', async () => {
    const ctx = new Context()
    ctx.provide('desktop', {
      showOpenDialog: async () => undefined,
    } as unknown as import('@deepseek-ai/dsh-desktop').Desktop)
    const picker = new ElectronDirectoryPicker(ctx)
    const capability = picker.capability() as DirectoryPickerElectronCapability
    const result = await capability.pick(new AbortController().signal)
    expect(result).toBeNull()
  })

  it('declares the desktop service as a load-time dependency', () => {
    expect(ElectronDirectoryPicker.inject).toEqual(['desktop'])
  })

  it('passes the caller signal to ctx.desktop.showOpenDialog', async () => {
    const signals: (AbortSignal | undefined)[] = []
    const ctx = new Context()
    ctx.provide('desktop', {
      showOpenDialog: async (_options: unknown, signal?: AbortSignal) => {
        signals.push(signal)
        return undefined
      },
    } as unknown as import('@deepseek-ai/dsh-desktop').Desktop)
    const picker = new ElectronDirectoryPicker(ctx)
    const capability = picker.capability() as DirectoryPickerElectronCapability
    const controller = new AbortController()
    await capability.pick(controller.signal)
    expect(signals).toEqual([controller.signal])
  })

  it('rejects pick when the desktop call aborts', async () => {
    const ctx = new Context()
    ctx.provide('desktop', {
      showOpenDialog: (_options: unknown, signal?: AbortSignal) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) }, { once: true })
      }),
    } as unknown as import('@deepseek-ai/dsh-desktop').Desktop)
    const picker = new ElectronDirectoryPicker(ctx)
    const capability = picker.capability() as DirectoryPickerElectronCapability
    const controller = new AbortController()
    const promise = capability.pick(controller.signal)
    controller.abort()
    await expect(promise).rejects.toThrow('aborted')
  })
})
