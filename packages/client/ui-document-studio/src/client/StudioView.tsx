/**
 * Document studio view: the session's produced files (from the
 * `documentDeliverables` target) as a selectable list with an HTML/text
 * preview pane and open / show-in-folder / print actions. Pure presentation:
 * file facts arrive through the session snapshot, file bytes through the
 * injected host read callback, and user actions through injected callbacks.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { DocumentDeliverable } from './document-deliverables.ts'
import { DOCUMENT_DELIVERABLES_TARGET } from './document-deliverables.ts'
import css from './StudioView.module.css'

/** Studio view props: runtime session share + injected callbacks + locale. */
export type StudioViewProps =
  & ConvViewProps
  & InjectFace<StudioViewInjected>
  & PropsLocale<'documentStudio'>

/** Plain callbacks the apply-world inject supplies (paths are workspace-relative). */
export interface StudioViewInjected {
  /** Whether the browser reaches the host over a loopback authority. */
  isLoopback: boolean
  /** Reactive host facts; `canOpenPath` gates the folder action. */
  hooks: {
    hostDescription: HostDescriptionSource
  }
  /** Open one produced file with the OS default application. */
  openFile: (path: string) => Promise<void>
  /** Reveal one produced file in the OS file manager (only when supported). */
  showInFolder: (path: string) => Promise<void>
  /** Read one produced file's UTF-8 text (host-capped; `maxBytes` raises the budget for a full read). */
  readFileText: (path: string, maxBytes?: number) => Promise<{ content: string; truncated: boolean }>
}

/** The host's absolute read ceiling; a full print read may not exceed it. */
const PRINT_MAX_BYTES = 4 * 1024 * 1024

/** Stable empty list so the selector never allocates per snapshot. */
const EMPTY_PRODUCED: readonly DocumentDeliverable[] = []

/** Whether a produced path renders as an inline HTML frame. */
export function isHtmlPath(path: string): boolean {
  return /\.html?$/i.test(path)
}

/** Whether a produced path renders as plain text in the preview pane. */
export function isTextPreviewable(path: string): boolean {
  return isHtmlPath(path) || /\.(md|txt|json|ya?ml|csv|log)$/i.test(path)
}

function basename(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index === -1 ? path : path.slice(index + 1)
}

/** Outcome of one desktop print-to-PDF request (mirror of the preload bridge). */
export interface DesktopPrintResult {
  /** Saved file path on success. */
  path?: string
  /** The user dismissed the save dialog. */
  cancelled?: true
  /** Print, raster, or save failure message. */
  error?: string
}

/** The desktop shell's `window.desktop` surface, when running under Electron. */
export interface DesktopPrintBridge {
  printHtmlToPdf(payload: { html: string; suggestedName?: string }): Promise<DesktopPrintResult>
}

declare global {
  interface Window {
    /** Allow-listed Electron preload bridge; absent outside the desktop app. */
    desktop?: DesktopPrintBridge
  }
}

/** Print one HTML document through the browser's print dialog (PDF save). */
function printHtmlDocument(content: string): void {
  const win = window.open('', '_blank')
  if (win === null) return
  win.document.open()
  // document.write is the only way to print a complete standalone HTML
  // document from a popup window.
  // oxlint-disable-next-line typescript/no-deprecated
  win.document.write(content)
  win.document.close()
  win.focus()
  win.print()
}

/**
 * Renders the session deliverable list and preview pane.
 * @param props - session runtime share, injected callbacks, locale share.
 * @returns the studio view.
 */
