/**
 * The three incremental folds a {@link Session} serves: the request header in
 * force, the latest resolved route metadata, and the derived LLM message
 * history. Each consumes the session's event log by reference and remembers
 * how far it has read, so a read costs O(new events).
 *
 * Browser-safe: web clients consume the session surface, so this module must
 * stay free of `node:` imports (they break the vite bundle).
 *
 * @module @deepseek-ai/dsh-session/folds
 */

import type { Message } from '@deepseek-ai/dsh-llm'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { EpochHeader, RequestContext, SessionEvent } from './types.ts'
import { foldRequestHeader } from './request-header.ts'
import { deriveEventMessage } from './surface.ts'
import type { SessionSurface } from './surface.ts'

/** Cache state for the request header, the request context, and the derived messages. */
export class SessionFolds {
  /** Cached fold of the request-header events — see {@link requestHeader}. */
  private headerFold: EpochHeader | undefined
  /** Log position (events consumed) the header fold has reached. */
  private headerFoldSeq = 0
  /** Cached fold of `request/context` events. */
  private contextFold: RequestContext | undefined
  /** Log position (events consumed) the context fold has reached. */
  private contextFoldSeq = 0
  /** The derived-message cache: frozen projections, extended per unseen node. */
  private derived: Message[] = []
  /** Surface position (nodes projected) the cache has reached. */
  private derivedNodes = 0
  /** {@link SessionSurface.replaceGeneration} the cache was built under. */
  private derivedGeneration = 0

  /**
   * @param log - the session's live event log; appends by its owner are visible here.
   * @param surface - the ordered surface over that same log.
   */
  constructor(
    private readonly log: readonly SessionEvent[],
    private readonly surface: SessionSurface,
  ) {}

  /**
   * The {@link EpochHeader} in force after the log's last header event — the
   * header the NEXT request will be compared against — or undefined before
   * the first `request/header` snapshot. The live, incrementally-maintained
   * form of `foldRequestHeader(session.snapshotEvents())`: each header event is folded
   * once, when first seen, so a per-step read costs O(new events).
   * @returns the folded header, or undefined when no header event exists yet.
   */
  requestHeader(): EpochHeader | undefined {
    if (this.headerFoldSeq < this.log.length) {
      // Frozen on update: the fold is session state exposed by reference — a
      // consumer mutating it in place (instead of building a replacement)
      // would desync every later comparison against the log, so mutation
      // throws instead.
      this.headerFold = deepFreeze(foldRequestHeader(this.log.slice(this.headerFoldSeq), this.headerFold))
      this.headerFoldSeq = this.log.length
    }
    return this.headerFold
  }

  /**
   * Return the latest resolved route metadata, or `undefined` before the first
   * `request/context` event. Each event is folded once.
   * @returns the latest immutable route metadata.
   */
  requestContext(): RequestContext | undefined {
    if (this.contextFoldSeq < this.log.length) {
      for (const event of this.log.slice(this.contextFoldSeq)) {
        if (event.type === 'request/context') this.contextFold = deepFreeze({ ...event.data })
      }
      this.contextFoldSeq = this.log.length
    }
    return this.contextFold
  }

  /**
   * Derive the LLM message history by walking the ordered sequences of
   * message-producing events maintained by `surfaceOp` markers. The
   * surface is the single source of derived history: every message-producing
   * append records its `surfaceOp`, so a raw event with no marker (a chunk, a
   * turn boundary) is correctly absent, and a compaction `replace` deletes the
   * shadowed nodes from the derivation. The projection rules are
   * {@link deriveEventMessage}, folded per node.
   *
   * CACHED: each surface node is projected exactly once, when first seen — a
   * call costs O(new nodes), and a surface rewrite (a `replace`;
   * {@link SessionSurface.replaceGeneration}) rebuilds. The returned array is
   * a fresh snapshot per call (later appends never grow an array a caller
   * already holds); the `Message` objects in it are SHARED and **deep-frozen**.
   * Their content reuses the already frozen durable event data, so the cache
   * needs no second deep clone and consumers still cannot mutate the log.
   * @returns a fresh array of the shared, frozen derived history.
   */
  deriveMessages(): Message[] {
    const surface = this.surface
    const nodes = surface.nodes
    const generation = surface.replaceGeneration
    if (generation !== this.derivedGeneration) {
      this.derived = []
      this.derivedNodes = 0
      this.derivedGeneration = generation
    }
    for (const seq of nodes.slice(this.derivedNodes)) {
      // Surface sequences are built from this.log — seq is always a valid
      // index by construction. The non-null assertion expresses that invariant.
      // oxlint-disable-next-line typescript/no-non-null-assertion
      const msg = deriveEventMessage(this.log[seq]!)
      // A surface node is one of the five message-producing types, but an
      // empty-content assistant/message (a max-tokens step that hosts only
      // usage) derives to null and must not enter the transcript.
      if (msg) this.derived.push(msg)
    }
    this.derivedNodes = nodes.length
    return [...this.derived]
  }
}
