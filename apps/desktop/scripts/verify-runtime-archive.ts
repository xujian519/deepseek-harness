/** Verify runtime bytes and executable permissions using ASAR records and physical unpacked files. */
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { readAsar, type Node } from 'app-builder-lib/out/asar/asar.js'
import { excludedExts, excludedNames } from 'app-builder-lib/out/fileMatcher.js'
import type { DesktopRuntimeDescriptor, DesktopRuntimeFile } from '../src/runtime-tree.ts'

/** Names the packager's default matcher drops at any depth. */
const PACKAGER_IGNORED_NAMES = new Set(excludedNames.split(','))

/** Extensions the packager's default matcher drops at any depth. */
const PACKAGER_IGNORED_EXTS = new Set(excludedExts.split(','))

/**
 * Report whether the packager's default matcher drops one prepared path.
 *
 * The packager appends negative patterns that drop these names and extensions at any depth, so a
 * prepared file carrying one of them never reaches the application.
 * @param path - Prepared runtime path relative to the dsh root.
 * @returns Whether the path never appears in the packaged application.
 */
export function isPackagerIgnored(path: string): boolean {
  return path.split('/').some((segment) => {
    if (PACKAGER_IGNORED_NAMES.has(segment)) return true
    const dot = segment.indexOf('.')
    return dot !== -1 && PACKAGER_IGNORED_EXTS.has(segment.slice(dot + 1))
  })
}

/**
 * Check the prepared files electron-builder places beside the archive instead of inside it.
 *
 * `extraResources` keeps the Office engine out of the archive, because its conversion helper reads a
 * real filesystem path with real file modes. Every prepared file the archive lacks must exist at its
 * relative path under the resources directory, and that subtree must hold no other file.
 * @param resources - Resources directory holding the archive.
 * @param beside - Prepared files the archive does not carry, by relative path.
 */
export async function verifyBesideArchive(
  resources: string,
  beside: ReadonlyMap<string, DesktopRuntimeFile>,
): Promise<void> {
  const roots = new Set<string>()
  for (const [path, expected] of beside) {
    roots.add(path.split('/')[0]!)
    const physical = join(resources, ...path.split('/'))
    const details = await lstat(physical).catch((error: NodeJS.ErrnoException) => {
      throw error.code === 'ENOENT'
        ? new Error(`desktop runtime: prepared file is absent from the application: ${path}`)
        : error
    })
    if (!details.isFile()) throw new Error(`desktop runtime: beside-archive entry is not a file: ${path}`)
    const body = await readFile(physical)
    const actual = { bytes: body.byteLength, sha256: createHash('sha256').update(body).digest('hex'),
      executable: process.platform !== 'win32' && (details.mode & 0o111) !== 0 }
    if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256 || actual.executable !== expected.executable) {
      throw new Error(`desktop runtime: beside-archive integrity verification failed at ${path}`)
    }
  }
  for (const root of roots) {
    const entries = await readdir(join(resources, root), { recursive: true, withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) continue
      const path = relative(resources, join(entry.parentPath, entry.name)).split(sep).join('/')
      if (!beside.has(path)) throw new Error(`desktop runtime: unexpected beside-archive entry ${path}`)
    }
  }
}

/**
 * Compare the complete prepared dsh tree with the packaged application.
 *
 * Packaged files live in the archive, except the ones `extraResources` places beside it and the
 * ones the packager's default matcher drops. Every remaining prepared file must appear in one of
 * those two places, and neither may extend the sealed preparation inventory.
 * @param archivePath - Application ASAR file beside its unpacked directory.
 * @param expected - Verified preparation descriptor, including its complete file inventory.
 * @returns Resolves when bytes, file membership and meaningful executable permissions match.
 */
export async function verifyRuntimeArchive(archivePath: string, expected: DesktopRuntimeDescriptor): Promise<void> {
  const archive = await readAsar(archivePath)
  const descriptor = await archive.readFile(join('dsh', 'desktop-runtime.json'))
  if (!descriptor.equals(Buffer.from(`${JSON.stringify(expected, undefined, 2)}\n`))) {
    throw new Error('desktop runtime: archived descriptor differs from preparation')
  }
  const archived = new Map<string, DesktopRuntimeFile>()
  const unpacked = new Set<string>()
  async function visit(node: Node, path: string): Promise<void> {
    if (node.link !== undefined) throw new Error(`desktop runtime: unexpected ASAR link ${path}`)
    if (node.files !== undefined) {
      for (const [name, child] of Object.entries(node.files)) await visit(child, path === '' ? name : `${path}/${name}`)
      return
    }
    const name = join('dsh', ...path.split('/'))
    const physical = node.unpacked === true ? await lstat(join(`${archivePath}.unpacked`, name)) : undefined
    if (physical !== undefined && !physical.isFile()) throw new Error(`desktop runtime: unexpected unpacked entry ${path}`)
    if (node.unpacked === true) unpacked.add(join(`${archivePath}.unpacked`, name))
    if (path === 'desktop-runtime.json') return
    const body = await archive.readFile(name)
    // ASAR stores only owner-execute; group/other-only executable files fail the inventory comparison.
    const executable = process.platform !== 'win32' && (physical !== undefined
      ? (physical.mode & 0o111) !== 0
      : node.executable === true)
    archived.set(path, { path, bytes: body.byteLength, sha256: createHash('sha256').update(body).digest('hex'), executable })
  }
  await visit(archive.getFile('dsh', false), '')
  const entries = await readdir(join(`${archivePath}.unpacked`, 'dsh'), { recursive: true, withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' && unpacked.size === 0) return []
      throw error
    })
  for (const entry of entries) {
    if (entry.isDirectory()) continue
    const path = join(entry.parentPath, entry.name)
    if (!entry.isFile() || !unpacked.has(path)) throw new Error(`desktop runtime: unexpected unpacked entry ${path}`)
  }
  const expectedByPath = new Map(expected.files.map(file => [file.path, file]))
  for (const path of archived.keys()) {
    if (!expectedByPath.has(path)) throw new Error(`desktop runtime: unexpected ASAR entry ${path}`)
  }
  const beside = new Map<string, DesktopRuntimeFile>()
  for (const file of expected.files) {
    const actual = archived.get(file.path)
    if (actual === undefined) {
      if (!isPackagerIgnored(file.path)) beside.set(file.path, file)
      continue
    }
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256 || actual.executable !== file.executable) {
      throw new Error(`desktop runtime: ASAR integrity verification failed at ${file.path}`)
    }
  }
  await verifyBesideArchive(dirname(archivePath), beside)
}
