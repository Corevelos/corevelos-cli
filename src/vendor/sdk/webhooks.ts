/**
 * Webhooks — lifecycle events, delivered to the customer's own endpoints.
 *
 * Two halves, deliberately in one file. The `Webhooks` class manages
 * registrations through the control plane like every other account module.
 * `verifyWebhookSignature` runs on the *receiving* side, inside the
 * customer's own HTTP handler, and so never talks to the API at all — it is
 * the counterpart of the HMAC the delivery worker computes, shipped in the
 * SDK because a customer should not have to reimplement their own integrity
 * check from a doc.
 *
 * The secret follows the platform's single-delivery rule: `create` and
 * `rotate` resolve with it exactly once, and no SDK call can ever fetch it
 * again. If it is lost, rotate.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

import {
  CreateWebhookResponseSchema,
  ListWebhookDeliveriesResponseSchema,
  ListWebhooksResponseSchema,
  RedeliverWebhookResponseSchema,
  RotateWebhookResponseSchema,
  WebhookEndpointSchema,
  WEBHOOK_EVENT_TYPES,
  CreateWebhookBodySchema,
  UpdateWebhookBodySchema,
} from './contract/index.js'
import type {
  CreateWebhookResponse,
  ListWebhookDeliveriesResponse,
  ListWebhooksResponse,
  RedeliverWebhookResponse,
  RotateWebhookResponse,
  WebhookEndpoint,
  WebhookEventType,
} from './contract/index.js'

import type { CorevelosClient } from './client.js'

/** The header names every delivery carries, spelled once. */
export const WEBHOOK_SIGNATURE_HEADER = 'x-corevelos-signature'

/** Every event type the control plane can deliver, for callers building pickers or validators. */
export { WEBHOOK_EVENT_TYPES }
export const WEBHOOK_EVENT_HEADER = 'x-corevelos-event'
export const WEBHOOK_DELIVERY_HEADER = 'x-corevelos-delivery'
export const WEBHOOK_TIMESTAMP_HEADER = 'x-corevelos-timestamp'

/** Matches the API's tolerance: five minutes, then a timestamp is stale. */
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300

/**
 * Verifies a delivery's HMAC signature: `sha256=<hex>` over
 * `<timestampSeconds>.<rawBody>`, keyed by the endpoint's secret.
 *
 * `body` must be the raw request body string — re-serialized JSON will not
 * match, because the signature is over the exact bytes sent, not over a
 * shape. Verify *before* trusting anything in the payload.
 */
export function verifyWebhookSignature(input: {
  secret: string
  /** The delivery's `x-corevelos-timestamp`, in whole seconds. */
  timestampSeconds: number
  /** The raw request body, exactly as received. */
  body: string
  /** The `x-corevelos-signature` header, `sha256=<hex>`. */
  signature: string
  /** Reject deliveries older than this many seconds. Defaults to 300. */
  toleranceSeconds?: number
}): boolean {
  const tolerance = input.toleranceSeconds ?? WEBHOOK_SIGNATURE_TOLERANCE_SECONDS
  if (!Number.isFinite(input.timestampSeconds)) return false

  const expected = `sha256=${createHmac('sha256', input.secret)
    .update(`${input.timestampSeconds}.${input.body}`)
    .digest('hex')}`

  const given = Buffer.from(input.signature)
  const wanted = Buffer.from(expected)
  // Length compare first: timingSafeEqual throws on unequal lengths, and a
  // malformed header is a mismatch, not an exception.
  if (given.length !== wanted.length) return false
  if (!timingSafeEqual(given, wanted)) return false

  const nowSeconds = Math.floor(Date.now() / 1000)
  const age = Math.abs(nowSeconds - input.timestampSeconds)
  return age <= tolerance
}

/**
 * Endpoint registration and delivery history.
 *
 * A webhook belongs to the credential's billing subject — the organization
 * when there is one — so an org's automation can register with a key minted
 * by any member. Deliveries themselves arrive at the registered URL; this
 * class is the management and audit surface.
 */
export class Webhooks {
  constructor(private readonly client: CorevelosClient) {}

