/**
 * The load error of a shipped index asset.
 *
 * An index that does not parse must fail the deployment rather than run with a
 * partial table, so the reader refuses the malformed field and names the file it
 * came from. Each index package subclasses this with its own error name, which
 * is what its callers catch.
 * @module @deepseek-ai/dsh-patent-index-asset/errors
 */

/** Thrown when a shipped index asset is unreadable or malformed. */
export class IndexAssetError extends Error {
  /** Absolute path of the file the error came from, when it came from one. */
  readonly origin: string | null

  /**
   * @param message - what is wrong with the asset.
   * @param origin - the file the error came from.
   */
  constructor(message: string, origin: string | null) {
    super(message)
    this.name = 'IndexAssetError'
    this.origin = origin
  }
}

/**
 * Build the error a reader raises, bound to one file.
 *
 * Readers take this instead of an error class so each index package keeps its
 * own catchable error type while sharing one set of field rules.
 */
export type AssetFail = (message: string) => IndexAssetError
