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
  /** Discriminator: absent/false marks the node-style writeHead/end face. */
  stream?: false
  handler: (req: DesktopHttpRequest, res: DesktopHttpResponse) => void | Promise<void>
}

/** One exact-path upgrade registration (held but not dispatchable portless). */
export interface DesktopUpgradeRoute {
  path: string
  handler: unknown
}

/** One streaming route: the handler returns a Fetch Response whose body is a
 *  `ReadableStream`, which the host dispatch forwards chunk by chunk. Live and
 *  push transports that get no WebSocket carrier on the custom protocol
 *  register here; the node-style `register` routes keep their writeHead/end
 *  face. */
export interface DesktopStreamingRoute {
  kind: 'exact' | 'prefix'
  path: string
  /** Discriminator separating Response-returning streaming routes from the
   *  node-style writeHead/end routes on `register`. */
  stream: true
  handler: (req: DesktopHttpRequest) => Response | Promise<Response>
}

/** One registered route, owning the full response lifecycle. */
export type DesktopAnyRoute = DesktopRoute | DesktopStreamingRoute

/** Adapt a Fetch Request into the node-style request face handlers read. */
function toDesktopRequest(request: Request): DesktopHttpRequest {
  const headers: Record<string, string> = {}
  for (const [name, value] of request.headers.entries()) headers[name] = value
  // A custom-scheme request carries no Host header (Chromium omits it), but the
  // node face route fences bind is the request authority: derive it from the URL.
  if (!('host' in headers)) headers.host = new URL(request.url).host
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
  private readonly exact = new Map<string, DesktopAnyRoute>()
  private readonly prefixes = new Map<string, DesktopAnyRoute>()
  private readonly upgrades = new Map<string, DesktopUpgradeRoute>()

  /** Insert a route into the exact or prefix table, enforcing path uniqueness. */
  private insertRoute(route: DesktopAnyRoute): () => void {
    const table = route.kind === 'exact' ? this.exact : this.prefixes
    if (table.has(route.path)) {
      throw new Error(`desktop webserver: duplicate ${route.kind} route "${route.path}"`)
    }
    table.set(route.path, route)
    return () => { table.delete(route.path) }
  }

  /** Register a named route; returns the disposer removing it. */
  register(route: DesktopRoute): () => void {
    return this.insertRoute(route)
  }

  /** Register a streaming route whose handler returns a Response with a
   *  `ReadableStream` body; returns the disposer removing it. A streaming
   *  route and a writeHead/end route may not share a path. The `stream`
   *  discriminator is forced true here so a consumer-side route object (which
   *  omits the compiler-only field) still dispatches as a stream. */
  registerStream(route: DesktopStreamingRoute): () => void {
    return this.insertRoute({ ...route, stream: true })
  }

  /** Register an exact-path upgrade route; returns the disposer removing it. */
  registerUpgrade(route: DesktopUpgradeRoute): () => void {
    if (this.upgrades.has(route.path)) {
      throw new Error(`desktop webserver: duplicate upgrade route "${route.path}"`)
    }
    this.upgrades.set(route.path, route)
    return () => { this.upgrades.delete(route.path) }
  }

  /**
   * The route owning one pathname: an exact-table hit wins, then the longest
   * prefix. The host dispatch reads it to choose between the portless surface
   * and the paths it serves itself (`/api`, the packaged assets).
   * @param pathname - decoded request pathname.
   * @returns the owning route, or undefined when no route matches.
   */
  match(pathname: string): DesktopAnyRoute | undefined {
    const exact = this.exact.get(pathname)
    if (exact !== undefined) return exact
    let best: DesktopAnyRoute | undefined
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
   * A streaming route returns its own Response (whose body the host dispatch
   * forwards chunk by chunk); a writeHead/end route is collected into one.
   */
  async dispatch(request: Request): Promise<Response | null> {
    const pathname = new URL(request.url).pathname
    const route = this.match(pathname)
    if (route === undefined) return null
    const req = toDesktopRequest(request)
    if (route.stream === true) return await route.handler(req)
    const res = responseCollector()
    await route.handler(req, res)
    return res.toResponse()
  }
}
