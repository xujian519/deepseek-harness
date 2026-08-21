/**
 * Browser automation backend contract for the model-facing download tools.
 *
 * The abstraction covers capability probing and capability bits only — not
 * script execution: ego's transparent-script mode and MCP atomic-tool mode
 * conflict at the execution layer, so downstream tools decide how to run a
 * task from the backend id and bits. Backend selection is a cold decision:
 * resolve once before a task starts, never switch mid-task.
 * @module @deepseek-ai/dsh-browser-backend
 */

/** Backend id; also fixes the cascade order (see buildBackendCandidates). */
export type BrowserBackendId = 'ego' | 'browseros-neo' | 'browser-use' | 'playwright'

/**
 * Capability bits a downstream tool (e.g. patent_pdf_download) reads to decide
 * whether this backend can safely take a task.
 */
export type BrowserCapabilities = {
  /** Download interception (ego page.waitForEvent('download') equivalent). */
  downloadInterception: boolean
  /** Screencast for evidence (ego page.screencast equivalent). */
  screencast: boolean
  /** Human handoff (ego handOffTaskSpace/takeOverTaskSpace equivalent). */
  handoff: boolean
  /** Site experience packs (ego site.runTool equivalent). */
  siteTools: boolean
  /** Inherited login state (real Chrome profile / signed-in session). */
  loginState: boolean
  /** Anti-bot posture (real browser fingerprint, not clean automation Chromium). */
  antiBot: boolean
}

/** Probe verdict. */
export type BackendProbeStatus = 'ok' | 'warn' | 'missing'

/** One backend probe result. */
export type BrowserBackendProbe = {
  status: BackendProbeStatus
  detail: string
  installHint?: string
}

/** A probeable browser backend. */
export interface BrowserBackend {
  readonly id: BrowserBackendId
  readonly label: string
  /**
   * Platform-level and install-level availability. Contract: no browser spawn
   * (unless the caller opted into a connection probe), single call ≤5s,
   * read-only.
   */
  probe(): BrowserBackendProbe | Promise<BrowserBackendProbe>
  readonly capabilities: BrowserCapabilities
}
