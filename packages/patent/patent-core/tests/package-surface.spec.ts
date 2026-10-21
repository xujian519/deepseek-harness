import { readFileSync } from 'node:fs'
import { matchesGlob } from 'node:path'
import { expect, it } from 'vitest'

interface Manifest {
  exports: Record<string, string | Record<string, string>>
  files: string[]
}

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as Manifest

function targets(value: string | Record<string, string>): string[] {
  return typeof value === 'string' ? [value] : Object.values(value)
}

/** A `files` pattern publishes its directory and everything below it. */
function covered(file: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    const normalized = pattern.replace(/^\.\//u, '').replace(/\/+$/u, '')
    return file === normalized
      || matchesGlob(file, normalized)
      || matchesGlob(file, `${normalized}/**`)
  })
}

it('package surface: 不导出 src 子路径', () => {
  expect(Object.keys(manifest.exports).some(key => key.startsWith('./src/'))).toBe(false)
})

it('package surface: 每个导出目标都在发布文件集内', () => {
  for (const [key, value] of Object.entries(manifest.exports)) {
    for (const target of targets(value)) {
      // npm always publishes package.json, independent of `files`.
      if (target === './package.json') continue
      const file = target.replace(/^\.\//u, '')
      expect(file.includes('*'), `${key} wildcard target needs an explicit coverage check`).toBe(false)
      expect(covered(file, manifest.files), `${key} target ${file} is not published`).toBe(true)
    }
  }
})

it('package surface: 根入口同时声明类型与运行时模块', () => {
  const root = manifest.exports['.']
  expect(root).toBeTypeOf('object')
  expect(root && typeof root === 'object' ? root.types : undefined).toBe('./lib/types/index.d.ts')
  expect(root && typeof root === 'object' ? root.default : undefined).toBe('./lib/index.js')
})
