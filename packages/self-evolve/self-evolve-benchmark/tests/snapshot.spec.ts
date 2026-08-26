import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  EXCLUDED_SNAPSHOT_PATHS,
  SNAPSHOT_EXT,
  SNAPSHOT_PREFIX,
  SNAPSHOT_ROOT,
  createSnapshot,
  listSnapshotVersions,
  nextVersion,
  parseSnapshotVersion,
  restoreSnapshot,
  snapshotPath,
  snapshotsDir,
} from '../src/snapshot.ts'

const execFileAsync = promisify(execFile)

describe('snapshot path and version helpers', () => {
  it('builds snapshot paths under the data root', () => {
    const base = '/root'
    expect(snapshotsDir(base)).toBe(join(base, SNAPSHOT_ROOT))
    expect(snapshotPath(base, 3)).toBe(join(base, SNAPSHOT_ROOT, `${SNAPSHOT_PREFIX}3${SNAPSHOT_EXT}`))
  })

  it('parses v<number>.tar.gz names and rejects everything else', () => {
    expect(parseSnapshotVersion('v1.tar.gz')).toBe(1)
    expect(parseSnapshotVersion('v0.tar.gz')).toBe(0)
    expect(parseSnapshotVersion('v2.tar')).toBeNull()
    expect(parseSnapshotVersion('archive.tar.gz')).toBeNull()
    expect(parseSnapshotVersion('v1x.tar.gz')).toBeNull()
  })

  it('excludes vault secrets from every snapshot', () => {
    expect(EXCLUDED_SNAPSHOT_PATHS).toContain('.vault.toml')
  })
})

describe('snapshot persistence', () => {
  let dir: string
  let source: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-snapshot-'))
    source = await mkdtemp(join(tmpdir(), 'dsh-snapshot-src-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    await rm(source, { recursive: true, force: true })
  })

  it('lists no versions for a missing snapshot root and computes version 1', async () => {
    await expect(listSnapshotVersions(dir)).resolves.toEqual([])
    await expect(nextVersion(dir)).resolves.toBe(1)
  })

  it('fails loud when the snapshot root cannot be listed for a non-missing reason', async () => {
    await writeFile(join(dir, SNAPSHOT_ROOT), 'not a directory', 'utf8')
    await expect(listSnapshotVersions(dir)).rejects.toThrow()
  })

  it('lists existing versions ascending and mints the next strictly-higher number', async () => {
    await mkdir(snapshotsDir(dir), { recursive: true })
    await writeFile(snapshotPath(dir, 3), 'x', 'utf8')
    await writeFile(snapshotPath(dir, 1), 'x', 'utf8')
    await writeFile(join(snapshotsDir(dir), 'README'), 'ignored', 'utf8')
    await writeFile(snapshotPath(dir, 2), 'x', 'utf8')

    await expect(listSnapshotVersions(dir)).resolves.toEqual([1, 2, 3])
    await expect(nextVersion(dir)).resolves.toBe(4)
  })

  it('packs the source directory excluding vault secrets', async () => {
    await writeFile(join(source, 'agent.js'), 'console.log(1)', 'utf8')
    await writeFile(join(source, '.vault.toml'), 'secret = true', 'utf8')

    const archive = await createSnapshot(dir, 1, source)
    expect(archive).toBe(snapshotPath(dir, 1))

    const { stdout } = await execFileAsync('tar', ['-tzf', archive])
    expect(stdout).toContain('agent.js')
    expect(stdout).not.toContain('.vault.toml')
  })

  it('restores a snapshot archive into a fresh target directory', async () => {
    await writeFile(join(source, 'agent.js'), 'console.log(1)', 'utf8')
    await createSnapshot(dir, 1, source)

    const target = join(dir, 'restored')
    await restoreSnapshot(dir, 1, target)
    await expect(readFile(join(target, 'agent.js'), 'utf8')).resolves.toBe('console.log(1)')
  })

  it('fails loud when tar cannot pack a missing source directory', async () => {
    await expect(createSnapshot(dir, 1, join(dir, 'nope'))).rejects.toThrow()
  })

  it('fails loud when restoring a missing snapshot archive', async () => {
    await expect(restoreSnapshot(dir, 1, join(dir, 'target'))).rejects.toThrow()
  })
})
