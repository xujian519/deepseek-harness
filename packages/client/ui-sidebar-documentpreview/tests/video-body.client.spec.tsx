// @vitest-environment jsdom
/** Video body: versioned source URL, renderer revision reporting, and failure surfaces. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { VideoBody, videoSourceUrl, type VideoBodyProps } from '../src/client/video/VideoBody.tsx'
import { en } from '../src/client/video/locales.ts'

const t = makeTranslate(en)

/** One renderer-owned content request shared by a render. */
function request(revision = 1) {
  return { kind: 'renderer' as const, revision, loaded: vi.fn(), failed: vi.fn(), reload: vi.fn() }
}

/** A `file` resource observation; `undefined` value means no stat yet. */
function resource(value?: { absolutePath: string; version: string }, failure?: { code: string; message: string }) {
  return { status: failure === undefined ? 'live' : 'failed', value, failure } as never
}

function renderBody(options: {
  readonly content?: ReturnType<typeof request>
  readonly observation?: ReturnType<typeof resource>
} = {}) {
  const content = options.content ?? request()
  const observation = options.observation ?? resource({ absolutePath: '/work/video/ep01.mp4', version: 'v1' })
  const useResource = () => observation
  const props = {
    resourceAddress: 'dsh-resource://file/session/s/video/ep01.mp4',
    content,
    useResource,
    t,
    wrap: false,
  } as VideoBodyProps
  return { content, ...render(<VideoBody {...props} />) }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('video body', () => {
  it('names the current immutable version in the source URL', () => {
    expect(videoSourceUrl('http://127.0.0.1:3080/', '/work/ep 1.mp4', 'v1'))
      .toBe('http://127.0.0.1:3080/api/file?path=%2Fwork%2Fep%201.mp4&v=v1')
    expect(videoSourceUrl('about:blank', '/work/ep.mp4', 'v1')).toBeUndefined()
  })

  it('reports the rendered revision and plays the versioned file', () => {
    const { content } = renderBody()
    expect(content.loaded).toHaveBeenCalledWith('v1')
    expect(content.failed).not.toHaveBeenCalled()
    const video = screen.getByLabelText('Video preview: ep01.mp4') as HTMLVideoElement
    expect(video.tagName).toBe('VIDEO')
    expect(video.getAttribute('src')).toBe('http://localhost:3000/api/file?path=%2Fwork%2Fvideo%2Fep01.mp4&v=v1')
    expect(video.controls).toBe(true)
    expect(video.getAttribute('preload')).toBe('metadata')
  })

  it('reports once per revision and again after a reload revision', () => {
    const first = request(1)
    const { rerender, content } = renderBody({ content: first })
    const useResource = () => resource({ absolutePath: '/work/video/ep01.mp4', version: 'v1' })
    const props = (next: ReturnType<typeof request>) => ({
      resourceAddress: 'dsh-resource://file/session/s/video/ep01.mp4', content: next, useResource, t, wrap: false,
    } as VideoBodyProps)
    rerender(<VideoBody {...props(first)} />)
    expect(content.loaded).toHaveBeenCalledTimes(1)
    // A remount of the same revision and version reports nothing twice.
    const sameRevision = request(1)
    rerender(<VideoBody {...props(sameRevision)} />)
    expect(sameRevision.loaded).not.toHaveBeenCalled()
    const second = request(2)
    rerender(<VideoBody {...props(second)} />)
    expect(second.loaded).toHaveBeenCalledWith('v1')
  })

  it('waits for metadata, then reports a failed stat', () => {
    const content = request()
    const { rerender } = renderBody({ content, observation: resource() })
    expect(screen.getByText(en.loading)).toBeTruthy()
    expect(content.loaded).not.toHaveBeenCalled()
    const failed = { code: 'workspace-file/not-found', message: 'gone' }
    rerender(<VideoBody {...{
      resourceAddress: 'dsh-resource://file/session/s/video/ep01.mp4',
      content,
      useResource: () => resource(undefined, failed),
      t,
      wrap: false,
    } as VideoBodyProps} />)
    expect(screen.getByRole('alert').textContent).toBe(en.failed)
    expect(content.failed).toHaveBeenCalled()
  })

  it('surfaces a decode failure beside the player', () => {
    renderBody()
    fireEvent.error(screen.getByLabelText('Video preview: ep01.mp4'))
    expect(screen.getByRole('alert').textContent).toBe(en.failed)
  })

  it('renders without reporting when the owner supplies ordinary content', () => {
    const content = { kind: 'bytes' as const, data: new Uint8Array([1]) }
    const useResource = () => resource({ absolutePath: '/work/video/ep01.mp4', version: 'v1' })
    const props = {
      resourceAddress: 'dsh-resource://file/session/s/video/ep01.mp4', content, useResource, t, wrap: false,
    } as VideoBodyProps
    render(<VideoBody {...props} />)
    expect(screen.getByLabelText('Video preview: ep01.mp4')).toBeTruthy()
  })

  it('refuses a transport that cannot serve files', () => {
    vi.spyOn(Node.prototype, 'baseURI', 'get').mockReturnValue('about:blank')
    renderBody()
    expect(screen.getByRole('alert').textContent).toBe(en.unsupported)
  })
})
