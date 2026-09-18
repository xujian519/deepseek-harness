/** dsh plugin forwards pnpm through the shared profile package operations. */
import { runPluginCommand } from '@deepseek-ai/dsh-plugin-manager/operations'
import { INSTALL_ANCHOR } from './profile-boot.ts'
import { resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { join } from 'node:path'

/** Program name the failure hints prefix their lines with. */
const NAME = 'dsh'

/**
 * Hints for the two pnpm failure classes a `dsh plugin` forward can name: the
 * config home pnpm 10.x actually enforces the git-hosted build allowlist from,
 * and how a store relocation is resolved. Failures matching neither class get
 * no hint — the forwarded spec's shape says nothing reliable about the cause.
 * @param stderr - the captured pnpm stderr text.
 * @param dir - the profile directory the pnpm run happened in.
 * @returns one complete stderr line per hint, without trailing newlines.
 */
export function pnpmFailureHints(stderr: string, dir: string): readonly string[] {
  if (stderr.includes('ERR_PNPM_UNEXPECTED_STORE')) {
    return [
      `${NAME}: this profile's node_modules was linked by a different pnpm major (the store location moved) — `
      + `run the pnpm major that installed the profile, or run 'pnpm install' in ${dir} to migrate the store, then re-run`,
    ]
  }
  if (stderr.includes('ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED')) {
    return [
      `${NAME}: git-hosted packages build via their prepare script, which pnpm blocks until allowlisted — add the exact `
      + `key pnpm printed above (name@<tarball-url-or-git-ref>) to "pnpm.onlyBuiltDependencies" in ${join(dir, 'package.json')}, `
      + 'then re-run (pnpm 10 enforces this from the package.json field even though its own output points at pnpm-workspace.yaml)',
    ]
  }
  return []
}

/** Run package management for a profile.
 * @param profile Profile name.
 * @param args Pnpm arguments relative to the invoking directory.
 * @returns Pnpm exit code.
 */
export async function runPlugin(profile: string, args: readonly string[]): Promise<number> {
  let stderr = ''
  const result = await runPluginCommand({ profile, installAnchor: INSTALL_ANCHOR, cwd: process.cwd() }, args, {
    execution: 'cli',
    outputBytes: 16384,
    lockWaitMs: 120000,
    onOutput: (text, stream) => {
      if (stream === 'stderr') stderr += text
      process[stream].write(text)
    },
  })
  if (result.exitCode === 127) process.stderr.write('dsh: pnpm was not found; install pnpm and make it available on PATH.\n')
  if (result.exitCode !== 0) process.stderr.write(`dsh: pnpm failed; diagnostics: ${result.logPath}\n`)
  for (const line of pnpmFailureHints(stderr, resolveProfileDir(profile))) process.stderr.write(`${line}\n`)
  return result.exitCode
}
