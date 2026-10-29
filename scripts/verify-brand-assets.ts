/**
 * Reject brand assets that reintroduce DeepSeek's official whale artwork or
 * drift from the recorded DSH Patent mark geometry.
 *
 * This fork names itself by the `DSH` abbreviation that BRAND_GUIDELINES.md
 * permits, so it must not ship the official whale mark as its own icon: a
 * third-party product wearing official artwork reads as DeepSeek endorsement.
 * The upstream brand packages already gate themselves behind
 * `DSH_CLIENT_BUILD_PROFILE === 'official'`, which is never `local`, so a fork
 * build renders the fallback whale unless its own mark takes the slot.
 *
 * The check has two halves. The whale scan catches artwork copied back in by a
 * rebase. The geometry scan pins the recorded mark so an automatic icon
 * regeneration cannot quietly emit a different silhouette.
 */

import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { uniqueRepoFiles } from './repo-files.ts'

const root = resolve(import.meta.dirname, '..')

/**
 * Distinctive coordinates of the official whale path. Each is a fragment long
 * enough that an unrelated icon will not contain it, and they are spread across
 * the outline, the eye, and the fin so a recoloured or partially edited copy
 * still matches.
 */
export const OFFICIAL_WHALE_SIGNATURES = [
  'M48.8354 10.0479',
  'M33.1973 11.3599',
  'M26.3433 24.6001',
  'M22.9168 1.43018',
  'M11.1749 14.4736',
] as const

/**
 * Product-identity asset trees that must never carry the official whale.
 *
 * Upstream library sources stay out of scope: `ui-primitives` keeps `FishLogo`
 * as the shared fallback, and the official brand packages carry their own
 * `DSH_CLIENT_BUILD_PROFILE` gate. Those are upstream files a rebase must stay
 * free to change, so pinning them here would turn every sync into a conflict.
 * This gate protects the fork's outward identity — the icons a user installs.
 */
const SCANNED_PATTERNS = [
  'apps/web/public/**/*.svg',
  'website/public/**/*.svg',
  'apps/desktop/assets/**/*.svg',
  'brand/**/*.svg',
] as const

/** The fork's own mark sources, pinned to the recorded geometry. */
const FIXED_MARK_PATTERNS = [
  'brand/**/mark*.svg',
  'brand/**/icon*.svg',
] as const

/** One mark path the recorded geometry requires, with the role it plays. */
interface ExpectedStroke {
  /** Source fragment that must appear verbatim (whitespace-insensitive). */
  fragment: string
  /** Human-readable role, used in the failure message. */
  role: string
}

/** The standard 6u mark: two hooks, left primary and right accent. */
const STANDARD_MARK: readonly ExpectedStroke[] = [
  { fragment: 'M24 14 L10 32 L24 50', role: 'left hook body' },
  { fragment: 'M24 50 L33.6 42.4', role: 'left hook tip' },
  { fragment: 'M40 14 L54 32 L40 50', role: 'right hook body' },
  { fragment: 'M40 14 L30.4 21.6', role: 'right hook tip' },
]

/**
 * The 8u small variant. Its hooks sit closer to the canvas edge and stroke
 * thicker, so it is a deliberate redraw rather than a scaled standard mark:
 * rescaling the 6u source to 16 px thins the tips until they disappear.
 */
const SMALL_MARK: readonly ExpectedStroke[] = [
  { fragment: 'M25 12 L9 32 L25 52', role: 'left hook body' },
  { fragment: 'M25 52 L33.9 43.1', role: 'left hook tip' },
  { fragment: 'M39 12 L55 32 L39 52', role: 'right hook body' },
  { fragment: 'M39 12 L30.1 20.9', role: 'right hook tip' },
]

/**
 * The 22 px tray template: both hooks, no tips. At 22 px a monochrome tip
 * collapses into the stroke and reads as a smudge, so the template drops it.
 */
const TRAY_MARK: readonly ExpectedStroke[] = [
  { fragment: 'M25 11 L8 32 L25 53', role: 'left hook body' },
  { fragment: 'M39 11 L56 32 L39 53', role: 'right hook body' },
]

