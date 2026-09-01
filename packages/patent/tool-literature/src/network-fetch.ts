/** 网络层错误码（DNS/超时/连接/TLS/代理/限速/中止等）。 */
export type NetworkErrorCode =
  | 'network_timeout'
  | 'network_dns_error'
  | 'network_connection_reset'
  | 'network_connection_refused'
  | 'network_tls_error'
  | 'network_proxy_error'
  | 'network_rate_limited'
  | 'network_server_error'
  | 'network_abort'
  | 'network_fetch_failed'

/** 网络层错误：携带稳定机器可读错误码的 Error 子类。 */
export class NetworkFetchError extends Error {
  readonly name = 'NetworkFetchError'

  constructor(
    readonly code: NetworkErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
  }
}

/** 重试配置（次数、退避间隔、可重试状态码等）。 */
export type NetworkRetryOptions = {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  retryOnPost?: boolean
  retryStatuses?: readonly number[]
}

/** networkFetch 单次请求选项（超时、取消、重试、fetch 注入）。 */
export type NetworkFetchOptions = {
  timeoutMs?: number
  signal?: AbortSignal
  retry?: NetworkRetryOptions
  fetchImpl?: typeof fetch
}

const DEFAULT_BASE_DELAY_MS = 1000
const DEFAULT_MAX_DELAY_MS = 30_000
const DEFAULT_RETRY_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504])
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * 带超时/重试/退避的 fetch 包装；不可重试错误抛 NetworkFetchError。
 * @param input - 请求 URL/Request。
 * @param init - 请求初始化参数（方法、头、body、signal 等）。
 * @param options - 超时、重试与 fetch 注入选项。
 * @returns fetch 响应。
 */
export async function networkFetch(
  input: string | URL | Request,
  init: RequestInit = {},
  options: NetworkFetchOptions = {},
): Promise<Response> {
  const retry = options.retry ?? {}
  const maxRetries = Math.max(0, retry.maxRetries ?? 0)
  const method = resolveMethod(input, init)
  const canRetryMethod = SAFE_METHODS.has(method) || retry.retryOnPost === true
  const parentSignal = options.signal ?? (init.signal instanceof AbortSignal ? init.signal : undefined)
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController()
    const detachAbort = parentSignal ? forwardAbort(parentSignal, controller) : undefined
    // 注意：不得 unref()——unref 的 timer 在事件循环空转（如 node:test
    // runner）时永不触发，await 会挂起（"Promise resolution is still
    // pending"）。请求完成路径有 clearTimeout 兜底，无需 unref。
    const timeout =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(
          () => {
            controller.abort(
              new NetworkFetchError('network_timeout', `Network request timed out after ${options.timeoutMs}ms.`),
            ) },
          options.timeoutMs,
        )
        : undefined

    try {
      const response = await performFetch(
        input,
        {
          ...init,
          signal: controller.signal,
        },
        options.fetchImpl,
      )

      if (canRetryMethod && attempt < maxRetries && shouldRetryStatus(response.status, retry.retryStatuses)) {
        await response.body?.cancel().catch(() => undefined)
        await delay(resolveRetryDelay(attempt, retry, response.headers.get('retry-after')), parentSignal)
        continue
      }

      return response
    } catch (error) {
      lastError = error
      const normalized = normalizeNetworkError(error, controller.signal, parentSignal)
      if (!canRetryMethod || attempt >= maxRetries || !isRetryableNetworkCode(normalized.code)) {
        throw normalized
      }
      await delay(resolveRetryDelay(attempt, retry), parentSignal)
    } finally {
      if (timeout) clearTimeout(timeout)
      detachAbort?.()
    }
  }

  throw normalizeNetworkError(lastError)
}

/**
 * 把任意错误规整为 NetworkFetchError（按中止/超时/系统错误码分类）。
 * @param error - 原始错误。
 * @param localSignal - 本次请求的 AbortSignal（超时中止）。
 * @param parentSignal - 外部传入的 AbortSignal（调用方取消）。
 * @returns 规整后的 NetworkFetchError。
 */
