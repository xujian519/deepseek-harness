/**
 * Shared window-level drag teardown: the tab strip (TabBar) and the pane
 * drop overlay (LeafView) both clear transient drag state on the window's
 * `dragend` / `drop` (capture phase, so a drag stopped inside a child still
 * settles) and on `blur` (a drag dies with the window).
 */
import { useEffect, useRef } from 'react'

/**
 * Subscribe once to the window-level drag-end events, calling `clear` on
 * each. The latest callback wins; the subscription never re-attaches.
 * @param clear - drag-clear callback invoked for every window-level drag end.
 */
export function useWindowDragClear(clear: () => void): void {
  const clearRef = useRef(clear)
  useEffect(() => { clearRef.current = clear })
  useEffect(() => {
    const handler = (): void => { clearRef.current() }
    window.addEventListener('dragend', handler, true)
    window.addEventListener('drop', handler, true)
    window.addEventListener('blur', handler)
    return () => {
      window.removeEventListener('dragend', handler, true)
      window.removeEventListener('drop', handler, true)
      window.removeEventListener('blur', handler)
    }
  }, [])
}
