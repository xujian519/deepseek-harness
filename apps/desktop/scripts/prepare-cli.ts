/** Package terminal launch scripts that reuse the installed Electron runtime. */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Placeholder the Windows launcher carries for its application executable name. */
export const PRODUCT_NAME_PLACEHOLDER = '__DSH_DESKTOP_PRODUCT_NAME__'

/**
 * Write one launcher containing the packaged application name.
 * @param template - Launcher template text.
 * @param productName - Packaged application name.
 * @returns Launcher text with every placeholder replaced.
 */
function withProductName(template: string, productName: string): string {
  if (!template.includes(PRODUCT_NAME_PLACEHOLDER)) {
    throw new Error(`desktop CLI: launcher template has no ${PRODUCT_NAME_PLACEHOLDER} placeholder`)
  }
  return template.replaceAll(PRODUCT_NAME_PLACEHOLDER, productName)
}

/**
 * Copy the platform launcher into the application's public command directory.
 *
 * The launcher carries the prepared application name: the batch file has no bundle to read at run
 * time, and the shell launcher stays free of macOS-only tools so the launcher tests exercise it on
 * every platform.
 * @param destination - Physical runtime/cli directory prepared for the application.
 * @param platform - Target Desktop operating system.
 * @param productName - Packaged application name.
 */
export function prepareDesktopCli(destination: string, platform: 'darwin' | 'win32', productName: string): void {
  const name = platform === 'win32' ? 'dsh.cmd' : 'dsh'
  const command = join(destination, 'bin', name)
  mkdirSync(join(destination, 'bin'), { recursive: true })
  const template = readFileSync(join(import.meta.dirname, '..', 'cli', name), 'utf8')
  writeFileSync(command, withProductName(template, productName))
  if (platform === 'darwin') chmodSync(command, 0o755)
}
