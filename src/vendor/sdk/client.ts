/**
 * The one HTTP seam every SDK surface goes through.
 *
 * Deliberately a plain `fetch` wrapper rather than an OpenAPI-generated client:
 * the contract's Zod schemas already describe every response, so validating with
 * the same schemas the server enforces gives the SDK a stronger guarantee than a
 * generated client has — if the wire drifts from the contract, the SDK throws
 * instead of handing the caller a lie. And a wrapper this size cannot drift from
 * the console's `apiRequest` conventions by much.
 */
import { ErrorResponseSchema } from './contract/index.js'
import type { z } from 'zod'

/**
 * A control-plane failure, mapped rather than stringified.
 *
 * `code` is the service's own vocabulary (the same codes the REST errors and the
 * PTY close codes carry), so a caller branches on `error.code` the way they would
 * on the HTTP API — `quota_exceeded` means "kill a sandbox first", not "try again".
 */
export class CorevelosApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'CorevelosApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/** A response body that did not parse against the contract. */
export class CorevelosContractError extends Error {
  constructor(
    message: string,
    readonly issues: z.ZodIssue[],
  ) {
    super(message)
    this.name = 'CorevelosContractError'
  }
}

export interface CorevelosClientOptions {
  /** API base URL. Defaults to `COREVELOS_API_URL`, then `https://api.corevelos.com`. */
  apiBaseUrl?: string
  /** A Corevelos API key or user token. Undefined inherits the environment; null disables it. */
  apiKey?: string | null
  /** Per-request timeout. Defaults to 60s; pass `Infinity` to disable. Overridden by `signal`'s own deadline when earlier. */
  timeoutMs?: number
  /** Optional rotating user credential, resolved before each HTTP request. */
  credentialProvider?: () => Promise<string>
  /** Cancellation for all requests made by this client. */
  signal?: AbortSignal
  /** Trusted embedding transport; defaults to the platform fetch implementation. */
  fetch?: typeof globalThis.fetch
}

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_BASE_URL = 'https://api.corevelos.com'

export class CorevelosClient {
  readonly apiBaseUrl: string
  private readonly apiKey: string | undefined
  private readonly defaultSignal?: AbortSignal
  private readonly credentialProvider?: () => Promise<string>
  private readonly timeoutMs: number
  private readonly fetch: typeof globalThis.fetch

  constructor(options: CorevelosClientOptions = {}) {
    const base = new URL(options.apiBaseUrl ?? process.env.COREVELOS_API_URL ?? DEFAULT_BASE_URL)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
    if (base.username || base.password || base.search || base.hash ||
        !(base.protocol === 'https:' || (loopback && base.protocol === 'http:'))) {
      throw new Error('Corevelos requires an HTTPS API URL. HTTP is allowed on loopback for development.')
    }
    this.apiBaseUrl = base.href.replace(/\/+$/, '')
    this.apiKey = options.apiKey === null ? undefined : (options.apiKey ?? process.env.COREVELOS_API_KEY)
    this.defaultSignal = options.signal
    this.credentialProvider = options.credentialProvider
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetch = options.fetch ?? globalThis.fetch
    if (this.apiKey !== undefined && this.apiKey.length === 0) {
      throw new Error('Corevelos API key is set to an empty string. Pass a real key or unset it.')
    }
  }

  /** The credential the PTY transport offers as a subprotocol, since `ws` cannot set headers it didn't get. */
  get bearerToken(): string | undefined {
    return this.apiKey
  }

  private requestSignal(signal?: AbortSignal): AbortSignal | undefined {
    const signals = [
      signal,
      this.defaultSignal,
      this.timeoutMs === Infinity ? undefined : AbortSignal.timeout(this.timeoutMs),
    ].filter((value): value is AbortSignal => value !== undefined)
    return signals.length ? AbortSignal.any(signals) : undefined
  }

