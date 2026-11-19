import { ExposedPortEndpointSchema } from './contract/index.js'
/**
 * The `Sandbox` class — the E2B vocabulary over Corevelos routes.
 *
 * What "E2B-compatible" buys and what it deliberately does not: a developer who
 * knows `@e2b/code-interpreter` can write the same shapes here —
 * `Sandbox.create()`, `await sandbox.commands.run()`, `sandbox.files.read()` —
 * against a deployment whose wire, auth, and semantics are Corevelos' own. The
 * methods E2B has that this platform does not offer (secrets, git, IAM tokens,
 * template builders, filesystem watch) are absent rather than stubbed: an SDK
 * that fabricates a result is worse than one that never claims the surface.
 *
 * One Corevelos difference surfaces as an API difference, on purpose. E2B's
 * `Sandbox.create()` resolves when the sandbox exists; Corevelos' does too, so
 * `create()` returns a connected `Sandbox` — but pause and resume are
 * first-class here (`betaPause` in E2B, plain `pause` in this SDK, matching the
 * control plane's own naming), and `kill()` is idempotent: reaping an already
 * reaped sandbox is success, because the caller's goal — the sandbox being gone
 * — is already true.
 */
import {
  CreateSandboxResponseSchema,
  ForkSandboxResponseSchema,
  type ForkSandboxResponse, type ForkSandboxBodyInput,
  CreateSnapshotResponseSchema,
  ListSandboxesResponseSchema,
  ListSandboxesQuerySchema,
  PauseResponseSchema,
  PreviewUrlsResponseSchema,
  ResumeResponseSchema,
  RollbackResponseSchema,
  RunCodeResponseSchema,
  SandboxDetailSchema,
  SandboxLogsResponseSchema,
  LogStreamEventSchema,
  type LogStreamEvent,
  SandboxMetricsSchema,
  SandboxNetworkPolicySchema,
  SandboxNetworkStateSchema,
  SandboxRefreshResponseSchema,
  RunCostSummarySchema,
  defaultRequestSchemas,
  type CreateSandboxBody,
  type CreateSnapshotResponse,
  type ListSandboxesResponse,
  type PauseResponse,
  type PreviewUrlsResponse,
  type ResumeResponse,
  type RollbackResponse,
  type RunCodeResponse as RunCodeResult,
  type RunCostSummary,
  type SandboxDetailDto,
  type SandboxLogsResponse,
  type SandboxMetrics,
  type SandboxNetworkPolicy,
  type SandboxNetworkPolicyInput,
  type SandboxNetworkState,
  type SandboxRefreshResponse,
  type VolumeMountInputRaw,
} from './contract/index.js'

import { CorevelosApiError, CorevelosContractError, type CorevelosClientOptions, CorevelosClient } from './client.js'
import { CodeStreamEventSchema, type CodeStreamEvent, type ExecutionResult } from './contract/index.js'
import { Commands, Files, Pty } from './modules.js'
import { parseSseFrames, validateSseEvents } from './sse.js'

const API = '/api/v1/sandboxes'

export interface RunCodeOptions {
  language?: 'python' | 'javascript' | 'typescript' | 'r' | 'java' | 'bash'
  envs?: Record<string, string>
  timeoutMs?: number
  signal?: AbortSignal
  onStdout?: (output: { line: string; timestamp: number }) => unknown
  onStderr?: (output: { line: string; timestamp: number }) => unknown
  onResult?: (result: ExecutionResult) => unknown
  onError?: (error: NonNullable<RunCodeResult['error']>) => unknown
}

function sandboxPath(sandboxId: string, suffix = ''): string {
  return `${API}/${encodeURIComponent(sandboxId)}${suffix}`
}

