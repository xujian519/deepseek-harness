/** Keep prepared Windows PE files outside ASAR without changing their sealed bytes. */
import { cp, lstat, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { readAsar } from 'app-builder-lib/out/asar/asar.js'
import { windowsRuntimeCode } from './windows-runtime-signature.mjs'

function inside(root, file) {
  const suffix = relative(root, file)
  return suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
}

function unpackPattern(path) {
  // Builder removes backslash escapes; brace expansion also ignores character classes.
  // A brace matches one character, so similarly named neighbors may also be unpacked.
  return path.split(sep).join('/').replace(/[\[\]{}()*?+@#]/gu,
    character => character === '{' || character === '}' ? '?' : `[${character}]`).replace(/^!/u, '@(!)')
}

/**
 * Install source-relative PE patterns in the configuration consumed by electron-builder.
 * @param {import('app-builder-lib').BeforePackContext} context Active builder configuration and cleanup owner.
 * @param {string} sourceRoot Verified prepared dsh directory; its files remain unchanged.
 * @returns {Promise<string[]>} PE paths relative to the original prepared directory.
 */
export async function prepareWindowsAsarUnpack(context, sourceRoot) {
  const files = (await windowsRuntimeCode(sourceRoot)).map(file => relative(sourceRoot, file))
  const { config, info } = context.packager
  const { appDir } = info
  let copyRoot = sourceRoot
  if (!inside(appDir, sourceRoot)) {
    // Builder's source matcher slices the appDir prefix even for external FileSets.
    const parent = join(appDir, '.desktop-build')
    await mkdir(parent, { recursive: true })
    const stage = await mkdtemp(join(parent, 'asar-source-'))
    copyRoot = join(stage, 'dsh')
    info.disposeOnBuildFinish(() => rm(stage, { recursive: true, force: true }))
    await cp(sourceRoot, copyRoot, { recursive: true, force: false, errorOnExist: true })
    config.files = config.files.map(file => {
      if (typeof file === 'string' || file.from === undefined) return file
      const from = resolve(appDir, file.from)
      return inside(sourceRoot, from) ? { ...file, from: join(copyRoot, relative(sourceRoot, from)) } : file
    })
  }
  const existing = config.asarUnpack ?? []
  config.asarUnpack = [...(typeof existing === 'string' ? [existing] : existing),
    ...files.map(file => unpackPattern(relative(appDir, join(copyRoot, file))))]
  return files
}

/**
 * Read one ASAR entry, reporting a path the archive does not carry as absence.
 *
 * The archive reports only a missing directory as an exception, so reading the parent first keeps a
 * deployed-beside file distinguishable from a broken archive.
 * @param {import('app-builder-lib/out/asar/asar.js').AsarFilesystem} archive - Archive to read.
 * @param {string} path - Entry path inside the archive, in host separators.
 * @returns {import('app-builder-lib/out/asar/asar.js').Node | undefined} Entry, or undefined when the archive holds neither it nor its directory.
 */
function archiveEntry(archive, path) {
  const directory = archive.searchNodeFromDirectory(dirname(path), false)
  return directory === null ? undefined : directory.files[basename(path)]
}

/**
 * Require a PE the archive omits to keep its prepared bytes at its relative path beside the archive.
 * @param {string} prepared - File in the sealed prepared dsh directory.
 * @param {string} beside - Candidate file under the resources directory.
 * @param {string} file - Prepared path relative to the dsh root, used in diagnostics.
 * @returns {Promise<void>} Resolves after the beside copy is a real file with unchanged bytes.
 */
async function verifyBesidePrepared(prepared, beside, file) {
  const details = await lstat(beside).catch(error => {
    throw error.code === 'ENOENT'
      ? new Error(`Windows ASAR: PE is absent from the application: ${file}`)
      : error
  })
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`Windows ASAR: expected a real PE file beside the archive: ${file}`)
  }
  const [expected, placed] = await Promise.all([readFile(prepared), readFile(beside)])
  if (!expected.equals(placed)) throw new Error(`Windows ASAR: beside-archive PE bytes changed: ${file}`)
}

/**
 * Reject inline, absent, linked, or changed PE files in the assembled application.
 *
 * The application deploys selected packages beside the archive rather than inside it, because their
 * child processes read a real filesystem path with real file modes. Such a PE holds no archive entry;
 * every other PE must be unpacked, so it never stays inline where it cannot be signed or executed.
 * @param {string} sourceRoot Original signed and sealed dsh directory.
 * @param {string} resourcesDir Assembled application resources directory.
 * @param {string[]} files PE paths returned by prepareWindowsAsarUnpack.
 * @returns {Promise<void>} Resolves after every PE is unpacked or placed beside the archive with identical bytes.
 */
export async function verifyWindowsAsarUnpack(sourceRoot, resourcesDir, files) {
  const archive = await readAsar(join(resourcesDir, 'app.asar'))
  for (const file of files) {
    const prepared = join(sourceRoot, file)
    const entry = archiveEntry(archive, join('dsh', file))
    if (entry === undefined) {
      await verifyBesidePrepared(prepared, join(resourcesDir, file), file)
      continue
    }
    if (entry.unpacked !== true || entry.link !== undefined) {
      throw new Error(`Windows ASAR: PE must be unpacked: ${file}`)
    }
    const copied = join(resourcesDir, 'app.asar.unpacked', 'dsh', file)
    const stat = await lstat(copied)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Windows ASAR: expected a real PE file: ${file}`)
    const [preparedBytes, packaged] = await Promise.all([readFile(prepared), readFile(copied)])
    if (!preparedBytes.equals(packaged)) throw new Error(`Windows ASAR: PE bytes changed: ${file}`)
  }
}
