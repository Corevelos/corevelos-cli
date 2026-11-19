import * as contract from './contract/index.js'
/**
 * Account-scoped surfaces: the resources a credential owns *outside* any one
 * sandbox — templates, volumes, snapshots, billing — plus the platform health
 * probe.
 *
 * E2B's SDK exposes templates and volumes as first-class nouns, so these keep
 * its vocabulary where the concept exists. Billing has no E2B counterpart at
 * all: it is Corevelos' differentiator, spelled in Corevelos' own names, and a
 * credential reading its own metered usage is the Phase 25/26 story in
 * customer hands.
 */
import {
  BillingAccountSchema,
  PaymentHistorySchema,
  BillingEstimateSchema,
  HealthResponseSchema,
  KeyUsageIntervalsResponseSchema,
  KeyUsageResponseSchema,
  ListIntervalsResponseSchema,
  ListSnapshotsResponseSchema,
  ListTemplatesResponseSchema,
  ListVolumesResponseSchema,
  RateCardSchema,
  DeleteSnapshotResponseSchema,
  DeleteTemplateResponseSchema,
  DeleteVolumeResponseSchema,
  TemplateBuildJobSchema,
  TemplateBuildLogsSchema,
  TemplateBuildStatusSchema,
  TemplateDetailSchema,
  UsageBreakdownSchema,
  UsageSummarySchema,
  VolumeDetailSchema,
  CreateTemplateBodySchema,
  SetTemplateAliasBodySchema,
  isApiKeyToken,
} from './contract/index.js'
import type { z } from 'zod'
import type {
  BillingAccount,
  PaymentHistory,
  BillingEstimate,
  CreateTemplateBodyInput,
  DeleteSnapshotResponse,
  DeleteTemplateResponse,
  DeleteVolumeResponse,
  HealthResponse,
  KeyUsageResponse,
  ListIntervalsResponse,
  ListSnapshotsQuery,
  ListSnapshotsResponse,
  ListTemplatesQuery,
  ListTemplatesResponse,
  ListVolumesResponse,
  RateCard,
  RebuildTemplateBody,
  SetTemplateAliasBody,
  TemplateBuildJob,
  TemplateBuildLogs,
  TemplateBuildStatus,
  TemplateDetail,
  TemplateSummary,
  UsageBreakdown,
  UsageSummary,
  Volume,
  VolumeDetail,
} from './contract/index.js'

import type { CorevelosClient, CorevelosClientOptions } from './client.js'
import { CorevelosClient as Client } from './client.js'

function withClient(options: CorevelosClientOptions): CorevelosClient {
  return new Client(options)
}

// ── Templates ───────────────────────────────────────────────────────────────

/**
 * The images a sandbox can boot from — and, because upstream keeps one registry,
 * the snapshots too (`snap-…` ids resolve through the same routes).
 *
 * Template builds run asynchronously. Poll buildStatus with the returned identifiers.
 */
export class Templates {
  constructor(private readonly client: CorevelosClient) {}

  async buildCapabilities(signal?: AbortSignal) {
    return this.client.request(contract.TemplateBuildCapabilitiesSchema, { path: '/api/v1/templates/capabilities', signal })
  }

  /** Prepare a Docker image inside an owned funded build sandbox. Upload chunks
   * to DOCKER_TEMPLATE_INPUT_ROOT/buildId/fileIndex-chunkIndex first. */
  async prepareDocker(sandboxId: string, buildId: string, spec: z.input<typeof contract.PrepareDockerTemplateBodySchema>, signal?: AbortSignal): Promise<contract.DockerTemplatePreparation> {
    const params = contract.DockerTemplateBuildParamsSchema.parse({ sandboxId, buildId })
    return this.client.request(contract.DockerTemplatePreparationSchema, {
      method: 'POST', path: `/api/v1/templates/docker/${params.sandboxId}/${params.buildId}`,
      body: contract.PrepareDockerTemplateBodySchema.parse(spec), signal,
    })
  }