  private requestUrl(path: string): URL {
    if (!path.startsWith('/') || path.startsWith('//') || /[\\?#\x00-\x1f\x7f]/.test(path) ||
        decodeURIComponent(path).split('/').some(part => part === '.' || part === '..')) {
      throw new Error('Expected a relative Corevelos API path.')
    }
    return new URL(this.apiBaseUrl + path)
  }

  async request<Schema extends z.ZodTypeAny>(
    schema: Schema,
    init: {
      method?: string
      path: string
      query?: Record<string, string | number | boolean | undefined>
      body?: unknown
      signal?: AbortSignal
      /** Set when the route returns 204-style empty bodies. */
      expectEmpty?: boolean
      /**
       * Extra headers, merged over the SDK's own. The one caller that uses it
       * is `Idempotency-Key`; it stays a raw map because a header is not part
       * of a resource's shape, and the key it carries must not leak into
       * logged request bodies the way a body field would.
       */
      headers?: Record<string, string>
    },
  ): Promise<z.infer<Schema>> {
    const url = this.requestUrl(init.path)
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }

    const timeoutSignal = this.timeoutMs === Infinity ? undefined : AbortSignal.timeout(this.timeoutMs)
    const signals = [init.signal, this.defaultSignal, timeoutSignal].filter(
      (value): value is AbortSignal => value !== undefined,
    )
    const signal = signals.length === 0 ? undefined : AbortSignal.any(signals)

    const credential = this.credentialProvider ? await this.credentialProvider() : this.apiKey
    const response = await this.fetch(url, {
      method: init.method ?? 'GET',
      redirect: 'error',
      headers: {
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(credential === undefined ? {} : { authorization: `Bearer ${credential}` }),
        ...(init.headers ?? {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal,
    })

    if (init.expectEmpty === true) {
      if (!response.ok) throw await toApiError(response)
      return undefined as z.infer<Schema>
    }

    const text = await response.text()
    let json: unknown
    try {
      json = text.length === 0 ? undefined : (JSON.parse(text) as unknown)
    } catch {
      if (!response.ok) throw toApiErrorFromJson(response.status, undefined)
      throw new CorevelosContractError(`Expected JSON from ${init.path}, got an invalid body`, [])
    }

    if (!response.ok) throw toApiErrorFromJson(response.status, json)

    if (json === undefined) {
      throw new CorevelosContractError(`Expected a JSON body from ${init.path}, got none`, [])
    }

    const parsed = schema.safeParse(json)
    if (!parsed.success) {
      throw new CorevelosContractError(
        `Response from ${init.path} does not match the contract`,
        parsed.error.issues,
      )
    }
    return parsed.data
  }

  /**
   * Opens a server-sent event stream: the authenticated raw `Response`, body
   * unread. No timeout is applied — a stream's lifetime is the caller's
   * (`signal`), not a per-request budget, and a keepalive-disciplined stream
   * can legitimately outlive any default. A non-2xx answer is mapped to
   * `CorevelosApiError` here, before any frames exist, so a failed open looks
   * like every other failed call.
   */
  async stream(init: {
    path: string
    method?: 'GET' | 'POST'
    body?: unknown
    query?: Record<string, string | number | boolean | undefined>
    signal?: AbortSignal
  }): Promise<Response> {
    const url = this.requestUrl(init.path)
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    const credential = this.credentialProvider ? await this.credentialProvider() : this.apiKey
    const response = await this.fetch(url, {
      method: init.method ?? 'GET',
      redirect: 'error',
      headers: { accept: 'text/event-stream', ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(credential === undefined ? {} : { authorization: `Bearer ${credential}` }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: this.defaultSignal
        ? AbortSignal.any([this.defaultSignal, ...(init.signal ? [init.signal] : [])])
        : init.signal,
    })
    if (!response.ok) throw await toApiError(response)
    return response
  }

  /** Binary GET (file download) — the one route whose body is not JSON. */ async requestBytes(init: {
    path: string
    query?: Record<string, string | number | boolean | undefined>
    signal?: AbortSignal
    maxBytes?: number
  }): Promise<Uint8Array> {
    if (init.maxBytes !== undefined && (!Number.isSafeInteger(init.maxBytes) || init.maxBytes < 0))
      throw new RangeError('maxBytes must be a nonnegative safe integer')
    const url = this.requestUrl(init.path)
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    const credential = this.credentialProvider ? await this.credentialProvider() : this.apiKey
    const response = await this.fetch(url, {
      redirect: 'error',
      headers: credential === undefined ? {} : { authorization: `Bearer ${credential}` },
      signal: this.requestSignal(init.signal),
    })
    if (!response.ok) throw await toApiError(response)
    if (init.maxBytes === undefined) return new Uint8Array(await response.arrayBuffer())
    const reader = response.body?.getReader()
    if (!reader) return new Uint8Array()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > init.maxBytes) throw new CorevelosApiError(413, 'payload_too_large', 'File exceeds the client download byte budget')
        chunks.push(value)
      }
      const output = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
      return output
    } finally { await reader.cancel().catch(() => {}) }
  }

  /** Binary POST (file upload) — `application/octet-stream`, the route's own ceiling enforces the size. */
  async uploadBytes(init: {
    path: string
    query?: Record<string, string | number | boolean | undefined>
    bytes: Uint8Array
    signal?: AbortSignal
  }): Promise<void> {
    const url = this.requestUrl(init.path)
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    const credential = this.credentialProvider ? await this.credentialProvider() : this.apiKey
    const response = await this.fetch(url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        ...(credential === undefined ? {} : { authorization: `Bearer ${credential}` }),
        'content-type': 'application/octet-stream',
      },
      body: init.bytes,
      signal: this.requestSignal(init.signal),
    })
    if (!response.ok) throw await toApiError(response)
  }
}

async function toApiError(response: Response): Promise<CorevelosApiError> {
  const text = await response.text()
  let json: unknown
  try {
    json = text.length === 0 ? undefined : (JSON.parse(text) as unknown)
  } catch {
    json = undefined
  }
  return toApiErrorFromJson(response.status, json)
}

function toApiErrorFromJson(status: number, json: unknown): CorevelosApiError {
  const parsed = ErrorResponseSchema.safeParse(json)
  if (parsed.success) {
    return new CorevelosApiError(
      status,
      parsed.data.error.code,
      parsed.data.error.message,
      parsed.data.error.details,
    )
  }
  // An error body that is not the error shape (a proxy's HTML, an empty 502) is
  // still an error; it just cannot be branched on by code.
  return new CorevelosApiError(
    status,
    'unknown_error',
    `Control plane answered ${status} with an unrecognized body.`,
  )
}