/**
 * Recorded geometry per mark source. A source absent from this map is not
 * pinned: it may be a new variant under development, and inventing an expected
 * geometry for it here would only freeze the wrong thing.
 */
const PINNED_MARKS = new Map<string, readonly ExpectedStroke[]>([
  ['mark.svg', STANDARD_MARK],
  ['mark-dark.svg', STANDARD_MARK],
  ['mark-mono.svg', STANDARD_MARK],
  ['mark-small.svg', SMALL_MARK],
  ['mark-small-mono.svg', SMALL_MARK],
  ['mark-tray.svg', TRAY_MARK],
])

/** The pinned geometry for a mark source, keyed by file name. */
function expectedFor(sourcePath: string): readonly ExpectedStroke[] | undefined {
  const name = sourcePath.replaceAll('\\', '/').split('/').pop() ?? ''
  return PINNED_MARKS.get(name)
}

/** A located violation in one asset file. */
export interface BrandAssetViolation {
  /** Repository-relative path. */
  file: string
  /** What the check rejected. */
  reason: string
}

/**
 * Find official whale artwork in one SVG document.
 * @param source - SVG text.
 * @returns matched signature fragments (empty when clean).
 */
export function findWhaleSignatures(source: string): string[] {
  return OFFICIAL_WHALE_SIGNATURES.filter(signature => source.includes(signature))
}

/** Normalize whitespace so SVG path spacing differences do not read as drift. */
function compact(source: string): string {
  return source.replaceAll(/\s+/gu, '')
}

/**
 * Find geometry drift in one recorded mark source against its own variant.
 * @param source - SVG text.
 * @param expected - the strokes this variant must keep.
 * @returns missing strokes (empty when the geometry matches).
 */
export function findMissingStrokes(source: string, expected: readonly ExpectedStroke[] = STANDARD_MARK): ExpectedStroke[] {
  const flat = compact(source)
  return expected.filter(stroke => !flat.includes(compact(stroke.fragment)))
}

/** Check one asset file for reintroduced official artwork. */
function inspectAsset(file: string, source: string): BrandAssetViolation[] {
  const signatures = findWhaleSignatures(source)
  if (signatures.length === 0) return []
  return [{
    file,
    reason: `official DeepSeek whale artwork (matched ${signatures.length} path signature(s), e.g. ${signatures[0]})`,
  }]
}

/**
 * Verify the fork's own mark keeps its recorded geometry.
 * @param file - repository-relative path.
 * @param source - SVG text.
 * @returns violations naming each stroke that drifted, empty for unpinned variants.
 */
export function inspectMarkGeometry(file: string, source: string): BrandAssetViolation[] {
  const expected = expectedFor(file)
  if (expected === undefined) return []
  return findMissingStrokes(source, expected).map(stroke => ({
    file,
    reason: `mark geometry drift: missing ${stroke.role} (expected fragment "${stroke.fragment}")`,
  }))
}

/**
 * Scan every product-identity asset and every pinned mark source.
 * @returns exit code: 0 when clean, 1 when any violation was reported.
 */
function main(): number {
  const scanned = uniqueRepoFiles(root, SCANNED_PATTERNS)
  const assetViolations = scanned.flatMap(file => inspectAsset(relative(root, file.abs), readFileSync(file.abs, 'utf8')))

  const marks = uniqueRepoFiles(root, FIXED_MARK_PATTERNS)
  const geometryViolations = marks.flatMap(file => inspectMarkGeometry(relative(root, file.abs), readFileSync(file.abs, 'utf8')))

  const all = [...assetViolations, ...geometryViolations]

  if (all.length === 0) {
    console.log(`verify-brand-assets: ${scanned.length} asset file(s) scanned, ${marks.length} mark source(s) pinned, no violations.`)
    return 0
  }

  console.error('verify-brand-assets: brand asset violations found:')
  for (const v of all) {
    console.error(`  ${v.file}  ${v.reason}`)
  }
  console.error('The fork ships its own mark; restore it from brand/assets/ and re-run the icon generator.')
  return 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main())
}