  async dockerPreparation(sandboxId: string, buildId: string, signal?: AbortSignal): Promise<contract.DockerTemplatePreparation> {
    const params = contract.DockerTemplateBuildParamsSchema.parse({ sandboxId, buildId })
    return this.client.request(contract.DockerTemplatePreparationSchema, { path: `/api/v1/templates/docker/${params.sandboxId}/${params.buildId}`, signal })
  }

  /** Capture a clean, dedicated build VM. Keep it alive until buildStatus is ready. */
  async fromSandbox(spec: contract.CreateTemplateFromSandboxBody, options: { idempotencyKey: string; signal?: AbortSignal }): Promise<TemplateBuildJob> {
    const body = contract.CreateTemplateFromSandboxBodySchema.parse(spec)
    const key = contract.IdempotencyKeySchema.parse(options.idempotencyKey)
    return this.client.request(TemplateBuildJobSchema, {
      method: 'POST', path: '/api/v1/templates/from-sandbox', body,
      headers: { 'Idempotency-Key': key }, signal: options.signal,
    })
  }

  /**
   * Every template the caller can boot, plus (with `kind`) the caller's
   * snapshots sharing the registry. The default hides snapshots.
   */
  async list(
    options: Partial<ListTemplatesQuery> & { signal?: AbortSignal } = {},
  ): Promise<ListTemplatesResponse> {
    const { signal, ...filters } = options
    return this.client.request(ListTemplatesResponseSchema, {
      path: '/api/v1/templates',
      query: contract.ListTemplatesQuerySchema.parse(filters),
      signal,
    })
  }

  /**
   * One template (or snapshot, by id) in detail. 404s until a build finishes —
   * upstream has no document to return before then; poll the build status.
   */
  async get(templateId: string, signal?: AbortSignal): Promise<TemplateDetail> {
    return this.client.request(TemplateDetailSchema, {
      path: `/api/v1/templates/${encodeURIComponent(templateId)}`,
      signal,
    })
  }

  /**
   * Start a build from an OCI image. Resolves 202 with the ids to poll. The
   * template belongs to this caller alone; nobody else can see, boot or
   * rebuild it.
   */
  async create(spec: CreateTemplateBodyInput, signal?: AbortSignal): Promise<TemplateBuildJob> {
    const body = CreateTemplateBodySchema.parse(spec)
    return this.client.request(TemplateBuildJobSchema, {
      method: 'POST',
      path: '/api/v1/templates',
      body,
      signal,
    })
  }

  /**
   * Re-materialise a template from the spec it already has — no image pull, no
   * spec change (upstream accepts fields here and ignores them; a rebuild
   * asking for more memory measured to come back unchanged). Only the builder
   * may rebuild.
   */
  async rebuild(templateId: string, signal?: AbortSignal): Promise<TemplateBuildJob> {
    const body: RebuildTemplateBody = {}
    return this.client.request(TemplateBuildJobSchema, {
      method: 'POST',
      path: `/api/v1/templates/${encodeURIComponent(templateId)}/rebuild`,
      body,
      signal,
    })
  }

  /** Where a build has got to. Poll this with the ids from `create`/`rebuild`. */
  async buildStatus(templateId: string, buildId: string, signal?: AbortSignal): Promise<TemplateBuildStatus> {
    return this.client.request(TemplateBuildStatusSchema, {
      path: `/api/v1/templates/${encodeURIComponent(templateId)}/builds/${encodeURIComponent(buildId)}/status`,
      signal,
    })
  }

  /**
   * What upstream has to say about a build — measured to be the current phase,
   * not a transcript, so do not expect image-build output here.
   */
  async buildLogs(templateId: string, buildId: string, signal?: AbortSignal): Promise<TemplateBuildLogs> {
    return this.client.request(TemplateBuildLogsSchema, {
      path: `/api/v1/templates/${encodeURIComponent(templateId)}/builds/${encodeURIComponent(buildId)}/logs`,
      signal,
    })
  }

