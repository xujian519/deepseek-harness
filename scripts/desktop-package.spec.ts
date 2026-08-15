/**
 * Unit tests for the desktop backend packaging helper: the deployed-tree
 * verification and the virtual-store hoisting that makes every plugin
 * resolvable from the launcher install directory.
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hoistVirtualStore, materializeExternalLinks, resourcesDirForPlatform, topLevelPackageNames, verifyBackendDeploy, virtualStorePackages } from './desktop-package.ts'

const REQUIRED = [
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

function makeBackendTree(withFrontendDist: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'backend-deploy-'))
  const paths = withFrontendDist ? REQUIRED : REQUIRED.filter(p => !p.includes('dsh-web-frontend'))
  for (const path of paths) {
    const file = join(dir, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, '{}')
  }
  return dir
}

describe('resourcesDirForPlatform', () => {
  it('maps Node platform keys to per-OS resource directories', () => {
    expect(resourcesDirForPlatform('darwin-arm64')).toBe('mac')
    expect(resourcesDirForPlatform('darwin-x64')).toBe('mac')
    expect(resourcesDirForPlatform('win-x64')).toBe('win')
    expect(resourcesDirForPlatform('win-arm64')).toBe('win')
    expect(resourcesDirForPlatform('linux-x64')).toBe('linux')
  })

  it('rejects unknown platforms', () => {
    expect(() => resourcesDirForPlatform('freebsd-x64')).toThrow(/unsupported platform/)
  })
})

describe('materializeExternalLinks', () => {
  it('replaces out-of-tree links with real copies and keeps in-tree links', () => {
    const dir = mkdtempSync(join(tmpdir(), 'materialize-'))
    try {
      const nm = join(dir, 'node_modules')
      mkdirSync(nm, { recursive: true })
      // A link that resolves outside the tree (pnpm `link:` dependency).
      const external = join(dir, 'vendor-pkg')
      mkdirSync(external, { recursive: true })
      writeFileSync(join(external, 'package.json'), '{"name":"vendor-pkg"}')
      symlinkSync(external, join(nm, 'vendor-link'))
      // A link that resolves inside the tree (the pnpm store).
      mkdirSync(join(nm, '.pnpm', 'real@1.0.0', 'node_modules', 'real'), { recursive: true })
      writeFileSync(join(nm, '.pnpm', 'real@1.0.0', 'node_modules', 'real', 'index.js'), 'x')
      symlinkSync(join(nm, '.pnpm', 'real@1.0.0', 'node_modules', 'real'), join(nm, 'store-link'))

      const materialized = materializeExternalLinks(nm)

      expect(materialized).toEqual([join(nm, 'vendor-link')])
      expect(readFileSync(join(nm, 'vendor-link', 'package.json'), 'utf8')).toContain('vendor-pkg')
      // The in-tree store link is untouched.
      expect(readdirSync(join(nm, 'store-link'))).toContain('index.js')
      expect(readFileSync(join(nm, 'store-link', 'index.js'), 'utf8')).toBe('x')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('copies each external target once and re-points cyclic links in-tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'materialize-'))
    try {
      const nm = join(dir, 'node_modules')
      mkdirSync(nm, { recursive: true })
      // Two external packages that link to each other (cosmokit/schemastery).
      const a = join(dir, 'vendor-a')
      const b = join(dir, 'vendor-b')
      mkdirSync(join(a, 'node_modules'), { recursive: true })
      mkdirSync(join(b, 'node_modules'), { recursive: true })
      writeFileSync(join(a, 'package.json'), '{"name":"a"}')
      writeFileSync(join(b, 'package.json'), '{"name":"b"}')
      symlinkSync(b, join(a, 'node_modules', 'b'))
      symlinkSync(a, join(b, 'node_modules', 'a'))
      // Three consumers link to `a`; the first is copied, the rest re-point.
      symlinkSync(a, join(nm, 'a-one'))
      symlinkSync(a, join(nm, 'a-two'))

      const materialized = materializeExternalLinks(nm)

      expect(materialized).toHaveLength(4)
      // Both external packages became real in-tree copies.
      expect(readFileSync(join(nm, 'a-one', 'package.json'), 'utf8')).toContain('"name":"a"')
      expect(readFileSync(join(nm, 'a-two', 'package.json'), 'utf8')).toContain('"name":"a"')
      // The cyclic dependency inside the copy resolves in-tree via a link to
      // the copied package, and its own cyclic dependency resolves back.
      expect(readFileSync(join(nm, 'a-one', 'node_modules', 'b', 'package.json'), 'utf8')).toContain('"name":"b"')
      expect(readFileSync(join(nm, 'a-one', 'node_modules', 'b', 'node_modules', 'a', 'package.json'), 'utf8')).toContain('"name":"a"')
      // The second consumer is a relative link to the first copy.
      const link = readdirSync(nm, { withFileTypes: true }).find(e => e.name === 'a-two')
      expect(link?.isSymbolicLink()).toBe(true)
      expect(readlinkSync(join(nm, 'a-two'))).not.toBe('/')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rewrites links inside external copies that point back into the tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'materialize-'))
    try {
      const nm = join(dir, 'node_modules')
      mkdirSync(nm, { recursive: true })
      // An in-tree store entry the external package links to.
      const store = join(nm, '.pnpm', 'spec@1.0.0', 'node_modules', '@standard-schema', 'spec')
      mkdirSync(store, { recursive: true })
      writeFileSync(join(store, 'index.js'), 'spec')
      // The external package holds a relative link into the repo layout.
      const external = join(dir, 'vendor-pkg')
      mkdirSync(join(external, 'node_modules', '@standard-schema'), { recursive: true })
      writeFileSync(join(external, 'package.json'), '{"name":"vendor-pkg"}')
      symlinkSync(join(dir, 'node_modules', '.pnpm', 'spec@1.0.0', 'node_modules', '@standard-schema', 'spec'), join(external, 'node_modules', '@standard-schema', 'spec'))
      symlinkSync(external, join(nm, 'vendor-pkg'))

      materializeExternalLinks(nm)

      // The copied package's inner link is relative and resolves in-tree.
      const inner = join(nm, 'vendor-pkg', 'node_modules', '@standard-schema', 'spec')
      expect(readlinkSync(inner)).not.toBe('/')
      expect(readFileSync(join(inner, 'index.js'), 'utf8')).toBe('spec')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('verifyBackendDeploy', () => {
  it('reports nothing for a complete tree', () => {
    const dir = makeBackendTree(true)
    try {
      expect(verifyBackendDeploy(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('lists every missing required path', () => {
    const dir = makeBackendTree(false)
    try {
      expect(verifyBackendDeploy(dir)).toEqual([
        'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html',
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/** Create `node_modules/.pnpm/<id>/node_modules/...` fixture entries. */
function makeStore(dir: string): void {
  const store = join(dir, 'node_modules', '.pnpm')
  const write = (rel: string, payload: string): void => {
    const file = join(store, rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, payload)
  }
  // The dsh-llm entry owns the package plus a scoped dependency.
  write('@deepseek-ai+dsh-llm@1.0.0/node_modules/@deepseek-ai/dsh-llm/package.json', '{"name":"@deepseek-ai/dsh-llm"}')
  write('@deepseek-ai+dsh-llm@1.0.0/node_modules/@deepseek-ai/dsh-token-meter/package.json', '{"name":"@deepseek-ai/dsh-token-meter"}')
  // A plain-name entry.
  write('foo@2.0.0/node_modules/foo/package.json', '{"name":"foo"}')
}