export function normalizeNetworkError(
  error: unknown,
  localSignal?: AbortSignal,
  parentSignal?: AbortSignal,
): NetworkFetchError {
  if (error instanceof NetworkFetchError) return error
  if (parentSignal?.aborted) {
    if (parentSignal.reason instanceof NetworkFetchError) return parentSignal.reason
    return new NetworkFetchError('network_abort', 'Network request aborted by parent signal.', parentSignal.reason)
  }
  if (localSignal?.aborted) {
    const reason: unknown = localSignal.reason
    if (reason instanceof NetworkFetchError) return reason
    return new NetworkFetchError('network_timeout', 'Network request timed out.', reason)
  }

  const message = error instanceof Error
    ? error.message
    : String(error as string | number | boolean | bigint | symbol | null | undefined ?? 'Network request failed.')
  const code = readErrorCode(error)
  const combined = `${code ?? ''} ${message}`.toLowerCase()

  if (combined.includes('enotfound') || combined.includes('eai_again') || combined.includes('dns')) {
    return new NetworkFetchError('network_dns_error', message, error)
  }
  if (combined.includes('econnreset') || combined.includes('socket hang up') || combined.includes('terminated')) {
    return new NetworkFetchError('network_connection_reset', message, error)
  }
  if (combined.includes('econnrefused')) {
    return new NetworkFetchError('network_connection_refused', message, error)
  }
  if (combined.includes('etimedout') || combined.includes('timeout')) {
    return new NetworkFetchError('network_timeout', message, error)
  }
  if (combined.includes('certificate') || combined.includes('tls') || combined.includes('ssl')) {
    return new NetworkFetchError('network_tls_error', message, error)
  }
  if (combined.includes('proxy')) {
    return new NetworkFetchError('network_proxy_error', message, error)
  }
  if (combined.includes('abort')) {
    return new NetworkFetchError('network_abort', message, error)
  }
  return new NetworkFetchError('network_fetch_failed', message, error)
}

/**
 * 错误码是否可重试（中止与 TLS 错误不可重试）。
 * @param code - 网络错误码。
 * @returns 可重试为 true。
 */
export function isRetryableNetworkCode(code: NetworkErrorCode): boolean {
  return code !== 'network_abort' && code !== 'network_tls_error'
}

async function performFetch(
  input: string | URL | Request,
  init: RequestInit,
  fetchImpl?: typeof fetch,
): Promise<Response> {
  if (fetchImpl) {
    return fetchImpl(input, init)
  }
  // Node's built-in fetch (Node 22+, the harness engine range) replaces Sati's
  // lazy undici import; there is no per-request dispatcher to bypass here.
  return globalThis.fetch(input, init)
}

function shouldRetryStatus(status: number, configured?: readonly number[]): boolean {
  if (configured) return configured.includes(status)
  return DEFAULT_RETRY_STATUSES.has(status)
}

function resolveRetryDelay(attempt: number, retry: NetworkRetryOptions, retryAfterHeader?: string | null): number {
  const retryAfter = parseRetryAfterHeader(retryAfterHeader)
  const cap = retry.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  if (retryAfter !== undefined) return Math.min(cap, retryAfter)
  const base = retry.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const exponential = Math.min(cap, base * 2 ** attempt)
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(exponential * 0.25)))
  return Math.min(cap, exponential + jitter)
}

/**
 * 解析 `Retry-After` 头（秒数或 HTTP-date）为建议等待毫秒数；无法解析返回 undefined。
 * @param headerValue - 响应头的 `Retry-After` 值。
 * @returns 建议等待毫秒数；缺失或不可解析时为 undefined。
 */
export function parseRetryAfterHeader(headerValue: string | null | undefined): number | undefined {
  if (!headerValue) return undefined
  const seconds = Number(headerValue.trim())
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const date = Date.parse(headerValue)
  if (!Number.isNaN(date)) {
    const delta = date - Date.now()
    return delta > 0 ? delta : undefined
  }
  return undefined
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  // 不得 unref()：unref timer 在事件循环空转时永不触发，await 挂起
  if (!signal)
    return new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
  if (signal.aborted)
    return Promise.reject(new NetworkFetchError('network_abort', 'Network retry aborted.', signal.reason))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new NetworkFetchError('network_abort', 'Network retry aborted.', signal.reason))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function forwardAbort(source: AbortSignal, target: AbortController): () => void {
  if (source.aborted) {
    target.abort(source.reason)
    return () => {}
  }
  const onAbort = () => { target.abort(source.reason) }
  source.addEventListener('abort', onAbort, { once: true })
  return () => { source.removeEventListener('abort', onAbort) }
}

function resolveMethod(input: string | URL | Request, init: RequestInit): string {
  const method =
    init.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : undefined) ?? 'GET'
  return method.toUpperCase()
}

function readErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const maybe = error as { code?: unknown; cause?: unknown }
  if (typeof maybe.code === 'string') return maybe.code
  if (maybe.cause && typeof maybe.cause === 'object') {
    const causeCode = (maybe.cause as { code?: unknown }).code
    if (typeof causeCode === 'string') return causeCode
  }
  return undefined
}
