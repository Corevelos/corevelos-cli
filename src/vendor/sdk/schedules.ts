/**
 * Schedules — cron-driven sandbox creates.
 *
 * A schedule is a stored create body plus a cron expression: when the
 * expression comes due, the control plane performs the same create the owner
 * would — the same quota, spend and template gates, the same per-key billing
 * attribution — and tells the subject's webhook endpoints (`schedule.fired`
 * with the new sandbox's id, or `schedule.failed` with the refusal's reason).
 * What runs *inside* the sandbox is the customer's automation responding to
 * that webhook; a schedule never runs anything itself.
 *
 * The cron dialect is deliberately small: five fields (minute hour
 * day-of-month month day-of-week), UTC only, digits only — no names, no
 * macros, no seconds. An expression with no occurrence inside the five-year
 * horizon (a February 31st) is refused at create.
 */
import { ListSchedulesResponseSchema, ScheduleSchema, defaultRequestSchemas } from './contract/index.js'
import type { ListSchedulesResponse, Schedule, SandboxNetworkPolicyInput, VolumeMountInputRaw } from './contract/index.js'

import type { CorevelosClient } from './client.js'

const API = '/api/v1/schedules'

function schedulePath(scheduleId: string): string {
  return `${API}/${encodeURIComponent(scheduleId)}`
}

/**
 * The sandbox a schedule fires — the same options `Sandbox.create` takes,
 * minus the create-only per-call concerns (idempotency key, signal): a fire is
 * the control plane acting on a stored body, not this client retrying.
 */
export interface ScheduledSandboxOptions {
  /** Template id or name. Omitted means the deployment default. */
  template?: string
  /** Wall-clock lifetime in seconds before reclamation (or pause, with `autoPause`). */
  timeoutSeconds?: number
  /** Labels carried on every read. Only your keys come back as yours. */
  metadata?: Record<string, string>
  /** Environment applied to every execution in the sandbox. */
  envs?: Record<string, string>
  /** Layer-7 egress policy, applied the moment the fired sandbox is running. */
  network?: SandboxNetworkPolicyInput
  /** Volumes to attach, each at an absolute guest path. */
  volumeMounts?: VolumeMountInputRaw[]
  /** Pause instead of kill when the timeout expires — the platform default. */
  autoPause?: boolean
  /** Wake on inbound traffic. Requires `autoPause: true`. */
  autoResume?: boolean
  /** Who can reach the fired sandbox's ports from outside the guest. */
  exposure?: 'public' | 'restricted'
}

/** Defaults applied now, stored verbatim — every fire sends the same body. */
const toCreateBody = (options: ScheduledSandboxOptions) =>
  defaultRequestSchemas.CreateSandboxBodySchema.parse({
    ...(options.template === undefined ? {} : { template: options.template }),
    ...(options.timeoutSeconds === undefined ? {} : { timeoutSeconds: options.timeoutSeconds }),
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
    ...(options.envs === undefined ? {} : { envs: options.envs }),
    ...(options.network === undefined ? {} : { network: options.network }),
    ...(options.volumeMounts === undefined ? {} : { volumeMounts: options.volumeMounts }),
    ...(options.autoPause === undefined ? {} : { autoPause: options.autoPause }),
    ...(options.autoResume === undefined ? {} : { autoResume: options.autoResume }),
    ...(options.exposure === undefined ? {} : { exposure: options.exposure }),
  })

/**
 * Schedule management. The tick itself lives in the control plane; nothing
 * here waits on a clock. Creating one requires at least one registered
 * webhook endpoint for the credential's subject — a fire that fails silently
 * is the one outcome the platform refuses to allow.
 */
export class Schedules {
  constructor(private readonly client: CorevelosClient) {}

  /**
   * Register a schedule. `cron` is five UTC fields; `sandbox` defaults to the
   * same defaults `Sandbox.create` applies. Resolves with the stored schedule,
   * next fire included.
   */
  async create(
    spec: { cron: string; sandbox?: ScheduledSandboxOptions; name?: string; enabled?: boolean; signal?: AbortSignal },
  ): Promise<Schedule> {
    const body = defaultRequestSchemas.CreateScheduleBodySchema.parse({
      cron: spec.cron,
      sandbox: toCreateBody(spec.sandbox ?? {}),
      ...(spec.name === undefined ? {} : { name: spec.name }),
      ...(spec.enabled === undefined ? {} : { enabled: spec.enabled }),
    })
    return this.client.request(ScheduleSchema, { method: 'POST', path: API, body, signal: spec.signal })
  }

  /** Every schedule the credential's subject holds, newest first. */
  async list(signal?: AbortSignal): Promise<ListSchedulesResponse> {
    return this.client.request(ListSchedulesResponseSchema, { path: API, signal })
  }

  /** One schedule by id. Another subject's id reads as `not_found`. */
  async get(scheduleId: string, signal?: AbortSignal): Promise<Schedule> {
    return this.client.request(ScheduleSchema, { path: schedulePath(scheduleId), signal })
  }

  /**
   * Change the label, the cron expression, the stored create body, or the
   * enabled flag. A new cron is validated like a new schedule's; re-enabling
   * schedules from that moment — never the backlog of runs missed while
   * disabled. `sandbox` replaces the stored body wholesale.
   */
  async update(
    scheduleId: string,
    changes: {
      name?: string
      cron?: string
      enabled?: boolean
      sandbox?: ScheduledSandboxOptions
      signal?: AbortSignal
    },
  ): Promise<Schedule> {
    const body = defaultRequestSchemas.UpdateScheduleBodySchema.parse({
      ...(changes.name === undefined ? {} : { name: changes.name }),
      ...(changes.cron === undefined ? {} : { cron: changes.cron }),
      ...(changes.enabled === undefined ? {} : { enabled: changes.enabled }),
      ...(changes.sandbox === undefined ? {} : { sandbox: toCreateBody(changes.sandbox) }),
    })
    return this.client.request(ScheduleSchema, {
      method: 'PATCH',
      path: schedulePath(scheduleId),
      body,
      signal: changes.signal,
    })
  }

  /**
   * Delete a schedule. Idempotent. Sandboxes a past fire created are
   * unaffected — killing those is what the webhook's `sandboxId` is for.
   */
  async remove(scheduleId: string, signal?: AbortSignal): Promise<void> {
    await this.client.request(ScheduleSchema, {
      method: 'DELETE',
      path: schedulePath(scheduleId),
      expectEmpty: true,
      signal,
    })
  }
}
