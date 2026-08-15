/**
 * Download the Node.js runtime that the packaged desktop app embeds. The
 * binary lands in the layout that `apps/desktop/src/main.ts` resolves when
 * `app.isPackaged`: `resources/<os>/node/` (darwin keeps `bin/node`, win32
 * keeps `node.exe`).
 */

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

/** The embedded Node major must satisfy the dsh engines range (`>=24`). */
export const DEFAULT_NODE_VERSION = 'v24.19.0'

const NODEJS_DIST = 'https://nodejs.org/dist'

type NodeArchiveType = 'tar.gz' | 'zip'

/** Where a platform Node archive puts its binary and where we keep it. */
export interface NodeDownloadSpec {
  platform: string
  version: string
  fileName: string
  archiveType: NodeArchiveType
  /** Path of the node binary inside the extracted archive. */
  innerNodePath: string
  /** Path of the node binary under the resources node directory. */
  relNodePath: string
  downloadUrl: string
  checksumUrl: string
}

/** Describe the Node archive for a desktop target platform. */
export function nodeDownloadSpec(platform: string, version: string): NodeDownloadSpec {
  const v = version.startsWith('v') ? version : `v${version}`
  switch (platform) {
    case 'darwin-arm64':
    case 'darwin-x64':
    case 'linux-x64': {
      const fileName = `node-${v}-${platform}.tar.gz`
      return {
        platform,
        version: v,
        fileName,
        archiveType: 'tar.gz',
        innerNodePath: `node-${v}-${platform}/bin/node`,
        relNodePath: 'bin/node',
        downloadUrl: `${NODEJS_DIST}/${v}/${fileName}`,
        checksumUrl: `${NODEJS_DIST}/${v}/SHASUMS256.txt`,
      }
    }
    case 'win-x64': {
      const fileName = `node-${v}-win-x64.zip`
      return {
        platform,
        version: v,
        fileName,
        archiveType: 'zip',
        innerNodePath: `node-${v}-win-x64/node.exe`,
        relNodePath: 'node.exe',
        downloadUrl: `${NODEJS_DIST}/${v}/${fileName}`,
        checksumUrl: `${NODEJS_DIST}/${v}/SHASUMS256.txt`,
      }
    }
    default:
      throw new Error(`unsupported desktop Node platform: ${platform}`)
  }
}

/** The Node platform key for the host that runs the packager. */
export function currentDesktopPlatform(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  switch (process.platform) {
    case 'darwin':
      return `darwin-${arch}`
    case 'win32':
      return 'win-x64'
    case 'linux':
      return `linux-${arch}`
    default:
      throw new Error(`unsupported desktop host platform: ${process.platform}`)
  }
}

/** The SHA-256 for a file name from a nodejs.org SHASUMS256.txt document. */
export function checksumForFile(shasumsText: string, fileName: string): string | undefined {
  for (const line of shasumsText.split(/\r?\n/)) {
    const [hash, file] = line.trim().split(/\s+/)
    if (file === fileName) return hash
  }
  return undefined
}

/** SHA-256 hex digest of a buffer. */
export function sha256Of(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

/** GET a URL into a buffer; non-2xx responses throw. */
export async function fetchBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`GET ${url} -> ${response.status} ${response.statusText}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

/** Extract an archive into a directory using the host `tar` (bsdtar on macOS, libarchive tar.exe on Windows). */
function extractArchive(archivePath: string, destDir: string, archiveType: NodeArchiveType): void {
  const args = archiveType === 'zip' ? ['-xf', archivePath, '-C', destDir] : ['-xzf', archivePath, '-C', destDir]
  const result = spawnSync('tar', args, { stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`tar extraction failed for ${archivePath} (status ${String(result.status)})`)
  }
}

export interface DownloadNodeOptions {
  spec: NodeDownloadSpec
  /** The resources node directory that receives the binary. */
  targetDir: string
  /** Re-download even when the target binary already exists. */
  force?: boolean
}

/**
 * Download, checksum-verify, and extract the Node binary for a platform.
 * @returns the absolute path of the installed binary.
 */
export async function downloadNode(options: DownloadNodeOptions): Promise<string> {
  const { spec, targetDir, force } = options
  const target = join(targetDir, spec.relNodePath)
  if (!force && existsSync(target)) {
    return target
  }
  mkdirSync(dirname(target), { recursive: true })
  const tempDir = mkdtempSync(join(targetDir, '.node-download-'))
  try {
    const shasumsText = (await fetchBuffer(spec.checksumUrl)).toString('utf8')
    const expected = checksumForFile(shasumsText, spec.fileName)
    if (expected === undefined) {
      throw new Error(`no checksum for ${spec.fileName} in ${spec.checksumUrl}`)
    }
    const archive = await fetchBuffer(spec.downloadUrl)
    const actual = sha256Of(archive)
    if (actual !== expected) {
      throw new Error(`checksum mismatch for ${spec.fileName}: expected ${expected}, got ${actual}`)
    }
    const archivePath = join(tempDir, spec.fileName)
    writeFileSync(archivePath, archive)
    extractArchive(archivePath, tempDir, spec.archiveType)
    const inner = join(tempDir, spec.innerNodePath)
    if (!existsSync(inner)) {
      throw new Error(`archive ${spec.fileName} did not contain ${spec.innerNodePath}`)
    }
    renameSync(inner, target)
    if (spec.relNodePath !== 'node.exe') {
      chmodSync(target, 0o755)
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
  return target
}

/** Default resources node directory for a platform, relative to the repository root. */
function defaultNodeResourcesDir(platform: string): string {
  const osDir = platform.startsWith('darwin') ? 'mac' : platform.startsWith('win') ? 'win' : 'linux'
  return resolve(import.meta.dirname, '..', 'apps', 'desktop', 'resources', osDir, 'node')
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      platform: { type: 'string' },
      version: { type: 'string', default: DEFAULT_NODE_VERSION },
      dir: { type: 'string' },
      force: { type: 'boolean', default: false },
    },
  })
  const spec = nodeDownloadSpec(values.platform ?? currentDesktopPlatform(), values.version)
  const target = await downloadNode({ spec, targetDir: values.dir ?? defaultNodeResourcesDir(spec.platform), force: values.force })
  console.log(`node ${spec.version} (${spec.platform}) -> ${target}`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
