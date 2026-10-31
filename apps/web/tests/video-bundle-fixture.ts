/** The optional video bundle's layers and resolution anchor for the video scenarios. */
import { fileURLToPath } from 'node:url'
import type { LaunchOptions } from './scaffold.ts'

const BUNDLE_DIR = fileURLToPath(new URL('../../../packages/experimental/video-bundle/', import.meta.url))

/**
 * Enable the optional video bundle the way the plugin manager does: its two
 * patch files compose over the shipped Web surface, and the kit anchor keeps
 * the bundle and the experimental packages it depends on resolvable.
 */
export const VIDEO_BUNDLE_FIXTURE = {
  extraOverlayPath: [`${BUNDLE_DIR}cordis.patch.yml`, `${BUNDLE_DIR}presets/video.patch.yml`],
  extraInstallAnchors: [`${BUNDLE_DIR}package.json`],
} satisfies Pick<LaunchOptions, 'extraOverlayPath' | 'extraInstallAnchors'>
