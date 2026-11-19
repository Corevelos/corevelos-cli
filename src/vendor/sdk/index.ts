/**
 * The Corevelos SDK's public surface.
 *
 * One env var, one class: `COREVELOS_API_KEY` in the environment (or `apiKey`
 * on the client options) and `Sandbox` does the rest. The key is minted from
 * the console's API keys page; usage each key creates is billed to its account
 * and attributed to it, key by key.
 */
import type { z } from 'zod'

export { CorevelosApiError, CorevelosContractError, CorevelosClient } from './client.js'
export type { CorevelosClientOptions } from './client.js'
export { Sandbox } from './sandbox.js'
export { NEVER_TIMEOUT } from './contract/index.js'
export type { SandboxCreateOptions, SandboxListOptions, RunCodeOptions } from './sandbox.js'
export { Commands, Files, Pty } from './modules.js'
export type { RunOptions, RunResult, ListOptions, PtySessionOptions, PtySessionEvents } from './modules.js'
export { Templates, Volumes, Snapshots, Billing, Keys, getHealth, getLimits } from './account.js'
export type { BillingPeriod } from './account.js'
export {
  Webhooks,
  verifyWebhookSignature,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOK_SIGNATURE_TOLERANCE_SECONDS,
} from './webhooks.js'
export { Schedules } from './schedules.js'
export type { ScheduledSandboxOptions } from './schedules.js'

/**
 * Re-exported contract types a caller otherwise reaches for constantly. The
 * schemas themselves stay importable from `@corevelos/contract` by anyone who
 * wants them; these are the nouns, not the machinery.
 */
export type {
  FileEntry,
  ProcessInfoDto as ProcessInfo,
  SandboxDto,
  SandboxDetailDto,
  ListSandboxesResponse,
  RunCommandResponse,
  RunCodeResponse as RunCodeResult,
  ExecutionResult,
  SandboxMetrics,
  SandboxLogsResponse,
  LogStreamEvent,
  ProcessOutputStreamEvent,
  CodeStreamEvent,
  SandboxNetworkPolicy,
  SandboxNetworkPolicyInput,
  SandboxNetworkState,
  CreateSnapshotResponse,
  RollbackResponse,
  SnapshotListItem,
  ListSnapshotsResponse,
  TemplateSummary,
  TemplateDetail,
  TemplateBuildJob,
  TemplateBuildStatus,
  TemplateBuildLogs,
  Volume,
  VolumeDetail,
  ListVolumesResponse,
  BillingAccount,
  RateCard,
  UsageSummary,
  UsageBreakdown,
  RunCostSummary,
  UsageInterval,
  ListIntervalsResponse,
  BillingEstimate,
  Invoice,
  ListInvoicesResponse,
  KeyUsageResponse,
  HealthResponse,
  WebhookEndpoint,
  WebhookDelivery,
  WebhookEventPayload,
  WebhookEventType,
  CreateWebhookResponse,
  RotateWebhookResponse,
  ListWebhooksResponse,
  ListWebhookDeliveriesResponse,
  RedeliverWebhookResponse,
  Schedule,
  ListSchedulesResponse,
} from './contract/index.js'

export type { KeyUsageIntervals } from './account.js'

export type { z }
export { Auth } from './auth.js'
export { Projects, Organizations } from './workspaces.js'

export type { SnapshotMode, StorageBackend, RestartPolicy, RestartBackoff, RestartStatus, LivenessProbe, TemplateQos } from './contract/index.js'
