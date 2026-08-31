import css from './LoadFailure.module.css'

/**
 * Render a load-failure row with a retry control.
 * @param props.message - failure text; the owner passes localized copy (this
 * package is cordis-free, so copy arrives via props).
 * @param props.retryLabel - retry button text; localized copy via props.
 * @param props.onRetry - retry click handler.
 * @returns the failure row.
 */
export function LoadFailure({ message, retryLabel, onRetry }: {
  message: string
  retryLabel: string
  onRetry: () => void
}) {
  return (
    <div className={css.failure}>
      <p role="alert">{message}</p>
      <button type="button" onClick={onRetry}>{retryLabel}</button>
    </div>
  )
}
