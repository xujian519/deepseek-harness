/**
 * Text-level comparison between a proposition and the entry a citation points at.
 *
 * The scoring lives in `@deepseek-ai/dsh-patent-core` because the legal domain
 * applies the same lexical support test; this module keeps the patent-law
 * entry point. See the shared module for how character pairs are weighted and
 * why both signals are deliberately lexical.
 * @module @deepseek-ai/dsh-patent-law/support
 */

export {
  createOverlapIndex,
  PROPOSITION_SUPPORT_DEFAULT,
  textOverlap,
  topicOverlap,
} from '@deepseek-ai/dsh-patent-core'
export type { ComparableEntry, OverlapIndex } from '@deepseek-ai/dsh-patent-core'