  /** Set a stable alias (boot by name), or clear it with `null` or `''`. */
  async setAlias(templateId: string, alias: string | null, signal?: AbortSignal): Promise<TemplateDetail> {
    const body: SetTemplateAliasBody = SetTemplateAliasBodySchema.parse({ alias })
    return this.client.request(TemplateDetailSchema, {
      method: 'PUT',
      path: `/api/v1/templates/${encodeURIComponent(templateId)}/alias`,
      body,
      signal,
    })
  }

  /**
   * Delete a template (or snapshot — same registry) and reclaim its storage.
   * Refused while any sandbox is booted from it or any fork still references it.
   */
  async delete(templateId: string, signal?: AbortSignal): Promise<DeleteTemplateResponse> {
    return this.client.request(DeleteTemplateResponseSchema, {
      method: 'DELETE',
      path: `/api/v1/templates/${encodeURIComponent(templateId)}`,
      signal,
    })
  }
}

// ── Volumes ─────────────────────────────────────────────────────────────────

/**
 * Persistent storage that outlives any one sandbox: a virtiofs export mounted
 * at an absolute guest path, set at create time and fixed for the sandbox's
 * lifetime (there is no attach-later route — that absence is upstream's, and
 * the SDK does not paper over it).
 */
export class Volumes {
  constructor(private readonly client: CorevelosClient) {}

  /** Every volume the caller owns. */
  async list(signal?: AbortSignal): Promise<ListVolumesResponse> {
    return this.client.request(ListVolumesResponseSchema, { path: '/api/v1/volumes', signal })
  }

  /**
   * Create a volume. `name` is the id — a duplicate is a 409, not a second
   * volume. Omit it for a generated one.
   */
  async create(
    options: { name?: string; driver?: string; privateData?: string; projectId?: string; signal?: AbortSignal } = {},
  ): Promise<VolumeDetail> {
    return this.client.request(VolumeDetailSchema, {
      method: 'POST',
      path: '/api/v1/volumes',
      body: {
        ...(options.name === undefined ? {} : { name: options.name }),
        ...(options.driver === undefined ? {} : { driver: options.driver }),
        ...(options.privateData === undefined ? {} : { privateData: options.privateData }),
        ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
      },
      signal: options.signal,
    })
  }

  /** One volume: which sandboxes mount it, whether the driver issued a token. */
  async get(volumeId: string, signal?: AbortSignal): Promise<VolumeDetail> {
    return this.client.request(VolumeDetailSchema, {
      path: `/api/v1/volumes/${encodeURIComponent(volumeId)}`,
      signal,
    })
  }

  /**
   * Delete a volume and its data. Refused (409) while any sandbox mounts it —
   * read `mountedBy` from `get` first.
   */
  async delete(volumeId: string, signal?: AbortSignal): Promise<DeleteVolumeResponse> {
    return this.client.request(DeleteVolumeResponseSchema, {
      method: 'DELETE',
      path: `/api/v1/volumes/${encodeURIComponent(volumeId)}`,
      signal,
    })
  }
}

// ── Snapshots ───────────────────────────────────────────────────────────────

/**
 * Whole-MicroVM snapshots (memory, processes, tmpfs, disk) the caller owns,
 * taken with `sandbox.createSnapshot()` or `sandbox.fork()`.
 *
 * A separate class rather than a `Sandbox` static because snapshots are
 * account-scoped: they outlive the sandbox they came from, and the list and
 * delete routes live under `/api/v1/snapshots`.
 */
export class Snapshots {
  constructor(private readonly client: CorevelosClient) {}