export interface SandboxCreateOptions extends Pick<CreateSandboxBody,
  'backend' | 'restartPolicy' | 'restartBackoff' | 'livenessProbe' | 'autoPauseMemory'> {
  /** Template id or name. Omitted means the deployment default. */
  template?: string
  /** Requested lifetime in seconds; NEVER_TIMEOUT (-1) is unlimited while funded. */
  timeoutSeconds?: number
  /** Labels carried on every read. Only your keys come back as yours. */
  metadata?: Record<string, string>
  /**
   * The project to attribute this sandbox to. Usually omitted: an API key is
   * bound to one project (its own), so the key already selects the project and a
   * conflicting value is refused. Set it only from a session credential that may
   * target several projects.
   */
  projectId?: string
  /** Environment applied to every execution in the sandbox. */
  envs?: Record<string, string>
  /** Layer-7 egress policy, applied the moment the sandbox is running. */
  network?: SandboxNetworkPolicyInput
  /** Volumes to attach, each at an absolute guest path. Fixed for the sandbox's lifetime. */
  volumeMounts?: VolumeMountInputRaw[]
  /** Pause instead of kill when the timeout expires — the platform default. */
  autoPause?: boolean
  /** Wake on inbound traffic. Requires `autoPause: true`. */
  autoResume?: boolean
  /**
   * Who can reach this sandbox's ports from outside the guest. `restricted`
   * (the deployment default when omitted here too) gates every port behind the
   * sandbox's traffic token; `public` lets anyone with the URL connect on any
   * port the guest listens on. Create-time only — the proxy writes its access
   * metadata once, at creation.
   */
  exposure?: 'public' | 'restricted'
  /**
   * A client-generated retry-safety key (8-255 characters), sent as the
   * `Idempotency-Key` header. The create is bound to the key: a retry with the
   * same key and options replays the first response — traffic token included,
   * no second MicroVM — rather than double-booting. Generate one per
   * *operation*, not per process: the same key with different options answers
   * 409. Omitted means the create is not retry-safe; retries boot again.
   */
  idempotencyKey?: string
  signal?: AbortSignal
}

export interface SandboxListOptions {
  /** Narrow results to an accessible project. */
  projectId?: string
  /** Page size, 1–100. */
  limit?: number
  /** Filter by state, e.g. `running` or `paused`. */
  state?: 'running' | 'paused' | 'pausing' | 'unknown'
  /** Filter by a `key=value,key=value` metadata expression. */
  label?: string
  /** Page continuation token from a previous response. */
  nextToken?: string
  signal?: AbortSignal
}

/**
 * One connected sandbox handle.
 *
 * Cheap to construct and safe to construct twice: it holds an id and a client,
 * nothing else, so reconnecting is making another one. Nothing here caches
 * state the control plane owns — every read goes to the source of truth.
 */
export class Sandbox {
  readonly sandboxId: string
  readonly commands: Commands
  readonly files: Files
  readonly pty: Pty
  /**
   * The connection this handle speaks through. Public because it is the
   * constructor argument for the account-scoped modules (`new Templates(client)`):
   * a sandbox is the one object a customer already holds a live client in.
   */
  readonly client: CorevelosClient
  /**
   * The sandbox's traffic token, as delivered by the create (or fork) that
   * produced this handle. Present only for restricted sandboxes — and only on a
   * handle born from that create: the control plane delivers it exactly once,
   * so a `connect()` handle has none until `getPreviewInfo()` fetches it.
   * Treat it as a credential.
   */
  readonly trafficAccessToken?: string
  /** Fork backing snapshot; reclaim it after terminating the child. */
  readonly forkedFrom?: ForkSandboxResponse['forkedFrom']
  /**
   * The domain preview URLs are built on, when the create response carried it.
   * `getHost` prefers this to avoid a round trip; `getPreviewInfo` refreshes it.
   */
  domain?: string
  /**
   * The timeout disposition the create response carried — the platform default
   * (pause) when the caller said nothing. Absent on a `connect()` handle: a
   * handle by id knows nothing until it asks (`getInfo`).
   */
  autoPause?: boolean

  constructor(
    sandboxId: string,
    client: CorevelosClient,
    initial: {
      trafficAccessToken?: string
      domain?: string
      autoPause?: boolean
      forkedFrom?: ForkSandboxResponse['forkedFrom']
    } = {},
  ) {
    this.sandboxId = sandboxId
    this.client = client
    this.commands = new Commands(client, sandboxId)
    this.files = new Files(client, sandboxId)
    this.pty = new Pty(client, sandboxId)
    if (initial.trafficAccessToken !== undefined) this.trafficAccessToken = initial.trafficAccessToken
    if (initial.forkedFrom !== undefined) this.forkedFrom = initial.forkedFrom
    if (initial.domain !== undefined) this.domain = initial.domain
    if (initial.autoPause !== undefined) this.autoPause = initial.autoPause
  }

  /** The control plane's own view of this sandbox, enriched beyond a list row. */
  async getInfo(signal?: AbortSignal): Promise<SandboxDetailDto> {
    return this.client.request(SandboxDetailSchema, { path: sandboxPath(this.sandboxId), signal })
  }

