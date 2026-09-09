/**
 * Portless HTTP surface for the desktop host. The browser profile serves the
 * sidebar through `ctx.webServer`, a listening socket whose route handlers read
 * a node IncomingMessage and write a ServerResponse. The desktop host has no
 * socket: its renderer reaches `dsh-app://app` and the host's fetch dispatch
 * carries each request. This module re-hosts the same route-registration face
 * behind that dispatch, adapting the byte-pipe Fetch `Request`/`Response` to
 * the node-style request/response pair the handlers already use.
 *
 * It serves no static files and owns no sessions; the host dispatch consults it
 * for the paths the composition's plugins claim, falling through to the
 * packaged-asset handler when nothing matches. WebSocket upgrades have no
 * carrier on a custom protocol, so `registerUpgrade` holds a route that cannot
 * dispatch here; the push transport is a separate seam.
 */

/** Route match kind — 'exact' matches the pathname verbatim, 'prefix' matches p and p/<anything>. */
export type DesktopRouteKind = 'exact' | 'prefix'

/** The request face route handlers read (subset of node IncomingMessage). */
export interface DesktopHttpRequest {
  url?: string
  method?: string
  headers: Record<string, string | string[] | undefined>
  [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array>
}

/** The response face route handlers write (subset of node ServerResponse). */
export interface DesktopHttpResponse {
  statusCode: number
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string | Uint8Array): void
}

/** One registered route, owning the full response lifecycle. */
export interface DesktopRoute {
  kind: DesktopRouteKind
  path: string
  handler: (req: DesktopHttpRequest, res: DesktopHttpResponse) => void | Promise<void>
}

/** One exact-path upgrade registration (held but not dispatchable portless). */
export interface DesktopUpgradeRoute {
  path: string
  handler: unknown
}

/** Adapt a Fetch Request into the node-style request face handlers read. */
function toDesktopRequest(request: Request): DesktopHttpRequest {
  const headers: Record<string, string> = {}
  for (const [name, value] of request.headers.entries()) headers[name] = value
  return {
    url: request.url,
    method: request.method,
    headers,
    async *[Symbol.asyncIterator]() {
      if (request.body === null) return
      const reader = request.body.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) return
          yield value
        }
      } finally {
        reader.releaseLock()
      }
    },
  }
}

/** Collect the handler's writes into a Fetch Response. */
function responseCollector(): DesktopHttpResponse & { toResponse(): Response } {
  const state = { statusCode: 200, headers: {} as Record<string, string>, body: undefined as string | Uint8Array | undefined }
  const res: DesktopHttpResponse = {
    get statusCode() { return state.statusCode },
    set statusCode(status: number) { state.statusCode = status },
    writeHead(status, headers) {
      state.statusCode = status
      if (headers !== undefined) Object.assign(state.headers, headers)
    },
    end(body) {
      if (body !== undefined) state.body = body
    },
  }
  const toResponse = (): Response => {
    const init: ResponseInit = { status: state.statusCode, headers: state.headers }
    return state.body === undefined
      ? new Response(null, init)
      : new Response(state.body as BodyInit, init)
  }
  return Object.assign(res, { toResponse })
}

/**
 * The route registry for the desktop host's portless HTTP surface. Registered
 * route patterns are distinct; a collision is a composition misconfiguration.
 */
export class PortlessWebServer {
  private readonly exact = new Map<string, DesktopRoute>()
  private readonly prefixes = new Map<string, DesktopRoute>()
  private readonly upgrades = new Map<string, DesktopUpgradeRoute>()

  /** Register a named route; returns the disposer removing it. */
  register(route: DesktopRoute): () => void {
    const table = route.kind === 'exact' ? this.exact : this.prefixes
    if (table.has(route.path)) {
      throw new Error(`desktop webserver: duplicate ${route.kind} route "${route.path}"`)
    }
    table.set(route.path, route)
    return () => { table.delete(route.path) }
  }

  /** Register an exact-path upgrade route; returns the disposer removing it. */
  registerUpgrade(route: DesktopUpgradeRoute): () => void {
    if (this.upgrades.has(route.path)) {
      throw new Error(`desktop webserver: duplicate upgrade route "${route.path}"`)
    }
    this.upgrades.set(route.path, route)
    return () => { this.upgrades.delete(route.path) }
  }

  /** Longest-prefix-wins over the prefix table after an exact-table miss. */
  private match(pathname: string): DesktopRoute | undefined {
    const exact = this.exact.get(pathname)
    if (exact !== undefined) return exact
    let best: DesktopRoute | undefined
    for (const [prefix, route] of this.prefixes) {
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue
      if (best === undefined || prefix.length > best.path.length) best = route
    }
    return best
  }

  /**
   * Serve one custom-protocol request from the route table.
   * @param request - the Fetch request carried over the byte pipe.
   * @returns the route's Response, or null when no route matches the pathname.
   */
  async dispatch(request: Request): Promise<Response | null> {
    const pathname = new URL(request.url).pathname
    const route = this.match(pathname)
    if (route === undefined) return null
    const res = responseCollector()
    await route.handler(toDesktopRequest(request), res)
    return res.toResponse()
  }
}
