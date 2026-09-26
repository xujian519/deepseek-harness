/**
 * The asset format shared by the shipped patent fact indexes.
 *
 * `@deepseek-ai/dsh-patent-law` and `@deepseek-ai/dsh-patent-fees` each ship a
 * YAML index transcribed by hand and read at plugin load; both refuse a
 * malformed field instead of coercing it, and both record where each entry came
 * from. This package owns that format so the two indexes share one set of field
 * rules rather than a copy each.
 *
 * It is a pure library: no plugin, no service, no state.
 * @module @deepseek-ai/dsh-patent-index-asset
 */

export { IndexAssetError, type AssetFail } from './errors.ts'
export {
  parseYamlMapping,
  readCount,
  readEnum,
  readMapping,
  readOptionalBoolean,
  readOptionalCount,
  readOptionalDate,
  readOptionalString,
  readString,
} from './fields.ts'
export { readRecordedSource, type RecordedSource } from './source.ts'
