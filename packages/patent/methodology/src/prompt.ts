/**
 * The model-facing TRIZ guidance section registered as tool:triz.
 * @module @deepseek-ai/dsh-methodology/prompt
 */

/** Stable system-prompt prose: when and how to reach the triz tool. */
export const TRIZ_PROMPT_TEXT = [
  'For patent innovation, design-around, and trade-off analysis, use the triz tool when a task names a technical contradiction or conflict between two engineering parameters.',
  'Call triz with no arguments to list the 39 classic engineering parameters and the 40 inventive principles.',
  'Call triz with an improving and a worsening parameter number (1-39) to read that contradiction-matrix cell and its recommended inventive principles.',
].join('\n')