export function StudioView({
  useSession,
  sessionId,
  isLoopback,
  useHostDescription,
  openFile,
  showInFolder,
  readFileText,
  t,
}: StudioViewProps): ReactNode {
  const produced = useSession(snapshot => snapshot.views.get(DOCUMENT_DELIVERABLES_TARGET)?.produced ?? EMPTY_PRODUCED)
  const hostCanOpenPath = useHostDescription(description => description?.canOpenPath === true)
  const canShowInFolder = isLoopback && hostCanOpenPath
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState<{ text: string; truncated: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Keep the selection on a produced file: drop stale selections, adopt the
  // first produced file when the list first gains entries.
  useEffect(() => {
    if (selectedPath !== null && produced.some(file => file.path === selectedPath)) return
    setSelectedPath(produced[0]?.path ?? null)
  }, [produced, selectedPath])

  // Load the selected file's text on selection change; only previewable
  // kinds read bytes at all.
  useEffect(() => {
    if (selectedPath === null || !isTextPreviewable(selectedPath)) {
      setContent(null)
      setError(null)
      return
    }
    let cancelled = false
    setContent(null)
    setError(null)
    readFileText(selectedPath).then(
      (result) => {
        if (cancelled) return
        setContent({ text: result.content, truncated: result.truncated })
      },
      (reason: unknown) => {
        if (cancelled) return
        setError(reason instanceof Error ? reason.message : String(reason))
      },
    )
    return () => { cancelled = true }
  }, [selectedPath, readFileText])

  const htmlPreview = useMemo(
    () => selectedPath !== null && isHtmlPath(selectedPath) ? content?.text ?? null : null,
    [selectedPath, content],
  )
  const textPreview = useMemo(
    () => selectedPath !== null && !isHtmlPath(selectedPath) ? content?.text ?? null : null,
    [selectedPath, content],
  )
  const selected = produced.find(file => file.path === selectedPath) ?? null
  const selectedName = selected === null ? '' : basename(selected.path)

  const [printOutcome, setPrintOutcome] = useState<{ saved: string } | { failed: string } | null>(null)
  const onPrint = async (): Promise<void> => {
    if (selectedPath === null || htmlPreview === null) return
    setPrintOutcome(null)
    // The preview read uses the host's default 1 MiB budget; re-read at the
    // full ceiling so the PDF is not silently the truncated head.
    let html = htmlPreview
    if (content?.truncated === true) {
      try {
        const full = await readFileText(selectedPath, PRINT_MAX_BYTES)
        if (full.truncated) {
          setPrintOutcome({ failed: t('studio.print.tooLarge') })
          return
        }
        html = full.content
      } catch (reason: unknown) {
        setPrintOutcome({ failed: reason instanceof Error ? reason.message : String(reason) })
        return
      }
    }
    if (window.desktop?.printHtmlToPdf !== undefined) {
      const result = await window.desktop.printHtmlToPdf({
        html,
        suggestedName: selectedName,
      })
      if (result.error !== undefined) setPrintOutcome({ failed: result.error })
      else if (result.cancelled !== true && result.path !== undefined) {
        setPrintOutcome({ saved: result.path })
      }
      return
    }
    printHtmlDocument(html)
  }

  return (
    <div className={css.studio} data-session-id={sessionId}>
      {produced.length === 0
        ? <p className={css.empty}>{t('studio.empty')}</p>
        : (
          <>
            <div className={css.listHeader}>
              <div className={css.files}>
                {produced.map(file => (
                  <button
                    key={file.path}
                    type="button"
                    className={`${css.file}${file.path === selectedPath ? ` ${css.fileActive}` : ''}`}
                    title={file.path}
                    onClick={() => { setSelectedPath(file.path) }}
                  >
                    <span className={css.fileName}>{basename(file.path)}</span>
                  </button>
                ))}
              </div>
              <span className={css.count}>{t('studio.files', { count: produced.length })}</span>
            </div>
            <div className={css.preview}>
              <div className={css.previewBar}>
                <span>{selectedName === '' ? t('studio.preview') : selectedName}</span>
                {selected !== null && (
                  <span className={css.actions}>
                    <button type="button" className={css.action} onClick={() => { void openFile(selected.path) }}>
                      {t('studio.action.open')}
                    </button>
                    {canShowInFolder && (
                      <button type="button" className={css.action} onClick={() => { void showInFolder(selected.path) }}>
                        {t('studio.action.folder')}
                      </button>
                    )}
                    {htmlPreview !== null && (
                      <button type="button" className={css.action} onClick={() => { void onPrint() }}>
                        {t('studio.action.print')}
                      </button>
                    )}
                    {printOutcome !== null && (
                      <span className={css.note}>
                        {'saved' in printOutcome
                          ? t('studio.print.exported', { path: printOutcome.saved })
                          : t('studio.print.failed', { message: printOutcome.failed })}
                      </span>
                    )}
                  </span>
                )}
              </div>
              {selectedPath === null || (!htmlPreview && textPreview === null && error === null)
                ? <div className={css.note}>{t('studio.preview.hint')}</div>
                : error !== null
                  ? <div className={css.error}>{t('studio.preview.error', { message: error })}</div>
                  : htmlPreview !== null
                    ? (
                      <iframe
                        className={css.frame}
                        title={selectedName}
                        sandbox=""
                        srcDoc={htmlPreview}
                      />
                    )
                    : textPreview !== null
                      ? (
                        <div className={css.textPreview}>
                          {textPreview}
                          {content?.truncated === true && (
                            <p className={css.note}>{t('studio.preview.truncated')}</p>
                          )}
                        </div>
                      )
                      : null}
            </div>
          </>
        )}
    </div>
  )
}