  /** True only while the sandbox is running; paused, exited and absent return false. */
  async isRunning(signal?: AbortSignal): Promise<boolean> {
    try {
      return (await this.getInfo(signal)).state === 'running'
    } catch (error) {
      if (error instanceof CorevelosApiError && error.status === 404) return false
      throw error
    }
  }

  /** Replace the remaining lifetime, measured from now; NEVER_TIMEOUT (-1) removes scheduled expiry. */
  async setTimeout(timeoutSeconds: number, signal?: AbortSignal): Promise<void> {
    const body = defaultRequestSchemas.SetTimeoutBodySchema.parse({ timeoutSeconds })
    await this.client.request(SandboxDetailSchema, {
      method: 'POST',
      path: sandboxPath(this.sandboxId, '/timeout'),
      body,
      signal,
    })
  }

  /**
   * Add to the lifetime still remaining, or reset the clock to the last requested
   * TTL when no extension is given — the keepalive the upstream timeout route
   * cannot express on its own. The response reports what actually landed,
   * including whether the deployment ceiling reduced it.
   */
  async refresh(extendBySeconds?: number, signal?: AbortSignal): Promise<SandboxRefreshResponse> {
    return this.client.request(SandboxRefreshResponseSchema, {
      method: 'POST',
      path: sandboxPath(this.sandboxId, '/refresh'),
      body: extendBySeconds === undefined ? {} : { extendBySeconds },
      signal,
    })
  }

  /**
   * Full mode preserves memory, processes and tmpfs. Filesystem-only mode cold
   * boots from the parent's disk state. Kill the child before deleting its
   * backing snapshot at `forkedFrom.snapshotId`.
   *
   * `idempotencyKey` carries the same retry-safety contract as on create: a
   * retry with the same key and options replays the first child instead of
   * snapshotting the parent a second time.
   */
  async fork(
    options: ForkSandboxBodyInput & { idempotencyKey?: string; signal?: AbortSignal } = {},
  ): Promise<Sandbox> {
    const { idempotencyKey: _key, signal: _signal, ...input } = options
    const body = defaultRequestSchemas.ForkSandboxBodySchema.parse(input)
    const child = await this.client.request(ForkSandboxResponseSchema, {
      method: 'POST',
      path: sandboxPath(this.sandboxId, '/fork'),
      body,
      signal: options.signal,
      ...(options.idempotencyKey === undefined
        ? {}
        : { headers: { 'idempotency-key': options.idempotencyKey } }),
    })
    return new Sandbox(child.sandboxId, this.client, {
      forkedFrom: child.forkedFrom,
      ...(child.trafficAccessToken === undefined ? {} : { trafficAccessToken: child.trafficAccessToken }),
      ...(child.domain === undefined ? {} : { domain: child.domain }),
      ...(child.autoPause === undefined ? {} : { autoPause: child.autoPause }),
    })
  }

  /** Freeze the MicroVM. A paused sandbox answers reads but cannot run anything. */
  async pause(signal?: AbortSignal): Promise<PauseResponse> {
    return this.client.request(PauseResponseSchema, {
      method: 'POST',
      path: sandboxPath(this.sandboxId, '/pause'),
      signal,
    })
  }

  /** Thaw a paused MicroVM. Omitted lifetime preserves unlimited; finite lifetimes use the deployment default. */
  async resume(
    options: { timeoutSeconds?: number; autoPause?: boolean; signal?: AbortSignal } = {},
  ): Promise<ResumeResponse> {
    const body = {
      ...(options.timeoutSeconds === undefined ? {} : { timeoutSeconds: options.timeoutSeconds }),
      ...(options.autoPause === undefined ? {} : { autoPause: options.autoPause }),
    }
    return this.client.request(ResumeResponseSchema, {
      method: 'POST',
      path: sandboxPath(this.sandboxId, '/resume'),
      body,
      signal: options.signal,
    })
  }

  /** Delete the sandbox and everything in it. Idempotent: a missing sandbox is success. */
  async kill(signal?: AbortSignal): Promise<void> {
    try {
      await this.client.request(SandboxDetailSchema, {
        method: 'DELETE',
        path: sandboxPath(this.sandboxId),
        expectEmpty: true,
        signal,
      })
    } catch (error) {
      if (error instanceof CorevelosApiError && error.status === 404) return
      throw error
    }
  }

