import { SnapshotModeSchema, RestartStatusSchema, TemplateQosSchema } from './runtime.js';
import { z } from 'zod';
import { SandboxStateSchema } from './primitives.js';
import { SandboxExposureSchema } from './primitives.js';
export const VolumeMountSchema = z.object({
    name: z.string(),
    path: z.string(),
    readOnly: z.boolean().optional(),
});
export const SandboxSchema = z.object({
    sandboxId: z.string(),
    template: z.string(),
    state: SandboxStateSchema,
    restartStatus: RestartStatusSchema.optional(),
    metadata: z
        .record(z.string(), z.string()),
    startedAt: z.string(),
    timeoutSeconds: z.number().int().refine((value) => value === -1 || value > 0).optional(),
    endAt: z
        .string()
        .optional(),
    envdVersion: z.string().optional(),
    cpuCount: z.number().int().optional(),
    memoryMB: z.number().int().optional(),
    alias: z.string().optional(),
    allowInternetAccess: z
        .boolean()
        .optional(),
    autoPause: z
        .boolean()
        .optional(),
    autoResume: z
        .boolean()
        .optional(),
    domain: z
        .string()
        .optional(),
    exposure: z
        .enum(['public', 'restricted'])
        .optional(),
    projectId: z
        .string()
        .optional(),
    volumeMounts: z.array(VolumeMountSchema).optional(),
});
export const SandboxDetailSchema = SandboxSchema.extend({
    configuredQos: TemplateQosSchema.optional(),
    cpuMilli: z
        .number()
        .int()
        .optional(),
    diskSizeMB: z.number().int().optional(),
    clientId: z
        .string()
        .optional(),
});
export const CreateSandboxResponseSchema = SandboxSchema.extend({
    trafficAccessToken: z
        .string()
        .optional(),
});
export const PreviewUrlsResponseSchema = z.object({
    sandboxId: z.string(),
    domain: z.string(),
    exposure: SandboxExposureSchema,
    trafficAccessToken: z
        .string()
        .optional(),
});
export const SandboxActivityCountsSchema = z.object({
    unknown: z.number().int().nonnegative().optional(),
    running: z.number().int().nonnegative(),
    paused: z.number().int().nonnegative(),
    pausing: z.number().int().nonnegative(),
});
export const SandboxActivitySchema = z.object({
    workspace: z.object({ kind: z.enum(['personal', 'organization', 'project']), id: z.string().min(1) }),
    observedAt: z.string().datetime(),
    mine: SandboxActivityCountsSchema,
    organization: SandboxActivityCountsSchema.optional(),
});
export const ListSandboxesResponseSchema = z.object({
    sandboxes: z.array(SandboxSchema),
    activity: SandboxActivitySchema.optional(),
    nextToken: z
        .string()
        .optional(),
});
export const RunCommandResponseSchema = z.object({
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number().int(),
    error: z.string().optional(),
    durationMs: z.number().int().nonnegative(),
});
export const ExecutionResultSchema = z.object({
    isMainResult: z.boolean(),
    formats: z.array(z.string()),
    text: z.string().optional(),
    html: z.string().optional(),
    markdown: z.string().optional(),
    svg: z.string().optional(),
    png: z.string().optional(),
    jpeg: z.string().optional(),
    pdf: z.string().optional(),
    latex: z.string().optional(),
    json: z.string().optional(),
    javascript: z.string().optional(),
    chart: z.unknown().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
});
export const RunCodeResponseSchema = z.object({
    text: z.string().optional(),
    results: z.array(ExecutionResultSchema),
    logs: z.object({ stdout: z.array(z.string()), stderr: z.array(z.string()) }),
    error: z
        .object({ name: z.string(), value: z.string(), traceback: z.string() })
        .optional(),
    executionCount: z.number().int().optional(),
    durationMs: z.number().int().nonnegative(),
});
export const WriteFileResponseSchema = z.object({
    path: z.string(),
    name: z.string(),
    bytesWritten: z.number().int().nonnegative(),
});
export const ReadFileResponseSchema = z.object({
    path: z.string(),
    content: z.string(),
    bytes: z.number().int().nonnegative(),
});
export const CreateSnapshotResponseSchema = z.object({
    snapshotId: z.string(),
    mode: SnapshotModeSchema.optional(),
    names: z.array(z.string()).optional(),
    backend: z.string().optional(),
    remoteStatus: z.string().optional(),
});
export const RollbackResponseSchema = z.object({
    status: z.literal('restored'),
    sandboxId: z.string(),
    snapshotId: z.string(),
    operationId: z.string().optional(),
    upstreamStatus: z.string().optional(),
});
export const PauseResponseSchema = z.object({
    status: z.literal('paused'),
    sandboxId: z.string(),
});
export const ResumeResponseSchema = z.object({
    status: z.literal('running'),
    sandboxId: z.string(),
    template: z.string().optional(),
    envdVersion: z.string().optional(),
    timeoutSeconds: z.number().int().refine((value) => value === -1 || value > 0).optional(),
    endAt: z.string().optional(),
});
export const SandboxRefreshResponseSchema = z.object({
    sandboxId: z.string(),
    appliedSeconds: z.number().int().refine((value) => value === -1 || value > 0),
    clamped: z.boolean(),
    previousEndAt: z.string().optional(),
    endAt: z.string().optional(),
    remainingSeconds: z.number().int().optional(),
});
export const ForkSandboxResponseSchema = SandboxSchema.extend({
    forkedFrom: z
        .object({
        sandboxId: z.string(),
        snapshotId: z.string(),
        snapshotNames: z.array(z.string()).optional(),
        createdAt: z.string(),
    }),
    trafficAccessToken: z
        .string()
        .optional(),
});
export const SnapshotListItemSchema = z.object({
    snapshotId: z.string(),
    mode: SnapshotModeSchema.optional(),
    names: z.array(z.string()),
    status: z.string(),
    originSandboxId: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    backend: z.string().optional(),
    remoteStatus: z.string().optional(),
});
export const ListSnapshotsResponseSchema = z.object({
    snapshots: z.array(SnapshotListItemSchema),
    nextToken: z.string().optional(),
});
export const CanarySnapshotSchema = z.object({
    state: z.enum(['ok', 'failing', 'throttled', 'unknown']),
    consecutiveFailures: z.number().int().nonnegative(),
    checkedAt: z.string().optional(),
    lastSuccessAt: z.string().optional(),
    lastFailureAt: z.string().optional(),
    durationMs: z.number().nonnegative().optional(),
    stage: z.enum(['create', 'exec', 'egress', 'write', 'read', 'kill']).optional(),
    error: z.string().optional(),
});
export const HealthResponseSchema = z.object({
    status: z.enum(['ok', 'degraded']),
    service: z.string(),
    version: z.string(),
    uptimeSeconds: z.number().nonnegative(),
    cube: z.object({
        reachable: z.boolean(),
        apiUrl: z.string(),
        latencyMs: z.number().nonnegative().optional(),
        error: z.string().optional(),
    }),
    canary: CanarySnapshotSchema.optional(),
});
export const ErrorResponseSchema = z.object({
    error: z.object({
        code: z.string(),
        message: z.string(),
        details: z.unknown().optional(),
    }),
});
export const ExposedPortEndpointSchema = z.object({
    sandboxId: z.string(), containerPort: z.number().int(), mode: z.string(), endpoint: z.string(),
    hostIP: z.string().optional(), hostPort: z.number().int().optional(), sandboxIP: z.string().optional(),
});
