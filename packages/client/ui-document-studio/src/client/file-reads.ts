/**
 * Produced-file text reads over the session-scoped `workspaceFiles` Remote.
 *
 * The preview takes one bounded byte window: `readBytes` refuses a window wider
 * than the Host's configured cap and never fails for a large file, which is what
 * previewing a just-printed deliverable needs. Print takes the complete file
 * through `readAll`, which refuses a file above the Host's full-file cap instead
 * of returning a silently cut head. Both caps are the Host's `Config`, so this
 * plugin names neither.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceByteRange, WorkspaceFileBytes } from '@deepseek-ai/dsh-api-workspace-files/types'

/** One read's text and whether it is the file's complete text. */
export interface ReadFileText {
  /** UTF-8 text of the read window, or of the complete file. */
  readonly content: string
  /** Whether the read stopped short of the file's end: a window cut, or a refused complete read. */
  readonly truncated: boolean
}

/** The slice of the Client Remote these reads call. */
export interface WorkspaceFilesRemote {
  /**
   * Read one byte window of a workspace file.
   * @param sessionId - the session whose workspace resolves `path`.
   * @param path - workspace path, absolute or relative to the workspace root.
   * @param range - the window; an absent `length` means the Host's configured cap.
   * @param signal - cancels the call.
   * @returns the window, or the failure the Host declares.
   */
  readBytes(
    sessionId: SessionId,
    path: string,
    range: WorkspaceByteRange,
    signal?: AbortSignal,
  ): Promise<RemoteResult<WorkspaceFileBytes>>
  /**
   * Read the complete bytes of a workspace file.
   * @param sessionId - the session whose workspace resolves `path`.
   * @param path - workspace path, absolute or relative to the workspace root.
   * @param signal - cancels the call.
   * @returns the complete bytes, or the failure the Host declares.
   */
  readAll(
    sessionId: SessionId,
    path: string,
    signal?: AbortSignal,
  ): Promise<RemoteResult<WorkspaceFileBytes>>
}

/** The produced-file reads the studio view calls, with paths resolved against the Session workspace. */
export interface FileReads {
  /**
   * Read the bounded head of one produced file.
   * @param path - produced-file path as the deliverables reported it.
   * @returns the window's text, `truncated` when it stops short of the file's end.
   */
  readonly readFileText: (path: string) => Promise<ReadFileText>
  /**
   * Read one produced file completely.
   * @param path - produced-file path as the deliverables reported it.
   * @returns the complete text; `truncated` carries the Host's full-file cap refusal.
   */
  readonly readFileTextComplete: (path: string) => Promise<ReadFileText>
}

/**
 * Byte length of the UTF-8 sequence one byte leads.
 * @param lead - a byte that is not a continuation byte.
 * @returns the sequence's length in bytes; `0` when the byte leads no valid sequence.
 */
function sequenceBytes(lead: number): number {
  if ((lead & 0x80) === 0) return 1
  if ((lead & 0xe0) === 0xc0) return 2
  if ((lead & 0xf0) === 0xe0) return 3
  if ((lead & 0xf8) === 0xf0) return 4
  return 0
}

/**
 * Decode one byte window as UTF-8 text.
 *
 * The Host's byte window is raw by design (no decoding, no binary rejection), so
 * the text contract lives here: a character the window cut in half is dropped
 * whole rather than decoding to replacement glyphs, and invalid UTF-8 throws
 * rather than decoding to them.
 * @param window - the Host's byte window.
 * @returns the decoded text and whether the window is the complete file.
 */
export function decodeByteWindow(window: WorkspaceFileBytes): ReadFileText {
  const binary = atob(window.data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  let end = bytes.length
  if (!window.eof) {
    // The window is a prefix cut at a byte boundary, so only its final sequence
    // can be incomplete; a UTF-8 sequence is at most four bytes long.
    for (let back = 1; back <= 4 && back <= end; back += 1) {
      const lead = bytes[end - back]
      if (lead === undefined || (lead & 0xc0) === 0x80) continue
      if (sequenceBytes(lead) > back) end -= back
      break
    }
  }
  return {
    content: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end)),
    truncated: !window.eof,
  }
}

/**
 * Bind the produced-file reads to one Client Remote face.
 * @param remote - the Client Remote carrying the `workspaceFiles` namespace.
 * @param sessionId - the Session whose workspace resolves every path.
 * @param resolve - maps a produced-file path to the path the Host receives.
 * @returns the reads the studio view calls.
 */
export function createFileReads(
  remote: WorkspaceFilesRemote,
  sessionId: SessionId,
  resolve: (path: string) => string,
): FileReads {
  const decode = (path: string, window: WorkspaceFileBytes): ReadFileText => {
    try {
      return decodeByteWindow(window)
    } catch {
      // A raw byte window's one decode failure is undecodable text; the view
      // renders this message verbatim.
      throw new Error(`not valid UTF-8: ${path}`)
    }
  }
  return {
    readFileText: async (path: string): Promise<ReadFileText> => {
      const result = await remote.readBytes(sessionId, resolve(path), {})
      if (!result.ok) throw new Error(result.error.message)
      return decode(path, result.value)
    },
    readFileTextComplete: async (path: string): Promise<ReadFileText> => {
      const result = await remote.readAll(sessionId, resolve(path))
      if (result.ok) return decode(path, result.value)
      // Above the Host's full-file cap the complete read is refused, which is
      // the studio's too-large state rather than an error line.
      if (result.error.code === 'workspace-file/too-large') return { content: '', truncated: true }
      throw new Error(result.error.message)
    },
  }
}