  /** Snapshots this credential can act on, optionally filtered by sandbox. */
  async list(
    options: { sandboxId?: string; name?: string; backend?: string; limit?: number; nextToken?: string; signal?: AbortSignal } = {},
  ): Promise<ListSnapshotsResponse> {
    return this.client.request(ListSnapshotsResponseSchema, {
      path: '/api/v1/snapshots',
      query: {
        ...(options.sandboxId === undefined ? {} : { sandboxId: options.sandboxId }),
        ...(options.name === undefined ? {} : { name: options.name }),
        ...(options.backend === undefined ? {} : { backend: options.backend }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(options.nextToken === undefined ? {} : { nextToken: options.nextToken }),
      },
      signal: options.signal,
    })
  }

  /**
   * Delete a snapshot and reclaim its storage. Refused while something is
   * restored from it — a fork's child holds a reference, so kill the child
   * first.
   */
  async delete(snapshotId: string, signal?: AbortSignal): Promise<DeleteSnapshotResponse> {
    return this.client.request(DeleteSnapshotResponseSchema, {
      method: 'DELETE',
      path: `/api/v1/snapshots/${encodeURIComponent(snapshotId)}`,
      signal,
    })
  }
}

// ── Billing ─────────────────────────────────────────────────────────────────

/** The raw intervals a `selfUsage` figure came from — same shape as the account listing. */
export type KeyUsageIntervals = z.infer<typeof KeyUsageIntervalsResponseSchema>
export interface BillingPeriod {
  /** ISO-8601 start. Must be given with `to`. */
  from?: string
  /** ISO-8601 end, after `from`. Must be given with `from`. */
  to?: string
}

/**
 * What a credential's work costs — Corevelos' own surface, no E2B counterpart,
 * deliberately under Corevelos names.
 *
 * Every figure comes from the ledger, rated against the rate card in force:
 * the account (spend cap, balance, status), the plan, rated usage with the
 * per-line arithmetic a customer needs to reproduce the total, the raw
 * intervals, verified payment history, and the one-call estimate a dashboard
 * header wants. Operator-only routes (finalizing, voiding, credit notes,
 * anomalies) are not here: this SDK is a customer credential, and the service
 * refuses it those routes anyway.
 */
export class Billing {
  constructor(private readonly client: CorevelosClient) {}
  wallet() {
    return this.client.request(contract.PrepaidWalletSchema, { path: '/api/v1/billing/wallet' })
  }
  walletHistory() {
    return this.client.request(contract.PrepaidHistorySchema, { path: '/api/v1/billing/wallet/history' })
  }
  walletActivity(query: { limit?: number; cursor?: string } = {}) {
    return this.client.request(contract.WalletActivitySchema, { path: '/api/v1/billing/wallet/activity', query })
  }
  payment(purchaseId: string) {
    return this.client.request(contract.PaymentRecordSchema, {
      path: `/api/v1/billing/payments/${encodeURIComponent(purchaseId)}`,
    })
  }
  reconcilePayment(purchaseId: string) {
    return this.client.request(contract.PaymentRecordSchema, {
      method: 'POST',
      path: `/api/v1/billing/payments/${encodeURIComponent(purchaseId)}/reconcile`,
    })
  }
  paymentInvoice(purchaseId: string) {
    return this.client.request(contract.CheckoutUrlResponseSchema, {
      method: 'POST',
      path: `/api/v1/billing/payments/${encodeURIComponent(purchaseId)}/invoice`,
    })
  }
  portal() {
    return this.client.request(contract.CheckoutUrlResponseSchema, { path: '/api/v1/billing/portal' })
  }
  checkout(input: z.input<typeof contract.BuyCreditPackSchema>) {
    return this.client.request(contract.CheckoutUrlResponseSchema, {
      method: 'POST',
      path: '/api/v1/billing/checkout',
      body: contract.BuyCreditPackSchema.parse(input),
    })
  }
  setSpendCap(spendCapMicros: number | null) {
    return this.client.request(contract.BillingAccountSchema, {
      method: 'PUT',
      path: '/api/v1/billing/account/spend-cap',
      body: contract.SetSpendCapBodySchema.parse({ spendCapMicros }),
    })
  }

