/**
 * Whole-state snapshot versioning for candidate rounds (C3).
 *
 * Before each optimize round the engine packs the agent-state directory into
 * `v<version>.tar.gz` under `<baseDir>/snapshots/`, excluding secrets such as
 * `.vault.toml` — a secret never enters a snapshot. Versions only ever
 * increase and are never reused: every round mints a fresh version, and a
 * rejected round's snapshot stays on disk so its number cannot be recycled.
 * The archive is produced with the platform `tar`, which macOS and Linux
 * provide; tests run against real temporary directories.
 *
 * @module @deepseek-ai/dsh-self-evolve-benchmark/snapshot
 */

import { execFile } from 'node:child_process'
import { mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Directory name of the snapshot root under the data root. */
export const SNAPSHOT_ROOT = 'snapshots'

/** Filename prefix of a versioned snapshot. */
export const SNAPSHOT_PREFIX = 'v'

/** Filename extension of a versioned snapshot archive. */
export const SNAPSHOT_EXT = '.tar.gz'

/** Paths excluded from every snapshot archive; a secret never enters a snapshot. */
export const EXCLUDED_SNAPSHOT_PATHS = ['.vault.toml']

/**
 * Absolute path of the snapshot root under a data root.
 *
 * @param baseDir Data root for snapshots.
 * @returns Absolute path of the snapshot root.
 */
export function snapshotsDir(baseDir: string): string {
  return join(baseDir, SNAPSHOT_ROOT)
}

/**
 * Absolute path of one version's snapshot archive.
 *
 * @param baseDir Data root for snapshots.
 * @param version Snapshot version.
 * @returns Absolute path of the version's archive.
 */
export function snapshotPath(baseDir: string, version: number): string {
  return join(snapshotsDir(baseDir), `${SNAPSHOT_PREFIX}${version}${SNAPSHOT_EXT}`)
}

/**
 * Parse `v<number>.tar.gz`; non-matching names return `null`.
 *
 * @param filename Snapshot file name.
 * @returns The version number, or `null` when the name does not match.
 */
export function parseSnapshotVersion(filename: string): number | null {
  const match = /^v(\d+)\.tar\.gz$/.exec(filename)
  return match === null ? null : Number(match[1])
}

/**
 * List snapshot versions in ascending order; a missing snapshot root lists none.
 *
 * @param baseDir Data root for snapshots.
 * @returns Existing versions in ascending order.
 */
export async function listSnapshotVersions(baseDir: string): Promise<number[]> {
  let entries
  try {
    entries = await readdir(snapshotsDir(baseDir))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return entries
    .map(parseSnapshotVersion)
    .filter((version): version is number => version !== null)
    .sort((a, b) => a - b)
}

/**
 * The next version to mint: one past the highest existing snapshot, so versions
 * only ever increase.
 *
 * @param baseDir Data root for snapshots.
 * @returns The next version number.
 */
export async function nextVersion(baseDir: string): Promise<number> {
  const versions = await listSnapshotVersions(baseDir)
  return versions.reduce((highest, version) => Math.max(highest, version), 0) + 1
}

/**
 * Pack the agent-state directory into `v<version>.tar.gz`, excluding
 * {@link EXCLUDED_SNAPSHOT_PATHS}.
 *
 * @param baseDir Data root for snapshots.
 * @param version Snapshot version.
 * @param sourceDir Agent-state directory to pack.
 * @returns Absolute path of the created archive.
 */
export async function createSnapshot(baseDir: string, version: number, sourceDir: string): Promise<string> {
  const archive = snapshotPath(baseDir, version)
  await mkdir(snapshotsDir(baseDir), { recursive: true })
  const excludeArgs = EXCLUDED_SNAPSHOT_PATHS.flatMap(path => ['--exclude', path])
  await execFileAsync('tar', ['-czf', archive, ...excludeArgs, '-C', sourceDir, '.'])
  return archive
}

/**
 * Restore a snapshot archive into `targetDir`, creating it first.
 *
 * @param baseDir Data root for snapshots.
 * @param version Snapshot version.
 * @param targetDir Directory to restore into.
 */
export async function restoreSnapshot(baseDir: string, version: number, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true })
  await execFileAsync('tar', ['-xzf', snapshotPath(baseDir, version), '-C', targetDir])
}
