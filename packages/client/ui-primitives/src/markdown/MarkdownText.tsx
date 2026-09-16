/**
 * Untrusted assistant-Markdown React surface over the `streaming-renderer.ts`
 * pipelines.
 */

import { memo, useEffect, useMemo, useReducer, useRef } from 'react'
import { renderSettled, StreamingRenderer } from './streaming-renderer.ts'
import type { MarkdownFileMentions, MarkdownLabels, MarkdownPathImages } from './render.tsx'
import 'katex/dist/katex.min.css'
import css from './MarkdownText.module.css'

export type { MarkdownCodeLabels, MarkdownFileMentions, MarkdownLabels, MarkdownPathImages } from './render.tsx'

/**
 * Render untrusted assistant-authored Markdown as semantic React elements.
 * @param props - Markdown source text preserved by the session projection;
 * `streaming` parses incrementally across chunks and highlights fences as
 * they grow (each fence re-tokenizes only appended text; TeX stays literal
 * until the finalize swap so incomplete formulae never flash errors), and a
 * reply whose open tail block grows past the frame budget shows the previous
 * frame until its cool-down elapses, then catches up through the retry timer
 * below without waiting for another chunk;
 * `labels` forwards localized fence and footnote chrome — pass a
 * reference-stable object (memoized per locale revision), because a new
 * identity discards the streaming render cache mid-message. `fileMentions`
 * links inline-code tokens its resolver recognizes as real files, and
 * `pathImages` rewrites image destinations that are local file paths into
 * displayable URLs its resolver vouches for; both vocabularies are the
 * single streaming gate — they apply to settled renders only, because a
 * streaming message's vocabulary is not final and frozen cached elements
 * must not bake in handlers that could go stale.
 * @returns A GFM document with TeX math rendered through KaTeX; raw HTML,
 * relative links, and unsafe protocols are disabled, while absolute HTTP(S)
 * images render directly.
 */
export const MarkdownText = memo(function MarkdownText({ text, streaming = false, labels, fileMentions, pathImages }: {
  text: string
  streaming?: boolean
  labels: MarkdownLabels
  fileMentions?: MarkdownFileMentions | undefined
  pathImages?: MarkdownPathImages | undefined
}) {
  const streamRef = useRef<StreamingRenderer | null>(null)
  const streamLabelsRef = useRef<MarkdownLabels>(labels)
  const [frameTick, retryFrame] = useReducer((tick: number): number => tick + 1, 0)
  const children = useMemo(() => {
    if (!streaming) {
      streamRef.current = null
      return renderSettled(text, labels, fileMentions, pathImages)
    }
    if (streamRef.current === null || streamLabelsRef.current !== labels) {
      streamRef.current = new StreamingRenderer(labels)
      streamLabelsRef.current = labels
    }
    return streamRef.current.render(text)
  }, [text, streaming, labels, fileMentions, pathImages, frameTick])
  // A frame the streaming renderer held back still has to land when the reply
  // pauses, so its cool-down is awaited here rather than left to the next chunk.
  useEffect(() => {
    const renderer = streamRef.current
    const delay = streaming && renderer !== null ? renderer.delayMs() : null
    if (delay === null) return
    const timer = setTimeout(retryFrame, delay)
    return () => { clearTimeout(timer) }
  })
  return <div className={css.markdown}>{children}</div>
})