  /** The caller's billing account: status, spend cap, balance, rate card. */
  async getAccount(signal?: AbortSignal): Promise<BillingAccount> {
    return this.client.request(BillingAccountSchema, { path: '/api/v1/billing/account', signal })
  }

  /** The priced plan in force: rates per unit-hour, free allowances, rounding. */
  async getRateCard(signal?: AbortSignal): Promise<RateCard> {
    return this.client.request(RateCardSchema, { path: '/api/v1/billing/rate-card', signal })
  }

  /**
   * Rated usage for a billing period (default: the current month). Each line
   * carries the arithmetic — quantity, allowance absorbed, chargeable quantity,
   * cost — so a dispute is answerable from the response alone.
   */
  async getUsage(period: BillingPeriod = {}, signal?: AbortSignal): Promise<UsageSummary> {
    return this.client.request(UsageSummarySchema, {
      path: '/api/v1/billing/usage',
      query: {
        ...(period.from === undefined ? {} : { from: period.from }),
        ...(period.to === undefined ? {} : { to: period.to }),
      },
      signal,
    })
  }

  /** The raw metered intervals behind the summary, page by cursor. */
  async listIntervals(
    options: BillingPeriod & {
      openedByKeyId?: string
      meter?: 'vcpu' | 'memory' | 'storage'
      resourceType?: 'sandbox' | 'volume' | 'snapshot'
      resourceId?: string
      status?: 'open' | 'closed' | 'all'
      limit?: number
      cursor?: string
      signal?: AbortSignal
    } = {},
  ): Promise<ListIntervalsResponse> {
    return this.client.request(ListIntervalsResponseSchema, {
      path: '/api/v1/billing/usage/intervals',
      query: {
        ...(options.openedByKeyId === undefined ? {} : { openedByKeyId: options.openedByKeyId }),
        ...(options.from === undefined ? {} : { from: options.from }),
        ...(options.to === undefined ? {} : { to: options.to }),
        ...(options.meter === undefined ? {} : { meter: options.meter }),
        ...(options.resourceType === undefined ? {} : { resourceType: options.resourceType }),
        ...(options.resourceId === undefined ? {} : { resourceId: options.resourceId }),
        ...(options.status === undefined ? {} : { status: options.status }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      },
      signal: options.signal,
    })
  }

  /** The one-call live picture a dashboard header needs: account, plan, usage, gate. */
  async getEstimate(signal?: AbortSignal): Promise<BillingEstimate> {
    return this.client.request(BillingEstimateSchema, { path: '/api/v1/billing/estimate', signal })
  }

  /**
   * A period grouped by credential and by resource, in one request. Every group
   * is rated gross of the allowance (the free tier is per-account — group
   * subtotals are shares of the gross bill, and the net figure is `getUsage`).
   * The `null` key is session-opened and reconciler-discovered usage.
   */
  async getUsageBreakdown(period: BillingPeriod = {}, signal?: AbortSignal): Promise<UsageBreakdown> {
    return this.client.request(UsageBreakdownSchema, {
      path: '/api/v1/billing/usage/breakdown',
      query: {
        ...(period.from === undefined ? {} : { from: period.from }),
        ...(period.to === undefined ? {} : { to: period.to }),
      },
      signal,
    })
  }

  /** Verified credit-pack purchases for the authenticated billing workspace. */
  async listPayments(options: { limit?: number; cursor?: string; signal?: AbortSignal } = {}): Promise<PaymentHistory> {
    const { signal, ...query } = options
    return this.client.request(PaymentHistorySchema, { path: '/api/v1/billing/payments', query, signal })
  }
}

// ── The client-level surface ────────────────────────────────────────────────

/**
 * A key asking what it cost. Corevelos keys carry their id in their own token
 * (`cv_<keyId>_…`), so a key-authenticated client knows exactly which usage to
 * read — the one route pair where the service lets a key see itself.
 */
export class Keys {
  constructor(private readonly client: CorevelosClient) {}
  list() {
    return this.client.request(contract.ListApiKeysResponseSchema, { path: '/api/v1/keys' })
  }
  get(keyId: string) {
    return this.client.request(contract.ApiKeyInfoSchema, { path: `/api/v1/keys/${encodeURIComponent(keyId)}` })
  }
  create(input: contract.CreateApiKeyBody) {
    return this.client.request(contract.CreateApiKeyResponseSchema, {
      method: 'POST',
      path: '/api/v1/keys',
      body: contract.CreateApiKeyBodySchema.parse(input),
    })
  }
  revoke(keyId: string) {
    return this.client.request(contract.RevokeApiKeyResponseSchema, {
      method: 'DELETE',
      path: `/api/v1/keys/${encodeURIComponent(keyId)}`,
    })
  }
  usage(keyId: string, period: BillingPeriod = {}) {
    return this.client.request(contract.KeyUsageResponseSchema, {
      path: `/api/v1/keys/${encodeURIComponent(keyId)}/usage`,
      query: { ...period },
    })
  }

