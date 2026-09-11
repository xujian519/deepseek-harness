/**
 * Resolve a workspace specifier the way the repository's source plane does.
 *
 * The `dsh` source launch (tsx) and vitest resolve workspace imports through
 * the tsconfig `paths` facade to `src`; without a match they fall back to
 * package `exports`, which reach built `lib/` — present on a built dev tree
 * and absent on a clean one. Reading the facade from `tsconfig.base.json`
 * directly keeps a gate's answer independent of whether a loader hook happens
 * to be active and of the process's current directory.
 * @module scripts/source-plane
 */

import { resolve } from 'node:path'
import ts from 'typescript'

/** The extensions a `paths` match ends at when it reached workspace source. */
export const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set<string>([ts.Extension.Ts, ts.Extension.Tsx])

/**
 * A specifier resolver over one containing file's view of the `paths` facade.
 * @param root - repository root.
 * @param containingFile - absolute path the specifier resolves from.
 * @returns a function answering one specifier, or undefined when nothing resolves.
 */
export function sourcePlaneResolver(
  root: string,
  containingFile: string,
): (specifier: string) => ts.ResolvedModuleFull | undefined {
  const config = ts.readConfigFile(resolve(root, 'tsconfig.base.json'), path => ts.sys.readFile(path))
  if (config.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  }
  const { options, errors } = ts.convertCompilerOptionsFromJson(
    (config.config as { compilerOptions?: unknown }).compilerOptions,
    root,
    'tsconfig.base.json',
  )
  if (errors.length > 0) {
    throw new Error(errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'))
  }
  const host: ts.ModuleResolutionHost = {
    fileExists: path => ts.sys.fileExists(path),
    readFile: path => ts.sys.readFile(path),
    directoryExists: path => ts.sys.directoryExists(path),
    // convertCompilerOptionsFromJson leaves `pathsBasePath` unset, so relative
    // `paths` targets resolve against the host's current directory; anchor it to
    // the repository root to keep every caller cwd-independent.
    getCurrentDirectory: () => root,
  }
  return specifier => ts.resolveModuleName(specifier, containingFile, options, host).resolvedModule
}
