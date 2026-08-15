/**
 * Unit tests for the desktop backend packaging helper: the deployed-tree
 * verification and the virtual-store hoisting that makes every plugin
 * resolvable from the launcher install directory.
 */

import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hoistVirtualStore, materializeExternalLinks, pruneNodePtyPrebuilds, resourcesDirForPlatform, topLevelPackageNames, verifyBackendDeploy, virtualStorePackages } from './desktop-package.ts'

const POSIX: NodeJS.Platform = 'linux'
const WIN32: NodeJS.Platform = 'win32'

/** Create a fixture symlink that works on the host: junction on win32 (no admin needed), dir symlink elsewhere. */
function createFixtureLink(target: string, path: string): void {
  if (process.platform === 'win32') symlinkSync(target, path, 'junction')
  else symlinkSync(target, path, 'dir')
}

/** True when `entryPath` is a real directory, not a symlink. */
function isRealDirectory(entryPath: string): boolean {
  return lstatSync(entryPath).isDirectory()
}

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
    expect(resourcesDirForPlatform('linux-x64')).toBe('linux')
  })

  it('rejects unknown and unsupported platforms', () => {
    expect(() => resourcesDirForPlatform('freebsd-x64')).toThrow(/unsupported platform/)
    // The embedded Node runtime has no win-arm64 archive, so the platform is
    // unsupported even though the OS directory mapping would be `win`.
    expect(() => resourcesDirForPlatform('win-arm64')).toThrow(/unsupported platform/)
  })
})