  /**
   * Rated usage of the intervals this key's requests opened. A key can read its
   * own usage and no other key's — the service enforces it; the SDK only aims
   * the request. Resolves to an error if the credential is a session token.
   */
  async selfUsage(period: BillingPeriod = {}, signal?: AbortSignal): Promise<KeyUsageResponse> {
    const keyId = keyIdOf(this.client)
    return this.client.request(KeyUsageResponseSchema, {
      path: `/api/v1/keys/${keyId}/usage`,
      query: {
        ...(period.from === undefined ? {} : { from: period.from }),
        ...(period.to === undefined ? {} : { to: period.to }),
      },
      signal,
    })
  }

  /** The raw intervals behind `selfUsage`, page by cursor. */
  async selfUsageIntervals(
    options: BillingPeriod & {
      meter?: 'vcpu' | 'memory' | 'storage'
      resourceType?: 'sandbox' | 'volume' | 'snapshot'
      resourceId?: string
      status?: 'open' | 'closed' | 'all'
      limit?: number
      cursor?: string
      signal?: AbortSignal
    } = {},
  ): Promise<KeyUsageIntervals> {
    const keyId = keyIdOf(this.client)
    return this.client.request(KeyUsageIntervalsResponseSchema, {
      path: `/api/v1/keys/${keyId}/usage/intervals`,
      query: {
        ...(options.from === undefined ? {} : { from: options.from }),
        ...(options.to === undefined ? {} : { to: options.to }),
        ...(options.meter === undefined ? {} : { meter: options.meter }),
        ...(options.resourceType === undefined ? {} : { resourceType: options.resourceType }),
        ...(options.resourceId === undefined ? {} : { resourceId: options.resourceId }),
        ...(options.status === undefined ? {} : { status: options.status }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      },
      signal: options.signal,
    })
  }
}

/** The key id embedded in this client's `cv_` credential, when it holds one. */
function keyIdOf(client: CorevelosClient): string {
  const token = client.bearerToken
  if (token === undefined || !isApiKeyToken(token)) {
    throw new Error('This surface needs a Corevelos API key (cv_…). A session token cannot read key usage.')
  }
  // `cv_<10>_<43>` — the middle segment is the public lookup handle.
  return token.split('_')[1] ?? ''
}

/** Liveness, readiness and the canary leg — unauthenticated, no key needed. */
export async function getHealth(options: { apiBaseUrl?: string; signal?: AbortSignal } = {}): Promise<HealthResponse> {
  // A throwaway client: health deliberately authenticates nothing, so an empty
  // credential is correct here rather than an oversight to work around.
  const client = withClient({ apiBaseUrl: options.apiBaseUrl, apiKey: null })
  return client.request(HealthResponseSchema, { path: '/health', signal: options.signal })
}

/** The execution, upload and download ceilings enforced by this deployment. */
export function getLimits(client: CorevelosClient) {
  return client.request(contract.LimitsResponseSchema, { path: '/api/v1/limits' })
}
