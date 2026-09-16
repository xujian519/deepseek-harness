/**
 * The markdown renderer's element pipelines: one settled full parse, and one
 * incremental streaming render over the `incremental.ts` parser and
 * `render.tsx`.
 *
 * While a message streams, all but the trailing two blocks freeze as cached
 * React elements and only the source tail behind them re-parses per chunk, so
 * per-chunk work tracks the tail size instead of the whole reply. Frozen
 * blocks keep their source-offset keys when they cross the freeze boundary, so
 * React reconciles instead of remounting. A tail that cannot freeze — one
 * growing top-level block — re-parses the whole accumulated reply on every
 * frame, so the streaming path admits frames through a {@link StreamFrameGate}
 * and the owner retries the frames it held back. Known deviation while
 * streaming: a reference-style link or footnote whose definition sits on the
 * other side of the freeze boundary renders literally until the settled full
 * parse self-heals it.
 */

import type { ReactNode } from 'react'
import { IncrementalMarkdownParser } from './incremental.ts'
import { parseGfm, parseGfmWithMath } from './parse.ts'
import {
  collectReferenceTargets, createReferenceTargets, renderBlocks, renderFootnoteSection,
  wrapBlockChildren,
} from './render.tsx'
import type { MarkdownFileMentions, MarkdownLabels, MarkdownPathImages, MarkdownRenderContext, ReferenceTargets } from './render.tsx'
import { StreamFrameGate } from './stream-frame-gate.ts'

/**
 * One settled full render: parse with math, resolve references, append the footnote section.
 * @param text - complete markdown source.
 * @param labels - localized labels consumed by rendered blocks.
 * @param fileMentions - workspace file references the source may resolve, when the owner supplies them.
 * @param pathImages - path images the source may resolve, when the owner supplies them.
 * @returns the settled elements, without the streaming renderer's per-frame caching.
 */
export function renderSettled(
  text: string,
  labels: MarkdownLabels,
  fileMentions: MarkdownFileMentions | undefined,
  pathImages: MarkdownPathImages | undefined,
): ReactNode[] {
  const root = parseGfmWithMath(text)
  const targets = createReferenceTargets()
  collectReferenceTargets(root.children, targets)
  const context: MarkdownRenderContext = {
    streaming: false,
    labels,
    fileMentions,
    pathImages,
    targets,
    footnoteOrder: [],
    footnoteCounts: new Map(),
  }
  const blocks = wrapBlockChildren(
    renderBlocks(root.children.map((node, index) => ({
      node,
      /* v8 ignore next -- parseGfmWithMath stamps every top-level node. */
      key: node.position?.start.offset ?? -(index + 1),
    })), context),
    false,
  )
  const section = renderFootnoteSection(context)
  return section === null ? blocks : [...blocks, '\n', section]
}

/**
 * Streaming render state for one growing message: the incremental parser,
 * the frozen blocks' cached elements, and the reference/footnote state their
 * rendering consumed (footnote numbering assigned to frozen references is
 * final, so the tail continues from a copy of it each frame).
 */
export class StreamingRenderer {
  private readonly parser = new IncrementalMarkdownParser(parseGfm)
  private generation = -1
  private frozenCount = 0
  private frozenElements: ReactNode[] = []
  private frozenTargets: ReferenceTargets = createReferenceTargets()
  private frozenFootnoteOrder: string[] = []
  private frozenFootnoteCounts = new Map<string, number>()
  private lastText: string | null = null
  private lastRendered: ReactNode[] = []

  /**
   * @param labels - Localized Markdown chrome baked into cached elements; the owner replaces the renderer when it changes.
   * @param gate - Frame admission for replies whose open tail block outgrows {@link StreamFrameGate}'s budget.
   */
  constructor(
    private readonly labels: MarkdownLabels,
    private readonly gate: StreamFrameGate = new StreamFrameGate(),
  ) {}

  /**
   * Render the current accumulated text. Idempotent per text value, so React
   * may re-execute the calling render freely. A frame the gate holds back
   * returns the previous frame's elements and reports itself through
   * {@link delayMs}.
   * @param text - The full accumulated markdown source.
   * @returns Frozen elements, re-rendered tail, and the footnote section.
   */
  render(text: string): ReactNode[] {
    if (text === this.lastText) {
      this.gate.release()
      return this.lastRendered
    }
    // Only an appended frame may be held back: a rewritten document is not the
    // frame's continuation, and the settled render is a full parse by contract.
    const appended = this.lastText !== null && text.startsWith(this.lastText)
    if (appended && !this.gate.claim(text.length)) return this.lastRendered
    return this.gate.measure(() => this.rebuild(text))
  }

  /**
   * Remaining wait before the held-back frame's text appears.
   * @returns Milliseconds to wait, or `null` when no frame is waiting.
   */
  delayMs(): number | null {
    return this.gate.delayMs()
  }

  /** Re-parse the unstable tail and assemble the frame's children from the frozen prefix. */
  private rebuild(text: string): ReactNode[] {
    const { frozen, tail, generation } = this.parser.update(text)
    if (generation !== this.generation) {
      this.generation = generation
      this.frozenCount = 0
      this.frozenElements = []
      this.frozenTargets = createReferenceTargets()
      this.frozenFootnoteOrder = []
      this.frozenFootnoteCounts = new Map()
    }
    const newlyFrozen = frozen.slice(this.frozenCount)
    collectReferenceTargets(newlyFrozen.map(block => block.node), this.frozenTargets)
    // Targets visible this frame: everything frozen so far plus the current
    // tail parse — a newly frozen block's references resolved against the
    // same parse tree its definitions came from.
    const frameTargets: ReferenceTargets = {
      definitions: new Map(this.frozenTargets.definitions),
      footnotes: new Map(this.frozenTargets.footnotes),
    }
    collectReferenceTargets(tail.map(block => block.node), frameTargets)
    if (newlyFrozen.length > 0) {
      const frozenContext: MarkdownRenderContext = {
        streaming: true,
        labels: this.labels,
        fileMentions: undefined,
        pathImages: undefined,
        targets: frameTargets,
        footnoteOrder: this.frozenFootnoteOrder,
        footnoteCounts: this.frozenFootnoteCounts,
      }
      // Separator newlines are cached alongside the elements so the
      // assembled children match the settled pipeline's block wrapping.
      const batch = [...this.frozenElements]
      for (const element of renderBlocks(newlyFrozen, frozenContext)) {
        if (batch.length > 0) batch.push('\n')
        batch.push(element)
      }
      this.frozenElements = batch
      this.frozenCount = frozen.length
    }
    const tailContext: MarkdownRenderContext = {
      streaming: true,
      labels: this.labels,
      fileMentions: undefined,
      pathImages: undefined,
      targets: frameTargets,
      footnoteOrder: [...this.frozenFootnoteOrder],
      footnoteCounts: new Map(this.frozenFootnoteCounts),
    }
    const children = [...this.frozenElements]
    for (const element of renderBlocks(tail, tailContext)) {
      if (children.length > 0) children.push('\n')
      children.push(element)
    }
    const section = renderFootnoteSection(tailContext)
    if (section !== null) children.push('\n', section)
    this.lastText = text
    this.lastRendered = children
    return this.lastRendered
  }
}
