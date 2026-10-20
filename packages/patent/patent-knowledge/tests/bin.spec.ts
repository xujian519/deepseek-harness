// The install bin is a self-executing entry (coverage-exempt); its help text is
// the only place the CLI flags are documented for operators.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const binPath = fileURLToPath(new URL('../src/bin.ts', import.meta.url))

describe('patent-knowledge-install bin', () => {
  it('documents every install flag in --help', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', import.meta.resolve('tsx/esm'), binPath, '--help'],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(0)
    for (const flag of [
      '--from <path>',
      '--output <path>',
      '--no-compress-chunks',
      '--keep-embeddings',
      '--no-fts',
      '--no-search-prefix',
      '--search-prefix-chars <n>',
      '--skip-verify',
    ]) {
      expect(result.stdout).toContain(flag)
    }
  })
})
