/**
 * Publication state for one registry entry: the single creation announcement,
 * the listener dispatches that must still observe the entry, and removal
 * deferred to the last of them.
 *
 * A registry that publishes in two steps — insert an entry live, then announce
 * its creation — must keep that exact entry visible until the announcement
 * dispatch unwinds, because a creation listener may remove the entry while it
 * is still being called. Removing it immediately would delete it from under the
 * listeners that have not run yet; announcing it again is never correct. This
 * state machine defers removal to the last open dispatch, so no listener is
 * called for an entry that is already gone, and removal still follows the
 * creation a listener may have observed.
 *
 * Dispatches here are synchronous: a listener that returns a promise releases
 * the entry as soon as its synchronous call returns, exactly as Cordis' own
 * `emit` does.
 * @module @deepseek-ai/dsh-entry-lifecycle
 */

/**
 * Publication state and deferred removal for one exact registry entry.
 *
 * One instance tracks one entry for its whole lifetime: {@link announce} claims
 * the single creation edge, {@link beginDispatch}/{@link endDispatch} bracket any
 * further listener dispatch that must observe the entry (publishing the entry's
 * own content, for example), and {@link detachCapability} defers removal while a
 * dispatch is open. Everything else about the entry — its store membership, its
 * event carrier, and the disposal notification — stays with the owner.
 */
export class EntryLifecycle {
  private announced = false
  private announcementOpen = false
  private openDispatches = 0
  private removalRequested = false

  /**
   * Whether the creation edge was claimed, which {@link announce} does before
   * it dispatches.
   * @returns true from that claim until the entry is removed, including while
   *   the announcement dispatch is still open.
   */
  get isAnnounced(): boolean {
    return this.announced
  }

  /**
   * Whether a dispatch opened by {@link beginDispatch} is still in flight. A
   * caller whose own publication must not reenter reads this before opening one.
   * @returns true while at least one such dispatch has not been closed.
   */
  get hasOpenDispatch(): boolean {
    return this.openDispatches > 0
  }

  /**
   * Claim the single creation edge and open its announcement dispatch. The
   * owner dispatches after this returns, then closes the dispatch with
   * {@link endAnnouncement}.
   * @param subject - the entry under announcement in the caller's own
   *   vocabulary, for example `session "<id>"`; the rejection names it.
   * @throws if the creation edge was already claimed — including a reentrant
   *   call from a creation listener, since an entry is announced at most once.
   */
  announce(subject: string): void {
    if (this.announced) throw new Error(`${subject} was already announced`)
    // Claim before the owner dispatches: a listener cannot announce a second
    // time, and a removal that arrives mid-dispatch still pairs with this
    // creation rather than preceding it.
    this.announced = true
    this.announcementOpen = true
  }

  /**
   * Close the announcement dispatch opened by {@link announce}.
   * @returns whether the caller must remove the entry now — a removal was
   *   requested while the announcement was open and no dispatch remains.
   */
  endAnnouncement(): boolean {
    this.announcementOpen = false
    return this.consumeRemoval()
  }

  /** Open one listener dispatch that must still observe this entry. */
  beginDispatch(): void {
    this.openDispatches += 1
  }

  /**
   * Close one dispatch opened by {@link beginDispatch}. Callers pair every
   * `beginDispatch` with exactly one `endDispatch`.
   * @returns whether the caller must remove the entry now — a removal was
   *   requested while a dispatch was open and none remains.
   */
  endDispatch(): boolean {
    this.openDispatches -= 1
    return this.consumeRemoval()
  }

  /**
   * Wrap one removal as a single-shot capability that defers while the entry is
   * held live.
   * @param remove - the removal to run at most once, at a point where no
   *   dispatch holds this entry live.
   * @returns the capability to hand to whoever owns removal. Its first call runs
   *   `remove` immediately when nothing holds the entry live and otherwise
   *   records the request, which {@link endAnnouncement} or {@link endDispatch}
   *   then reports by returning true so the caller runs the same removal. Later
   *   calls do nothing.
   */
  detachCapability(remove: () => void): () => void {
    let live = true
    return () => {
      if (!live) return
      live = false
      if (this.announcementOpen || this.openDispatches > 0) {
        this.removalRequested = true
        return
      }
      remove()
    }
  }

  /**
   * Honor a requested removal once nothing holds the entry live.
   * @returns whether the caller must remove the entry now; a returned true
   *   consumes the pending request, so one request removes one entry.
   */
  private consumeRemoval(): boolean {
    if (!this.removalRequested || this.announcementOpen || this.openDispatches > 0) return false
    this.removalRequested = false
    return true
  }
}
