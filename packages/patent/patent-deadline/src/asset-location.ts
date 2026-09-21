/**
 * Locate the packaged work-calendar asset.
 *
 * The calendar ships inside the package (`assets/work-calendar/`) and resolves
 * relative to this module, so both the source tree and the built `lib/` bundle
 * read the same directory. An explicit directory replaces the packaged one and
 * must mirror its layout.
 * @module @deepseek-ai/dsh-patent-deadline/asset-location
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ASSETS_CALENDAR_URL = new URL('../assets/work-calendar/', import.meta.url)

/** Packaged work-calendar directory name. */
export const CALENDAR_FILE_NAME = 'cn-holidays.yaml'

/**
 * Directory holding the work-calendar asset: the explicit override when given
 * (resolved against the process working directory), otherwise the packaged one.
 * @param calendarDir - optional directory override.
 * @returns the absolute calendar directory path.
 */
export function workCalendarDir(calendarDir?: string): string {
  return calendarDir !== undefined && calendarDir.trim() !== ''
    ? resolve(calendarDir)
    : fileURLToPath(ASSETS_CALENDAR_URL)
}
