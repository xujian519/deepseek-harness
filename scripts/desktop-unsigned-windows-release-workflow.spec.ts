import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { loadDesktopPackageEnvironment, validateDesktopPackageEnvironment } from '../apps/desktop/scripts/desktop-package-environment.mjs'
import { expectSharedDispatchContract, loadReleaseWorkflow, stepOf } from './desktop-unsigned-release-workflow.ts'

const root = resolve(import.meta.dirname, '..')
const workflow = loadReleaseWorkflow('desktop-unsigned-windows-release.yml')
const job = workflow.jobs['win-x64']!
const step = (name: string) => stepOf(job, name)
const WINDOWS = { platform: 'win32', arch: 'x64' } as const

it('publishes only on manual dispatch to a GitHub-hosted Windows runner', () => {
  expectSharedDispatchContract(workflow, job)
  expect(job['runs-on']).toBe('windows-latest')
  expect(job.defaults!.run.shell).toBe('pwsh')
})

it('passes dispatch inputs and repository variables through the step environment', () => {
  for (const candidate of job.steps) {
    expect(candidate.run ?? '').not.toContain('${{ inputs.')
    expect(candidate.run ?? '').not.toContain('${{ vars.')
  }
  expect(step('Write the packaging environment').env?.UPDATE_ORIGIN).toBe('${{ vars.DSH_MANDATORY_UPDATE_ORIGIN }}')
})

it('writes a packaging environment that the unsigned Windows target accepts', () => {
  const settings = [...step('Write the packaging environment').run!.matchAll(/^\s*['"](DSH_[A-Z_]+)=([^'"]*)['"]$/gmu)]
    .map(match => `${match[1]}=${match[2]!.replace('$env:UPDATE_ORIGIN', 'https://policy.example.com')}`)
  expect(settings).toHaveLength(3)
  const directory = mkdtempSync(resolve(tmpdir(), 'desktop-unsigned-windows-'))
  try {
    writeFileSync(resolve(directory, '.env.windows'), `${settings.join('\n')}\n`)
    const environment = loadDesktopPackageEnvironment('win32', {}, directory, { unsigned: true })
    validateDesktopPackageEnvironment(environment, WINDOWS, { unsigned: true })
    expect(environment.DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN).toBe('https://policy.example.com')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('builds the unsigned installer from the local application and publishes it with its digest', () => {
  const build = step('Build the installer')
  expect(build.run).toContain('pnpm --dir apps/desktop run package win-x64 --unsigned')
  // PowerShell derives a step's status from its own exit code, so each native command reports it.
  expect(build.run).toContain('exit $LASTEXITCODE')
  expect(step('Install dependencies').run).toContain('exit $LASTEXITCODE')
  const collect = step('Collect the installer and its digest')
  expect(collect.run).toContain('apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts')
  expect(collect.run).toContain('*-win-x64-unsigned.exe')
  const publish = step('Publish the release')
  expect(publish.run).toContain('desktop-unsigned-win-v$env:VERSION')
  expect(publish.run).toContain('.github/desktop-unsigned-windows-release-notes.md')
  expect(publish.run).toContain('gh release upload $tag $env:INSTALLER $env:INSTALLER_DIGEST --clobber')
  expect(existsSync(resolve(root, '.github/desktop-unsigned-windows-release-notes.md'))).toBe(true)
})