  /**
   * Register an endpoint. Resolves with the signing secret — the one and only
   * time it is readable. Store it now; a lost secret is recovered by `rotate`.
   */
  async create(spec: {
    url: string
    events: readonly WebhookEventType[]
    description?: string
    projectId?: string
    signal?: AbortSignal
  }): Promise<CreateWebhookResponse> {
    const body = CreateWebhookBodySchema.parse({
      url: spec.url,
      events: spec.events,
      ...(spec.projectId === undefined ? {} : { projectId: spec.projectId }),
      ...(spec.description === undefined ? {} : { description: spec.description }),
    })
    return this.client.request(CreateWebhookResponseSchema, {
      method: 'POST',
      path: '/api/v1/webhooks',
      body,
      signal: spec.signal,
    })
  }

  /** Every endpoint this subject registered, newest last. Never secrets. */
  async list(signal?: AbortSignal): Promise<ListWebhooksResponse> {
    return this.client.request(ListWebhooksResponseSchema, { path: '/api/v1/webhooks', signal })
  }

  /** One endpoint by id. Another subject's id reads as `not_found`. */
  async get(webhookId: string, signal?: AbortSignal): Promise<WebhookEndpoint> {
    return this.client.request(WebhookEndpointSchema, {
      path: `/api/v1/webhooks/${encodeURIComponent(webhookId)}`,
      signal,
    })
  }

  /**
   * Change the URL, the subscription, or the description. Applies to future
   * events only — deliveries already queued keep what they were queued with.
   * `description: null` clears it; leaving `description` out keeps it.
   */
  async update(
    webhookId: string,
    changes: {
      url?: string
      events?: readonly WebhookEventType[]
      description?: string | null
      signal?: AbortSignal
    },
  ): Promise<WebhookEndpoint> {
    const body = UpdateWebhookBodySchema.parse({
      ...(changes.url === undefined ? {} : { url: changes.url }),
      ...(changes.events === undefined ? {} : { events: changes.events }),
      ...(changes.description === undefined ? {} : { description: changes.description }),
    })
    return this.client.request(WebhookEndpointSchema, {
      method: 'PATCH',
      path: `/api/v1/webhooks/${encodeURIComponent(webhookId)}`,
      body,
      signal: changes.signal,
    })
  }

  /**
   * Mint a fresh signing secret. It resolves exactly once; the previous secret
   * stops signing immediately. Rotation is also the recovery path for a lost
   * secret — there is no fetch-it-again call, by design.
   */
  async rotate(webhookId: string, signal?: AbortSignal): Promise<RotateWebhookResponse> {
    return this.client.request(RotateWebhookResponseSchema, {
      method: 'POST',
      path: `/api/v1/webhooks/${encodeURIComponent(webhookId)}/rotate`,
      signal,
    })
  }

  /** Delete an endpoint and its delivery history. Idempotent. */
  async remove(webhookId: string, signal?: AbortSignal): Promise<void> {
    await this.client.request(WebhookEndpointSchema, {
      method: 'DELETE',
      path: `/api/v1/webhooks/${encodeURIComponent(webhookId)}`,
      expectEmpty: true,
      signal,
    })
  }

  /** Delivery attempts for one endpoint, newest first, cursor-paged. */
  async listDeliveries(
    webhookId: string,
    options: {
      status?: 'pending' | 'delivered' | 'failed'
      limit?: number
      cursor?: string
      signal?: AbortSignal
    } = {},
  ): Promise<ListWebhookDeliveriesResponse> {
    return this.client.request(ListWebhookDeliveriesResponseSchema, {
      path: `/api/v1/webhooks/${encodeURIComponent(webhookId)}/deliveries`,
      query: {
        ...(options.status === undefined ? {} : { status: options.status }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      },
      signal: options.signal,
    })
  }

  /**
   * Queue a fresh delivery of a past event's exact payload bytes — a new
   * delivery id, so the original's attempt history is never rewritten.
   * Resolves as soon as the delivery is queued, not when it lands.
   */
  async redeliver(
    webhookId: string,
    deliveryId: string,
    signal?: AbortSignal,
  ): Promise<RedeliverWebhookResponse> {
    return this.client.request(RedeliverWebhookResponseSchema, {
      method: 'POST',
      path: `/api/v1/webhooks/${encodeURIComponent(webhookId)}/deliveries/${encodeURIComponent(deliveryId)}/redeliver`,
      signal,
    })
  }
}
