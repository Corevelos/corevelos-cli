/**
 * The three per-sandbox modules: `commands`, `files`, `pty`.
 *
 * Same shape as E2B's `sandbox.commands` / `sandbox.files` / `sandbox.pty`,
 * different transport: E2B reaches `envd` inside the sandbox over WebSocket RPC;
 * these go through the Corevelos control plane, so every call is authenticated,
 * rate-limited, and attributed to the credential that made it. That attribution
 * is the reason to prefer these routes even where a direct path exists.
 */
import {
  FileEntrySchema,
  FileExistsResponseSchema,
  ListFilesResponseSchema,
  ListProcessesResponseSchema,
  MakeDirResponseSchema,
  MoveFileResponseSchema,
  ProcessOutputResponseSchema,
  ProcessOutputStreamEventSchema,
  type ProcessOutputStreamEvent,
  ReadFileResponseSchema,
  RunCommandResponseSchema,
  SendStdinResponseSchema,
  StartCommandResponseSchema,
  WriteFileResponseSchema,
  defaultRequestSchemas,
  PTY_BEARER_SUBPROTOCOL_PREFIX,
  PTY_SUBPROTOCOL,
  PtyClientMessageSchema,
  PtyServerMessageSchema,
  type FileEntry,
  type ProcessInfoDto as ProcessInfo,
  type ProcessOutputResponse as ProcessOutput,
} from './contract/index.js'

import type { z } from 'zod'
import { WebSocket } from 'ws'

import type { CorevelosClient } from './client.js'
import { parseSseFrames, validateSseEvents } from './sse.js'

function sandboxPath(sandboxId: string, suffix: string): string {
  return `/api/v1/sandboxes/${encodeURIComponent(sandboxId)}${suffix}`
}

// ── Commands ───────────────────────────────────────────────────────────────

export interface RunOptions {
  cwd?: string
  envs?: Record<string, string>
  /** Hard limit for the command. Always sent — the service refuses "no timeout". */
  timeoutMs?: number
  signal?: AbortSignal
}

export interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
  /** Present when the command exited non-zero. The HTTP status is still 200. */
  error?: string
  durationMs: number
}

/**
 * Command execution: foreground runs, background starts, stdin, kills, listing.
 *
 * Only processes this credential started have retained output — envd streams to
 * the caller and keeps nothing, so `list()` shows the guest's other processes
 * but their `output()` answers as uncaptured rather than as empty text.
 */
export class Commands {
  constructor(
    private readonly client: CorevelosClient,
    private readonly sandboxId: string,
  ) {}

  /** Run a command to completion. A non-zero exit is a result, not an exception. */
  async run(command: string, options: RunOptions = {}): Promise<RunResult> {
    const body = defaultRequestSchemas.RunCommandBodySchema.parse({
      command,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.envs === undefined ? {} : { envs: options.envs }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    })
    const response = await this.client.request(RunCommandResponseSchema, {
      method: 'POST',
      path: sandboxPath(this.sandboxId, '/commands'),
      body,
      signal: options.signal,
    })
    return response
  }

  /**
   * Start a command detached; resolve to its pid immediately. `timeoutMs` bounds
   * the guest-side lifetime of the process, not a gateway lane. Pass `stdin: true`
   * to keep stdin open for `sendStdin`.
   */
  async runInBackground(
    command: string,
    options: RunOptions & { stdin?: boolean } = {},
  ): Promise<{ pid: number }> {
    const body = defaultRequestSchemas.RunCommandBodySchema.parse({
      command,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.envs === undefined ? {} : { envs: options.envs }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      background: true,
      ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
    })
    const response = await this.client.request(StartCommandResponseSchema, {
      method: 'POST',
      path: sandboxPath(this.sandboxId, '/commands'),
      body,
      signal: options.signal,
    })
    return { pid: response.pid }
  }

  /** Read a background process's retained output tail. Poll while `running`. */
  async output(pid: number, signal?: AbortSignal): Promise<ProcessOutput> {
    return this.client.request(ProcessOutputResponseSchema, {
      path: sandboxPath(this.sandboxId, `/processes/${pid}/output`),
      signal,
    })
  }

