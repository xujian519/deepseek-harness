/**
 * Video production board: the session's discovered projects, their shots,
 * renders, pending tasks, and the CNY ledger, with a media preview. Facts
 * arrive through the conversation snapshot (discovery) and the injected Host
 * reads (project files); user actions arrive as injected callbacks.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { pathPartsOf } from '@deepseek-ai/dsh-util-workspace-path'
import { VIDEO_PROJECTS_TARGET } from './video-projects.ts'
import { StudioReadError, type StudioMedia, type StudioProject, type StudioShot } from './project-reads.ts'
import css from './StudioView.module.css'

/** Board props: runtime session share + injected reads/actions + locale. */
export type VideoStudioProps =
  & ConvViewProps
  & InjectFace<VideoStudioInjected>
  & PropsLocale<'videoStudio'>

/** Callbacks and facts the apply world supplies. */
export interface VideoStudioInjected {
  /** Read one project with its ledger, journal, and media metadata. */
  loadProject: (path: string, signal: AbortSignal) => Promise<StudioProject | undefined>
  /** Build the authenticated file URL for one media version. */
  mediaUrl: (absolutePath: string, version: string) => string | undefined
  /** Whether the sidebar preview surface is composed. */
  canOpenInSidebar: boolean
  /** Hand one file to the sidebar preview; false when the surface disappeared. */
  openInSidebar: (path: string) => boolean
  /** Open one file with the OS default application. */
  openFile: (path: string) => Promise<void>
  /** Reveal one file in the OS file manager (loopback desktop only). */
  showInFolder: (path: string) => Promise<void>
  /** Whether the browser reaches the host over a loopback authority. */
  isLoopback: boolean
}

const EMPTY_PROJECTS: readonly string[] = []

/** CNY amount with two decimals, as the project and ledger store it. */
function money(value: number): string {
  return value.toFixed(2)
}

/** A stored ISO instant as a readable minute, falling back to the raw value. */
function stampOf(value: string): string {
  return value.length >= 16 ? value.slice(0, 16).replace('T', ' ') : value
}

/** Localized failure line for one read. */
function readFailureText(error: StudioReadError, t: VideoStudioProps['t']): string {
  switch (error.code) {
    case 'missing': return t('studio.error.missing')
    case 'invalid': return t('studio.error.invalid')
    case 'read': return t('studio.error.read', { message: error.message })
  }
}

/** Localized shot-state label. */
function statusText(shot: StudioShot, t: VideoStudioProps['t']): string {
  switch (shot.status) {
    case 'draft': return t('studio.shot.status.draft')
    case 'ready': return t('studio.shot.status.ready')
    case 'generating': return t('studio.shot.status.generating')
    case 'failed': return t('studio.shot.status.failed')
  }
}

/** Localized pending-task state label. */
function taskStatusText(status: 'queued' | 'submitted' | 'running', t: VideoStudioProps['t']): string {
  switch (status) {
    case 'queued': return t('studio.tasks.status.queued')
    case 'submitted': return t('studio.tasks.status.submitted')
    case 'running': return t('studio.tasks.status.running')
  }
}

/**
 * Render the production board.
 * @param props - conversation snapshot, injected reads/actions, and locale.
 * @returns the studio, its empty state, or the selected project's failure.
 */
