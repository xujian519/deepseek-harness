/** Build metadata the shell shows for the artifact it is running. @module @deepseek-ai/dsh-client-ui-primitives/build-version */

/**
 * Version of the running build, with its commit and dirty state appended.
 *
 * The Client bundlers substitute these build-time values, so a source launch
 * that set none of them yields no version.
 * @returns `version[-commit][-dirty]`, or undefined when the build carried no version.
 */
export function localBuildVersion(): string | undefined {
  const version = process.env.DSH_CLIENT_VERSION
  if (version === undefined) return undefined
  const commit = process.env.DSH_CLIENT_COMMIT_HASH
  return version
    + (commit === undefined ? '' : `-${commit}`)
    + (process.env.DSH_CLIENT_GIT_DIRTY === 'true' ? '-dirty' : '')
}