describe.skipIf(process.platform === 'win32')('materializeExternalLinks (POSIX links)', () => {
  it('replaces out-of-tree links with real copies and keeps in-tree links', () => {
    const dir = mkdtempSync(join(tmpdir(), 'materialize-'))
    try {
      const nm = join(dir, 'node_modules')
      mkdirSync(nm, { recursive: true })
      // A link that resolves outside the tree (pnpm `link:` dependency).
      const external = join(dir, 'vendor-pkg')
      mkdirSync(external, { recursive: true })
      writeFileSync(join(external, 'package.json'), '{"name":"vendor-pkg"}')
      createFixtureLink(external, join(nm, 'vendor-link'))
      // A link that resolves inside the tree (the pnpm store).
      mkdirSync(join(nm, '.pnpm', 'real@1.0.0', 'node_modules', 'real'), { recursive: true })
      writeFileSync(join(nm, '.pnpm', 'real@1.0.0', 'node_modules', 'real', 'index.js'), 'x')
      createFixtureLink(join(nm, '.pnpm', 'real@1.0.0', 'node_modules', 'real'), join(nm, 'store-link'))

      const materialized = materializeExternalLinks(nm, POSIX)

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
      createFixtureLink(b, join(a, 'node_modules', 'b'))
      createFixtureLink(a, join(b, 'node_modules', 'a'))
      // Three consumers link to `a`; the first is copied, the rest re-point.
      createFixtureLink(a, join(nm, 'a-one'))
      createFixtureLink(a, join(nm, 'a-two'))

      const materialized = materializeExternalLinks(nm, POSIX)

      expect(materialized).toHaveLength(4)
      // Both external packages became real in-tree copies.
      expect(readFileSync(join(nm, 'a-one', 'package.json'), 'utf8')).toContain('"name":"a"')
      expect(readFileSync(join(nm, 'a-two', 'package.json'), 'utf8')).toContain('"name":"a"')
      // The cyclic dependency inside the copy resolves in-tree via a link to
      // the copied package, and its own cyclic dependency resolves back.
      expect(readFileSync(join(nm, 'a-one', 'node_modules', 'b', 'package.json'), 'utf8')).toContain('"name":"b"')
      expect(readFileSync(join(nm, 'a-one', 'node_modules', 'b', 'node_modules', 'a', 'package.json'), 'utf8')).toContain('"name":"a"')
      // The second consumer is a relative link to the first copy.
      expect(resolve(dirname(join(nm, 'a-two')), readlinkSync(join(nm, 'a-two')))).toBe(join(nm, 'a-one'))
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
      createFixtureLink(join(dir, 'node_modules', '.pnpm', 'spec@1.0.0', 'node_modules', '@standard-schema', 'spec'), join(external, 'node_modules', '@standard-schema', 'spec'))
      createFixtureLink(external, join(nm, 'vendor-pkg'))

      materializeExternalLinks(nm, POSIX)

      // The copied package's inner link is relative and resolves in-tree.
      const inner = join(nm, 'vendor-pkg', 'node_modules', '@standard-schema', 'spec')
      expect(resolve(dirname(inner), readlinkSync(inner))).toBe(store)
      expect(readFileSync(join(inner, 'index.js'), 'utf8')).toBe('spec')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('materializeExternalLinks (win32 real copies)', () => {
  it('replaces out-of-tree links with real copies and keeps in-tree links resolvable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'materialize-'))
    try {
      const nm = join(dir, 'node_modules')
      mkdirSync(nm, { recursive: true })
      const external = join(dir, 'vendor-pkg')
      mkdirSync(external, { recursive: true })
      writeFileSync(join(external, 'package.json'), '{"name":"vendor-pkg"}')
      createFixtureLink(external, join(nm, 'vendor-link'))
      const store = join(nm, '.pnpm', 'real@1.0.0', 'node_modules', 'real')
      mkdirSync(store, { recursive: true })
      writeFileSync(join(store, 'index.js'), 'x')
      createFixtureLink(store, join(nm, 'store-link'))

      const materialized = materializeExternalLinks(nm, WIN32)

      // The out-of-tree link became a real copy; the in-tree link was replaced
      // by a real copy too (win32 packages carry no links at all).
      expect(materialized).toHaveLength(2)
      expect(isRealDirectory(join(nm, 'vendor-link'))).toBe(true)
      expect(readFileSync(join(nm, 'vendor-link', 'package.json'), 'utf8')).toContain('vendor-pkg')
      expect(isRealDirectory(join(nm, 'store-link'))).toBe(true)
      expect(readFileSync(join(nm, 'store-link', 'index.js'), 'utf8')).toBe('x')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('copies a cyclic vendor pair once per consumer without following the cycle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'materialize-'))
    try {
      const nm = join(dir, 'node_modules')
      mkdirSync(nm, { recursive: true })
      const a = join(dir, 'vendor-a')
      const b = join(dir, 'vendor-b')
      mkdirSync(join(a, 'node_modules'), { recursive: true })
      mkdirSync(join(b, 'node_modules'), { recursive: true })
      writeFileSync(join(a, 'package.json'), '{"name":"a"}')
      writeFileSync(join(b, 'package.json'), '{"name":"b"}')
      createFixtureLink(b, join(a, 'node_modules', 'b'))
      createFixtureLink(a, join(b, 'node_modules', 'a'))
      createFixtureLink(a, join(nm, 'a-one'))
      createFixtureLink(a, join(nm, 'a-two'))

      const materialized = materializeExternalLinks(nm, WIN32)

      // Every consumer became a real copy; no symlink remains anywhere.
      expect(materialized).toHaveLength(4)
      expect(isRealDirectory(join(nm, 'a-one'))).toBe(true)
      expect(isRealDirectory(join(nm, 'a-two'))).toBe(true)
      expect(readFileSync(join(nm, 'a-one', 'package.json'), 'utf8')).toContain('"name":"a"')
      expect(readFileSync(join(nm, 'a-two', 'package.json'), 'utf8')).toContain('"name":"a"')
      // The second consumer duplicates the completed first copy, including its
      // copied dependency.
      expect(readFileSync(join(nm, 'a-one', 'node_modules', 'b', 'package.json'), 'utf8')).toContain('"name":"b"')
      expect(readFileSync(join(nm, 'a-two', 'node_modules', 'b', 'package.json'), 'utf8')).toContain('"name":"b"')
      // The cycle is not re-entered: inside a copy, a link back to a target
      // whose copy is still in progress is skipped (resolution walks up to the
      // hoisted top-level copy instead).
      expect(() => lstatSync(join(nm, 'a-one', 'node_modules', 'b', 'node_modules', 'a'))).toThrow()
      expect(() => lstatSync(join(nm, 'a-two', 'node_modules', 'b', 'node_modules', 'a'))).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('copies links inside external copies that point back into the tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'materialize-'))
    try {
      const nm = join(dir, 'node_modules')
      mkdirSync(nm, { recursive: true })
      const store = join(nm, '.pnpm', 'spec@1.0.0', 'node_modules', '@standard-schema', 'spec')
      mkdirSync(store, { recursive: true })
      writeFileSync(join(store, 'index.js'), 'spec')
      const external = join(dir, 'vendor-pkg')
      mkdirSync(join(external, 'node_modules', '@standard-schema'), { recursive: true })
      writeFileSync(join(external, 'package.json'), '{"name":"vendor-pkg"}')
      createFixtureLink(join(dir, 'node_modules', '.pnpm', 'spec@1.0.0', 'node_modules', '@standard-schema', 'spec'), join(external, 'node_modules', '@standard-schema', 'spec'))
      createFixtureLink(external, join(nm, 'vendor-pkg'))

      materializeExternalLinks(nm, WIN32)

      const inner = join(nm, 'vendor-pkg', 'node_modules', '@standard-schema', 'spec')
      expect(isRealDirectory(inner)).toBe(true)
      expect(readFileSync(join(inner, 'index.js'), 'utf8')).toBe('spec')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('pruneNodePtyPrebuilds', () => {
  it('keeps only the target platform prebuild directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prebuilds-'))
    try {
      const prebuilds = join(dir, 'node_modules', 'node-pty', 'prebuilds')
      for (const name of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64', 'linux-x64']) {
        mkdirSync(join(prebuilds, name), { recursive: true })
        writeFileSync(join(prebuilds, name, 'pty.node'), 'x')
      }

      const removed = pruneNodePtyPrebuilds(dir, 'darwin-arm64')

      expect(removed.sort()).toEqual(['darwin-x64', 'linux-x64', 'win32-arm64', 'win32-x64'])
      expect(readdirSync(prebuilds)).toEqual(['darwin-arm64'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('maps the win-x64 platform key to the win32 prebuild name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prebuilds-'))
    try {
      const prebuilds = join(dir, 'node_modules', 'node-pty', 'prebuilds')
      mkdirSync(join(prebuilds, 'win32-x64'), { recursive: true })
      mkdirSync(join(prebuilds, 'darwin-arm64'), { recursive: true })

      const removed = pruneNodePtyPrebuilds(dir, 'win-x64')

      expect(removed).toEqual(['darwin-arm64'])
      expect(readdirSync(prebuilds)).toEqual(['win32-x64'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('ignores a missing node-pty prebuilds directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prebuilds-'))
    try {
      expect(pruneNodePtyPrebuilds(dir, 'darwin-arm64')).toEqual([])
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

describe.skipIf(process.platform === 'win32')('hoistVirtualStore (POSIX links)', () => {
  it('links virtual-store packages to the top level when absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hoist-'))
    try {
      makeStore(dir)
      mkdirSync(join(dir, 'node_modules', '@deepseek-ai', 'dsh-base'), { recursive: true })
      writeFileSync(join(dir, 'node_modules', '@deepseek-ai', 'dsh-base', 'package.json'), '{"name":"@deepseek-ai/dsh-base"}')

      const created = hoistVirtualStore(join(dir, 'node_modules'), POSIX)

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
      hoistVirtualStore(nodeModules, POSIX)
      expect(hoistVirtualStore(nodeModules, POSIX)).toEqual([])
      // A node_modules directory without a virtual store links nothing.
      const plain = mkdtempSync(join(tmpdir(), 'hoist-plain-'))
      try {
        mkdirSync(join(plain, 'node_modules'))
        expect(hoistVirtualStore(join(plain, 'node_modules'), POSIX)).toEqual([])
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

describe('hoistVirtualStore (win32 real copies)', () => {
  it('copies virtual-store packages to the top level when absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hoist-'))
    try {
      makeStore(dir)

      const created = hoistVirtualStore(join(dir, 'node_modules'), WIN32)

      const topLevel = topLevelPackageNames(join(dir, 'node_modules'))
      expect(topLevel).toContain('@deepseek-ai/dsh-llm')
      expect(topLevel).toContain('@deepseek-ai/dsh-token-meter')
      expect(topLevel).toContain('foo')
      expect(created).toHaveLength(3)
      // Top-level entries are real directories, not links.
      expect(isRealDirectory(join(dir, 'node_modules', '@deepseek-ai', 'dsh-llm'))).toBe(true)
      expect(isRealDirectory(join(dir, 'node_modules', 'foo'))).toBe(true)
      expect(readFileSync(join(dir, 'node_modules', 'foo', 'package.json'), 'utf8')).toContain('"name":"foo"')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hoist-'))
    try {
      makeStore(dir)
      const nodeModules = join(dir, 'node_modules')
      hoistVirtualStore(nodeModules, WIN32)
      expect(hoistVirtualStore(nodeModules, WIN32)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