export function StudioView({
  useConversation, loadProject, mediaUrl, canOpenInSidebar, openInSidebar,
  openFile, showInFolder, isLoopback, t,
}: VideoStudioProps): ReactNode {
  const snapshot = useConversation(state => state.views.get(VIDEO_PROJECTS_TARGET))
  const projects = snapshot?.projects ?? EMPTY_PROJECTS
  const revision = snapshot?.revision ?? 0
  const [picked, setPicked] = useState<string>()
  const [nonce, setNonce] = useState(0)
  const [data, setData] = useState<StudioProject>()
  const [failure, setFailure] = useState<StudioReadError>()
  const [loading, setLoading] = useState(false)
  const [pickedMedia, setPickedMedia] = useState<string>()
  const [actionFailure, setActionFailure] = useState<string>()
  const activePath = picked !== undefined && projects.includes(picked) ? picked : projects[0]

  useEffect(() => {
    if (activePath === undefined) {
      setData(undefined)
      setFailure(undefined)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setFailure(undefined)
    loadProject(activePath, controller.signal).then((project) => {
      if (controller.signal.aborted) return
      setData(project)
      setFailure(project === undefined ? new StudioReadError('project file is missing', 'missing') : undefined)
      setLoading(false)
    }, (error: unknown) => {
      if (controller.signal.aborted) return
      setData(undefined)
      setFailure(error instanceof StudioReadError
        ? error
        : new StudioReadError(error instanceof Error ? error.message : String(error), 'read'))
      setLoading(false)
    })
    return () => { controller.abort() }
  }, [activePath, revision, nonce, loadProject])

  // A selection survives a read only while the new document still offers it.
  const media = useMemo(() => data?.media.find(entry => entry.path === pickedMedia)
    ?? data?.media.find(entry => entry.kind === 'video')
    ?? data?.media[0], [data, pickedMedia])

  const report = (error: unknown): void => {
    setActionFailure(error instanceof Error ? error.message : String(error))
  }
  const run = (action: () => Promise<void>): void => {
    setActionFailure(undefined)
    action().catch(report)
  }
  const refresh = (): void => { setNonce(value => value + 1) }

  if (projects.length === 0) {
    return <section className={css.studio} aria-label={t('studio.aria')} data-video-studio-empty>
      <div className={css.empty}>
        <h2 className={css.emptyTitle}>{t('studio.empty.title')}</h2>
        <p className={css.emptyHint}>{t('studio.empty.hint')}</p>
      </div>
    </section>
  }

  return <section className={css.studio} aria-label={t('studio.aria')} data-video-studio>
    <header className={css.header}>
      <div className={css.heading}>
        <h2 className={css.title}>{data?.title ?? t('view.video')}</h2>
        {data !== undefined && <p className={css.meta}>
          <span>{t('studio.aspect', { aspect: data.aspect })}</span>
          <span>{t('studio.target', { seconds: String(data.targetSeconds) })}</span>
          <span>{t('studio.updated', { time: stampOf(data.updatedAt) })}</span>
        </p>}
      </div>
      <div className={css.headerActions}>
        {projects.length > 1 && <select
          className={css.select}
          aria-label={t('studio.project.label')}
          value={activePath}
          onChange={(event) => { setPicked(event.target.value); setPickedMedia(undefined) }}
        >
          {projects.map(path => <option key={path} value={path}>{pathPartsOf(path).name}</option>)}
        </select>}
        <Button size="sm" onClick={refresh} data-video-studio-refresh>{t('studio.action.refresh')}</Button>
      </div>
    </header>

    {data !== undefined && <div className={css.budget} data-video-studio-budget>
      <span className={css.budgetLabel}>{t('studio.budget.label')}</span>
      <div className={css.bar} aria-hidden="true">
        <div
          className={data.spentCny > data.budgetCny ? `${css.fill} ${css.overFill}` : css.fill}
          style={{ width: `${Math.min(100, data.budgetCny === 0 ? 100 : data.spentCny / data.budgetCny * 100)}%` }}
        />
      </div>
      <span className={css.budgetValue}>
        {t('studio.budget.value', { spent: money(data.spentCny), budget: money(data.budgetCny) })}
      </span>
      {data.spentCny > data.budgetCny && <span className={css.over}>{t('studio.budget.over')}</span>}
    </div>}

    {loading && data === undefined && <p className={css.status} role="status">{t('studio.loading')}</p>}
    {failure !== undefined && <p className={css.status} role="alert" data-video-studio-error>{readFailureText(failure, t)}</p>}

    {data !== undefined && !failure && <div className={css.columns} data-video-studio-columns>
      <div className={css.lists}>
        <section className={css.section} aria-label={t('studio.shots.title')}>
          <h3 className={css.sectionTitle}>{t('studio.shots.title')}</h3>
          {data.shots.length === 0
            ? <p className={css.note}>{t('studio.shots.empty')}</p>
            : <ul className={css.rows}>
              {data.shots.map(shot => <li key={shot.id}>
                <button
                  type="button"
                  className={css.row}
                  data-shot-id={shot.id}
                  onClick={() => { setPickedMedia(shot.clipPath ?? shot.keyframePath) }}
                  disabled={shot.clipPath === undefined && shot.keyframePath === undefined}
                >
                  <span className={css.index}>{String(shot.index).padStart(2, '0')}</span>
                  <span className={css.rowBody}>
                    <span className={css.prompt}>{shot.prompt}</span>
                    <span className={css.badges}>
                      <span className={`${css.badge} ${css[`badge_${shot.status}`]}`}>{statusText(shot, t)}</span>
                      <span>{t('studio.shot.duration', { seconds: String(shot.durationSec) })}</span>
                      {shot.costCny !== undefined && <span>{t('studio.shot.cost', { amount: money(shot.costCny) })}</span>}
                      {shot.clipPath !== undefined && <span className={css.muted}>{t('studio.shot.clip')}</span>}
                      {shot.keyframePath !== undefined && <span className={css.muted}>{t('studio.shot.keyframe')}</span>}
                    </span>
                  </span>
                </button>
              </li>)}
            </ul>}
        </section>

        <section className={css.section} aria-label={t('studio.renders.title')}>
          <h3 className={css.sectionTitle}>{t('studio.renders.title')}</h3>
          {data.renders.length === 0
            ? <p className={css.note}>{t('studio.renders.empty')}</p>
            : <ul className={css.rows}>
              {data.renders.map(render => <li key={render.id}>
                <button
                  type="button"
                  className={css.row}
                  data-render-id={render.id}
                  onClick={() => { setPickedMedia(render.path) }}
                >
                  <span className={css.rowBody}>
                    <span className={css.prompt}>{pathPartsOf(render.path).name}</span>
                    <span className={css.badges}>
                      <span>{t('studio.render.created', { date: stampOf(render.createdAt) })}</span>
                      {render.durationSec !== undefined && <span>{t('studio.shot.duration', { seconds: String(render.durationSec) })}</span>}
                      {render.costCny !== undefined && <span>{t('studio.render.cost', { amount: money(render.costCny) })}</span>}
                    </span>
                  </span>
                </button>
              </li>)}
            </ul>}
        </section>

        <section className={css.section} aria-label={t('studio.tasks.title')}>
          <h3 className={css.sectionTitle}>{t('studio.tasks.title')}</h3>
          {data.tasks.length === 0
            ? <p className={css.note}>{t('studio.tasks.empty')}</p>
            : <ul className={css.rows}>
              {data.tasks.map(task => <li key={task.id} className={css.task}>
                <span className={css.prompt}>{t('studio.tasks.item', {
                  kind: task.kind,
                  model: task.model,
                  status: taskStatusText(task.status, t),
                })}</span>
                <span className={css.muted}>{task.outputPath}</span>
              </li>)}
            </ul>}
        </section>
      </div>

      <aside className={css.preview} aria-label={t('studio.preview.title')} data-video-studio-preview>
        <h3 className={css.sectionTitle}>{t('studio.preview.title')}</h3>
        {media === undefined
          ? <p className={css.note}>{t('studio.preview.empty')}</p>
          : <PreviewMedia media={media} mediaUrl={mediaUrl} t={t} />}
        {media !== undefined && <p className={css.path}>{media.path}</p>}
        {media?.absolutePath !== undefined && <div className={css.previewActions}>
          {canOpenInSidebar && <Button size="sm" onClick={() => {
            setActionFailure(undefined)
            if (!openInSidebar(media.path)) setActionFailure(t('studio.action.unavailable'))
          }}>{t('studio.action.openSidebar')}</Button>}
          <Button size="sm" onClick={() => { run(() => openFile(media.path)) }}>{t('studio.action.openFile')}</Button>
          {isLoopback && <Button size="sm" onClick={() => { run(() => showInFolder(media.path)) }}>
            {t('studio.action.reveal')}
          </Button>}
        </div>}
        {actionFailure !== undefined && <p className={css.status} role="alert">
          {t('studio.action.failed', { message: actionFailure })}
        </p>}
      </aside>
    </div>}
  </section>
}

function PreviewMedia({ media, mediaUrl, t }: {
  readonly media: StudioMedia
  readonly mediaUrl: VideoStudioInjected['mediaUrl']
  readonly t: VideoStudioProps['t']
}): ReactNode {
  const url = media.absolutePath === undefined || media.version === undefined
    ? undefined
    : mediaUrl(media.absolutePath, media.version)
  if (url === undefined) return <p className={css.note} data-video-studio-missing>{t('studio.preview.missing')}</p>
  const name = pathPartsOf(media.path).name
  return media.kind === 'image'
    ? <img className={css.image} src={url} alt={t('studio.media.alt', { name })} data-video-studio-image />
    : <div className={css.frame} data-video-studio-video>
      <video className={css.video} src={url} controls playsInline preload="metadata" aria-label={name} />
    </div>
}