  /**
   * The retained tail as it grows — `output()` as an async generator.
   *
   * Yields a `snapshot` (what `output()` would return), then `append` chunks
   * and `dropped` gap markers, then `exit` with the code or error. Break out of
   * the loop to stop. Only processes started through this credential have
   * retained output; an untracked pid ends the stream immediately with `exit`.
   */
  async *streamOutput(pid: number, options: { signal?: AbortSignal } = {}): AsyncGenerator<ProcessOutputStreamEvent> {
    const response = await this.client.stream({
      path: sandboxPath(this.sandboxId, `/processes/${pid}/output/stream`),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    yield* validateSseEvents(parseSseFrames(response), ProcessOutputStreamEventSchema, `process ${pid} output`)
  }

  /** Write to a process started with `stdin: true`. Append `\n` for line readers. */
  async sendStdin(pid: number, data: string, options: { eof?: boolean; signal?: AbortSignal } = {}): Promise<void> {
    const body = { data, eof: options.eof ?? false }
    await this.client.request(SendStdinResponseSchema, {
      method: 'POST',
      path: sandboxPath(this.sandboxId, `/processes/${pid}/stdin`),
      body,
      signal: options.signal,
    })
  }

  /** Kill a background process. Already-gone is success. */
  async kill(pid: number, signal?: AbortSignal): Promise<void> {
    await this.client.request(ListProcessesResponseSchema, {
      method: 'DELETE',
      path: sandboxPath(this.sandboxId, `/processes/${pid}`),
      expectEmpty: true,
      signal,
    })
  }

  /** Every process the guest is running, with which ones have retained output. */
  async list(signal?: AbortSignal): Promise<ProcessInfo[]> {
    const response = await this.client.request(ListProcessesResponseSchema, {
      path: sandboxPath(this.sandboxId, '/processes'),
      signal,
    })
    return response.processes
  }
}

// ── Files ──────────────────────────────────────────────────────────────────

export interface ListOptions {
  /** Recursion depth, 1–5. A deep walk of a dependency tree is a DoS, not a feature. */
  depth?: number
  signal?: AbortSignal
}

/**
 * The guest filesystem, through the control plane's file routes.
 *
 * Binary-safe end to end: `read` returns the bytes the guest produced and
 * `write` sends the bytes you give it, both as `application/octet-stream`,
 * so an archive or an image survives intact. The string-returning `read` of
 * E2B's API is split here into `read` (text) and `readBytes` (binary) rather
 * than overloading on a `format` flag — Node callers know which they want.
 */
export class Files {
  constructor(
    private readonly client: CorevelosClient,
    private readonly sandboxId: string,
  ) {}

  /** Read a file as text. Binary data should use `readBytes`. */
  async read(path: string, signal?: AbortSignal): Promise<string> {
    const response = await this.client.request(ReadFileResponseSchema, {
      path: sandboxPath(this.sandboxId, '/files'),
      query: { path },
      signal,
    })
    return response.content
  }

  /** Read a file's bytes, verbatim — the binary-safe read. */
  async readBytes(path: string, signalOrOptions?: AbortSignal | { signal?: AbortSignal; maxBytes?: number }): Promise<Uint8Array> {
    const options = signalOrOptions && 'aborted' in signalOrOptions ? { signal: signalOrOptions } : signalOrOptions ?? {}
    return this.client.requestBytes({
      path: sandboxPath(this.sandboxId, '/files/download'),
      query: { path },
      ...options,
    })
  }

  /** Write a text file (UTF-8). Binary data should use `writeBytes`. */
  async write(path: string, content: string, signal?: AbortSignal): Promise<void> {
    const body = { path, content }
    await this.client.request(WriteFileResponseSchema, {
      method: 'POST',
      path: sandboxPath(this.sandboxId, '/files'),
      body,
      signal,
    })
  }

  /** Write bytes, verbatim — the binary-safe write. */
  async writeBytes(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    await this.client.uploadBytes({
      path: sandboxPath(this.sandboxId, '/files/upload'),
      query: { path },
      bytes,
      signal,
    })
  }

  /** List a directory's entries. */
  async list(path: string, options: ListOptions = {}): Promise<FileEntry[]> {
    const response = await this.client.request(ListFilesResponseSchema, {
      path: sandboxPath(this.sandboxId, '/files/list'),
      query: { path, ...(options.depth === undefined ? {} : { depth: options.depth }) },
      signal: options.signal,
    })
    return response.entries
  }

  /** Stat one path. A missing path throws `not_found` — see `exists` for probing. */
  async getInfo(path: string, signal?: AbortSignal): Promise<FileEntry> {
    return this.client.request(FileEntrySchema, {
      path: sandboxPath(this.sandboxId, '/files/info'),
      query: { path },
      signal,
    })
  }

  /** Does the path exist? A probe, not an error. */
  async exists(path: string, signal?: AbortSignal): Promise<boolean> {
    const response = await this.client.request(FileExistsResponseSchema, {
      path: sandboxPath(this.sandboxId, '/files/exists'),
      query: { path },
      signal,
    })
    return response.exists
  }

  /** Create a directory (with parents). False in the response means it already existed. */
  async makeDir(path: string, signal?: AbortSignal): Promise<boolean> {
    const response = await this.client.request(MakeDirResponseSchema, {
      method: 'POST',
      path: sandboxPath(this.sandboxId, '/files/mkdir'),
      body: { path },
      signal,
    })
    return response.created
  }

  /** Rename or move. Refuses to overwrite: the destination must not exist. */
  async rename(oldPath: string, newPath: string, signal?: AbortSignal): Promise<void> {
    const body = { from: oldPath, to: newPath }
    await this.client.request(MoveFileResponseSchema, {
      method: 'POST',
      path: sandboxPath(this.sandboxId, '/files/move'),
      body,
      signal,
    })
  }

  /** Remove a file or directory (recursively). */
  async remove(path: string, signal?: AbortSignal): Promise<void> {
    await this.client.request(ListFilesResponseSchema, {
      method: 'DELETE',
      path: sandboxPath(this.sandboxId, '/files'),
      query: { path },
      expectEmpty: true,
      signal,
    })
  }
}

// ── PTY ────────────────────────────────────────────────────────────────────

export interface PtySessionOptions {
  cols?: number
  rows?: number
  /** Attach to an existing tty (a pid from `commands.list()`) instead of starting a shell. */
  pid?: number
  cwd?: string
  /** Guest-side lifetime of the tty process. */
  timeoutMs?: number
  signal?: AbortSignal
}

export interface PtySessionEvents {
  /** Guest output, verbatim bytes — may split a multi-byte character across calls. */
  onData: (data: Uint8Array) => void
  /** The session is up: the tty's pid, and its geometry when known. */
  onReady: (info: { pid: number; cols?: number; rows?: number; reattached: boolean }) => void
  /** The tty ended. `exitCode` is absent when the guest did not report one. */
  onExit: (info: { exitCode?: number; error?: string }) => void
  /** The socket dropped without an orderly exit. */
  onClose: (code: number, reason: string) => void
}

/**
 * An interactive terminal: a real pseudo-terminal over the control plane's
 * WebSocket gateway.
 *
 * The framing is the contract's, not invented here: binary frames are terminal
 * bytes in both directions — never decoded, because a tty stream is not always
 * valid UTF-8 mid-chunk — and text frames are JSON control messages validated
 * against the contract's unions. The credential rides as a subprotocol offer
 * (`corevelos.bearer.<token>`), the same trick the console uses, because a
 * `ws` client that could set headers would still be a token in the access log.
 *
 * A reconnect is a new shell: the gateway kills the tty when its socket closes.
 */
export class Pty {
  constructor(
    private readonly client: CorevelosClient,
    private readonly sandboxId: string,
  ) {}

  /**
   * Open a session. Resolves when the gateway says `ready`; the session ends
   * with `onExit` or `onClose` and cannot be reused — open another.
   */
  connect(options: PtySessionOptions & PtySessionEvents): { input: (data: Uint8Array) => void; resize: (cols: number, rows: number) => void; kill: () => void; close: () => void } {
    const { onData, onReady, onExit, onClose, ...query } = options
    const token = this.client.bearerToken
    if (token === undefined) {
      throw new Error('A PTY needs a credential. Pass apiKey or set COREVELOS_API_KEY.')
    }

    const url = new URL(`${this.client.apiBaseUrl}${sandboxPath(this.sandboxId, '/pty')}`)
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && key !== 'signal') url.searchParams.set(key, String(value))
    }
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'

    // The bearer is offered as a subprotocol; the server authenticates from it and
    // selects the *other* protocol, so the credential is never echoed back.
    const socket = new WebSocket(url, [PTY_SUBPROTOCOL, `${PTY_BEARER_SUBPROTOCOL_PREFIX}${token}`])
    let ready = false

    socket.on('message', (frame: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        onData(new Uint8Array(frame as Buffer))
        return
      }
      const parsed = PtyServerMessageSchema.safeParse(JSON.parse(String(frame)))
      if (!parsed.success) return
      const message = parsed.data
      if (message.type === 'ready') {
        ready = true
        onReady({
          pid: message.pid,
          ...(message.cols === undefined ? {} : { cols: message.cols }),
          ...(message.rows === undefined ? {} : { rows: message.rows }),
          reattached: message.reattached,
        })
      } else if (message.type === 'exit') {
        onExit({
          ...(message.exitCode === undefined ? {} : { exitCode: message.exitCode }),
          ...(message.error === undefined ? {} : { error: message.error }),
        })
      }
      // 'error' and 'pong' need no caller surface: the first is rare and the
      // socket's own error path covers it, the second is liveness bookkeeping.
    })

    socket.on('close', (code: number, reason: Buffer) => {
      onClose(code, reason.toString())
    })

    socket.on('error', () => {
      // `ws` always follows 'error' with 'close'; surfacing both would be one
      // failure told twice.
    })

    const send = (message: z.input<typeof PtyClientMessageSchema>) => {
      if (socket.readyState !== WebSocket.OPEN) return
      socket.send(JSON.stringify(message))
    }

    return {
      input: (data: Uint8Array) => {
        if (socket.readyState !== WebSocket.OPEN) return
        socket.send(data, { binary: true })
      },
      resize: (cols: number, rows: number) => send({ type: 'resize', cols, rows }),
      kill: () => send({ type: 'kill' }),
      /** Orderly close. The gateway kills the tty with the socket either way. */
      close: () => socket.close(1000),
    }
  }
}
