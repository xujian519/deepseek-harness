import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { expectSharedDispatchContract, loadReleaseWorkflow, stepOf } from './desktop-unsigned-release-workflow.ts'

const root = resolve(import.meta.dirname, '..')
const workflow = loadReleaseWorkflow('desktop-unsigned-release.yml')
const job = workflow.jobs['mac-arm64']!
const step = (name: string) => stepOf(job, name)

it('publishes only on manual dispatch to a GitHub-hosted macOS runner', () => {
  expectSharedDispatchContract(workflow, job)
  expect(job['runs-on']).toBe('macos-latest')
})

it('ad-hoc signs the packaged application before archiving it', () => {
  expect(step('Package the unpacked application').run)
    .toContain('pnpm --dir apps/desktop run package mac-arm64 --dir --unsigned')
  expect(step('Sign ad-hoc and archive').run)
    .toContain('codesign --force --deep --sign - "$application"')
})

it('names the archive alone in the digest the release notes verify', () => {
  // `shasum -a 256 -c` reads the recorded path from the downloader's directory, so a digest
  // carrying this build tree's relative path fails to verify the archive beside it.
  expect(step('Sign ad-hoc and archive').run)
    .toContain('( cd "$archive_directory" && shasum -a 256 "$(basename "$archive")" ) > "$archive.sha256"')
  expect(readFileSync(resolve(root, '.github/desktop-unsigned-release-notes.md'), 'utf8'))
    .toContain('shasum -a 256 -c deepseek-harness-<version>-mac-arm64-unsigned.zip.sha256')
})