describe('hoistVirtualStore', () => {
  it('links virtual-store packages to the top level when absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hoist-'))
    try {
      makeStore(dir)
      mkdirSync(join(dir, 'node_modules', '@deepseek-ai', 'dsh-base'), { recursive: true })
      writeFileSync(join(dir, 'node_modules', '@deepseek-ai', 'dsh-base', 'package.json'), '{"name":"@deepseek-ai/dsh-base"}')

      const created = hoistVirtualStore(join(dir, 'node_modules'))

      const topLevel = topLevelPackageNames(join(dir, 'node_modules'))
      expect(topLevel).toContain('@deepseek-ai/dsh-base')
      expect(topLevel).toContain('@deepseek-ai/dsh-llm')
      expect(topLevel).toContain('@deepseek-ai/dsh-token-meter')
      expect(topLevel).toContain('foo')
      expect(created).toHaveLength(3)
      expect(readFileSync(join(dir, 'node_modules', '@deepseek-ai', 'dsh-llm', 'package.json'), 'utf8'))
        .toContain('@deepseek-ai/dsh-llm')
      // The existing direct dependency is untouched.
      expect(readFileSync(join(dir, 'node_modules', '@deepseek-ai', 'dsh-base', 'package.json'), 'utf8'))
        .toContain('@deepseek-ai/dsh-base')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is idempotent and ignores a missing virtual store', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hoist-'))
    try {
      makeStore(dir)
      const nodeModules = join(dir, 'node_modules')
      hoistVirtualStore(nodeModules)
      expect(hoistVirtualStore(nodeModules)).toEqual([])
      // A node_modules directory without a virtual store links nothing.
      const plain = mkdtempSync(join(tmpdir(), 'hoist-plain-'))
      try {
        mkdirSync(join(plain, 'node_modules'))
        expect(hoistVirtualStore(join(plain, 'node_modules'))).toEqual([])
      } finally {
        rmSync(plain, { recursive: true, force: true })
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('enumerates the virtual store deterministically', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hoist-'))
    try {
      makeStore(dir)
      const virtual = virtualStorePackages(join(dir, 'node_modules'))
      expect(virtual.get('@deepseek-ai/dsh-llm')).toBeTruthy()
      expect(virtual.get('@deepseek-ai/dsh-token-meter')).toBeTruthy()
      expect(virtual.get('foo')).toBeTruthy()
      expect(readFileSync(join(virtual.get('foo') ?? '', 'package.json'), 'utf8')).toContain('"name":"foo"')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