  /**
   * Evaluate source in the sandbox's stateful kernel: variables and imports
   * persist from one call to the next. A kernel that raises still answers 200 —
   * check `error` on the result, it is a result, not an exception.
   */
  async runCode(
    code: string,
    options: RunCodeOptions = {},
  ): Promise<RunCodeResult> {
    if (options.onStdout || options.onStderr || options.onResult || options.onError) {
      for await (const event of this.streamCode(code, options)) {
        if (event.type === 'complete') return event.execution
        if (event.type === 'stdout') await options.onStdout?.({ line: event.line, timestamp: event.timestamp })
        if (event.type === 'stderr') await options.onStderr?.({ line: event.line, timestamp: event.timestamp })
        if (event.type === 'result') await options.onResult?.(event.result)
        if (event.type === 'execution_error') await options.onError?.(event.error)
      }
      throw new CorevelosContractError('Code stream ended without completion', [])
    }
    const body = defaultRequestSchemas.RunCodeBodySchema.parse({
      code,
      ...(options.language === undefined ? {} : { language: options.language }),
      ...(options.envs === undefined ? {} : { envs: options.envs }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    })
    return this.client.request(RunCodeResponseSchema, {
      method: 'POST',
      path: sandboxPath(this.sandboxId, '/code'),
      body,
      signal: options.signal,
    })
  }

  /** Live execution; break/AbortSignal cancels the request. Never auto-replayed. */
  async *streamCode(code: string, options: RunCodeOptions = {}): AsyncGenerator<CodeStreamEvent> {
    const path = sandboxPath(this.sandboxId, '/code/stream')
    const body = defaultRequestSchemas.RunCodeBodySchema.parse({ code,
      ...(options.language === undefined ? {} : { language: options.language }),
      ...(options.envs === undefined ? {} : { envs: options.envs }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    })
    const response = await this.client.stream({ path, method: 'POST', body, signal: options.signal })
    for await (const event of validateSseEvents(parseSseFrames(response), CodeStreamEventSchema, path)) {
      if (event.type === 'failure') throw new CorevelosApiError(event.error.status, event.error.code, event.error.message)
      yield event
      if (event.type === 'complete') return
    }
    throw new CorevelosContractError('Code stream ended without completion; execution may have run', [])
  }

  /**
   * Snapshot the whole MicroVM — memory, processes, tmpfs, disk — in place. The
   * snapshot outlives this sandbox and this SDK: delete it through `Snapshots`
   * once nothing references it, or it keeps occupying storage (and metering).
   */
  /** Direct TCP mapping for an explicitly public sandbox. */
  async getExposedPort(port: number, signal?: AbortSignal) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('port must be 1–65535')
    return this.client.request(ExposedPortEndpointSchema, {
      path: sandboxPath(this.sandboxId, `/exposed-ports/${port}`), signal,
    })
  }

  async createSnapshot(
    options: { name?: string; mode?: 'full' | 'fs-only'; backend?: string; signal?: AbortSignal } = {},
  ): Promise<CreateSnapshotResponse> {
    return this.client.request(CreateSnapshotResponseSchema, {
      method: 'POST',
      path: sandboxPath(this.sandboxId, '/snapshots'),
      body: { ...(options.name === undefined ? {} : { name: options.name }), ...(options.mode === undefined ? {} : { mode: options.mode }), ...(options.backend === undefined ? {} : { backend: options.backend }) },
      signal: options.signal,
    })
  }

  /**
   * Roll this sandbox back to a snapshot, in place. The running state is
   * replaced wholesale — the envd session is invalidated too, so any cached
   * handle is stale after this resolves, including this SDK's own modules
   * (they recover: every call goes to the control plane, which re-opens).
   */
  async rollback(snapshotId: string, signal?: AbortSignal): Promise<RollbackResponse> {
    return this.client.request(RollbackResponseSchema, {
      method: 'POST',
      path: sandboxPath(this.sandboxId, '/rollback'),
      body: { snapshotId },
      signal,
    })
  }

  /**
   * One resource-usage sample, measured inside the guest. A sample, not a series
   * — poll and keep the points yourself. Note it runs a command in the guest,
   * which wakes a paused sandbox: check `state` first if you rely on `autoPause`.
   */
  async getMetrics(signal?: AbortSignal, source?: 'host' | 'guest' | 'guest-workload'): Promise<SandboxMetrics> {
    return this.client.request(SandboxMetricsSchema, {
      path: sandboxPath(this.sandboxId, '/metrics'),
      signal,
      query: source === undefined ? {} : { source },
    })
  }

  /**
   * The MicroVM's own lifecycle record (boot, snapshot restore, agent readiness,
   * pause, shutdown) — not guest output. Read it after something went wrong; it
   * does not wake a paused sandbox, and it dies with the sandbox.
   */
  async getLogs(options: { limit?: number; signal?: AbortSignal } = {}): Promise<SandboxLogsResponse> {
    return this.client.request(SandboxLogsResponseSchema, {
      path: sandboxPath(this.sandboxId, '/logs'),
      ...(options.limit === undefined ? {} : { query: { limit: options.limit } }),
      signal: options.signal,
    })
  }

  /**
   * The lifecycle record as it grows — `getLogs` as an async generator.
   *
   * Yields a `snapshot` (the same window `getLogs({ limit })` would return),
   * then one `log` event per new line, then `gone` when the sandbox dies.
   * `break` out of the loop to stop: the connection closes with it.
   *
   * The stream is server-sent events over `fetch`, so the usual credential and
   * error mapping apply — a failed open throws `CorevelosApiError`, a drifted
   * frame `CorevelosContractError`. There is no push upstream: lines arrive
   * within roughly a poll interval of being written.
   */
  async *streamLogs(options: { limit?: number; signal?: AbortSignal } = {}): AsyncGenerator<LogStreamEvent> {
    const response = await this.client.stream({
      path: sandboxPath(this.sandboxId, '/logs/stream'),
      ...(options.limit === undefined ? {} : { query: { limit: options.limit } }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    yield* validateSseEvents(parseSseFrames(response), LogStreamEventSchema, `${this.sandboxId} logs`)
  }

  /**
   * The egress/ingress policy this control plane last applied — which is not the
   * same as the sandbox's policy: `known: false` means nothing has been applied
   * through this control plane since it started, and saying otherwise would be
   * inventing an answer.
   */
  async getNetworkPolicy(signal?: AbortSignal): Promise<SandboxNetworkState> {
    return this.client.request(SandboxNetworkStateSchema, {
      path: sandboxPath(this.sandboxId, '/network'),
      signal,
    })
  }

  /**
   * Replace the egress policy — complete desired state, not a merge: a dimension
   * left out is cleared, not preserved. Read, change, send all of it back.
   */
  async setNetworkPolicy(policy: SandboxNetworkPolicyInput, signal?: AbortSignal): Promise<void> {
    const body = SandboxNetworkPolicySchema.parse(policy)
    await this.client.request(SandboxNetworkStateSchema, {
      method: 'PUT',
      path: sandboxPath(this.sandboxId, '/network'),
      body,
      signal,
    })
  }

  // ── Run cost ───────────────────────────────────────────────────────────────

  /**
   * What this run has cost, from the billing ledger rather than the sandbox
   * record — which is why it still answers after `kill()`: the question is
   * usually asked once the run is over.
   *
   * The figure is gross of the free-tier allowance (the service's rule for any
   * per-resource amount — the allowance is per-account), and `provisional` is
   * true while any meter is still open. The path is a billing route, but the
   * method lives here because the run *is* the sandbox: `Sandbox.connect(id)`
   * works for it too.
   */
  async getCost(signal?: AbortSignal): Promise<RunCostSummary> {
    return this.client.request(RunCostSummarySchema, {
      path: `/api/v1/billing/usage/by-resource/${this.sandboxId}`,
      signal,
    })
  }

  // ── Preview URLs ──────────────────────────────────────────────────────────

  /**
   * The hostname a port of this sandbox is reachable on: `{port}-{sandboxId}.{domain}`.
   *
   * E2B's vocabulary (its `getHost` does the same); the name is load-bearing, not
   * cosmetic — the proxy routes by it and a header or bare address cannot replace
   * it. Uses the domain the create response carried when there is one, else asks
   * the control plane, because a `connect()` handle knows only the id.
   */
  async getHost(port: number = 49983, signal?: AbortSignal): Promise<string> {
    if (this.domain === undefined) {
      const info = await this.getPreviewInfo(signal)
      return `${port}-${this.sandboxId}.${info.domain}`
    }
    return `${port}-${this.sandboxId}.${this.domain}`
  }

  /**
   * One shareable preview URL: `https://{port}-{sandboxId}.{domain}/{path}`.
   *
   * `path` is everything after the host, including a leading `/` — pass
   * `/index.html`, not `index.html`, because the proxy forwards it verbatim.
   * The URL alone reaches the port only when exposure is public; a restricted
   * sandbox answers 403 until the request also carries the token
   * (header `e2b-traffic-access-token`) — see `getPreviewInfo`.
   */
  async getPreviewUrl(
    port: number,
    options: { path?: string; scheme?: 'https' | 'http'; signal?: AbortSignal } = {},
  ): Promise<string> {
    const host = await this.getHost(port, options.signal)
    const scheme = options.scheme ?? 'https'
    const suffix = options.path === undefined ? '' : options.path
    return `${scheme}://${host}${suffix}`
  }

  /**
   * Everything preview URLs need, from the one route that can still say it:
   * the domain, the exposure, and — for a restricted sandbox — the traffic
   * token. The authoritative retrieval after the create's single delivery, and
   * the only one a `connect()` handle ever gets.
   */
  async getPreviewInfo(signal?: AbortSignal): Promise<PreviewUrlsResponse> {
    const info = await this.client.request(PreviewUrlsResponseSchema, {
      path: sandboxPath(this.sandboxId, '/preview-urls'),
      signal,
    })
    this.domain = info.domain
    return info
  }

  // ── Static surface ───────────────────────────────────────────────────────

  /** Boot a new sandbox. Resolves when the control plane has accepted it. */
  static async create(
    options: SandboxCreateOptions & { client?: CorevelosClientOptions } = {},
  ): Promise<Sandbox> {
    const client = new CorevelosClient(options.client)
    const body: CreateSandboxBody = defaultRequestSchemas.CreateSandboxBodySchema.parse({
      ...(options.template === undefined ? {} : { template: options.template }),
      ...(options.timeoutSeconds === undefined ? {} : { timeoutSeconds: options.timeoutSeconds }),
      ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
      ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
      ...(options.envs === undefined ? {} : { envs: options.envs }),
      ...(options.network === undefined ? {} : { network: options.network }),
      ...(options.volumeMounts === undefined ? {} : { volumeMounts: options.volumeMounts }),
      ...(options.autoPause === undefined ? {} : { autoPause: options.autoPause }),
      ...(options.autoResume === undefined ? {} : { autoResume: options.autoResume }),
      ...(options.exposure === undefined ? {} : { exposure: options.exposure }),
      ...(options.backend === undefined ? {} : { backend: options.backend }),
      ...(options.restartPolicy === undefined ? {} : { restartPolicy: options.restartPolicy }),
      ...(options.restartBackoff === undefined ? {} : { restartBackoff: options.restartBackoff }),
      ...(options.livenessProbe === undefined ? {} : { livenessProbe: options.livenessProbe }),
      ...(options.autoPauseMemory === undefined ? {} : { autoPauseMemory: options.autoPauseMemory }),
    })
    const sandbox = await client.request(CreateSandboxResponseSchema, {
      method: 'POST',
      path: API,
      body,
      signal: options.signal,
      // A header, not a body field: the key must not change the body the
      // control plane fingerprints it against.
      ...(options.idempotencyKey === undefined
        ? {}
        : { headers: { 'idempotency-key': options.idempotencyKey } }),
    })
    return new Sandbox(sandbox.sandboxId, client, {
      ...(sandbox.trafficAccessToken === undefined ? {} : { trafficAccessToken: sandbox.trafficAccessToken }),
      ...(sandbox.domain === undefined ? {} : { domain: sandbox.domain }),
      ...(sandbox.autoPause === undefined ? {} : { autoPause: sandbox.autoPause }),
    })
  }

  /** A handle to an existing sandbox. Nothing is verified until the first call. */
  static connect(sandboxId: string, clientOptions: CorevelosClientOptions = {}): Sandbox {
    return new Sandbox(sandboxId, new CorevelosClient(clientOptions))
  }

  /** List this credential's sandboxes. */
  static async list(
    options: SandboxListOptions & { client?: CorevelosClientOptions } = {},
  ): Promise<ListSandboxesResponse> {
    ListSandboxesQuerySchema.parse({
      state: options.state,
      metadata: options.label,
      projectId: options.projectId,
      limit: options.limit,
      nextToken: options.nextToken,
    })
    const client = new CorevelosClient(options.client)
    return client.request(ListSandboxesResponseSchema, {
      path: API,
      query: {
        projectId: options.projectId,
        limit: options.limit,
        ...(options.state === undefined ? {} : { state: options.state }),
        // `label` is the SDK's name for the service's `metadata` filter — the
        // expression grammar (`key=value,key=value`) is the service's own.
        ...(options.label === undefined ? {} : { metadata: options.label }),
        ...(options.nextToken === undefined ? {} : { nextToken: options.nextToken }),
      },
      signal: options.signal,
    })
  }
}
