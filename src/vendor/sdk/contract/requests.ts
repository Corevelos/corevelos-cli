import { SnapshotModeSchema, StorageBackendSchema, RestartPolicySchema, RestartBackoffSchema, LivenessProbeSchema } from './runtime.js';
import { z } from 'zod';
import type { ContractLimits } from './limits.js';
import { CronExpressionSchema } from './schedules.js';
import { SandboxNetworkPolicySchema } from './network.js';
import { VolumeMountListSchema } from './volumes.js';
import { ProjectIdSchema } from './projects.js';
import { boundedIntegerParam, EnvsSchema, GuestPathSchema, MetadataSchema, RunCodeLanguageSchema, SandboxStateSchema } from './primitives.js';
export function createRequestSchemas(limits: ContractLimits) {
    const sandboxLifetime = z.coerce.number().int().pipe(z.union([
        z.literal(-1),
        z.number().int().positive().max(limits.maxSandboxTimeoutSeconds),
    ]));
    const CreateSandboxBodySchema = z
        .object({
        template: z
            .string()
            .min(1)
            .max(256)
            .optional(),
        timeoutSeconds: sandboxLifetime
            .default(limits.defaultSandboxTimeoutSeconds),
        metadata: MetadataSchema.optional(),
        envs: EnvsSchema.optional(),
        network: SandboxNetworkPolicySchema.optional(),
        volumeMounts: VolumeMountListSchema.optional(),
        backend: StorageBackendSchema.optional(),
        restartPolicy: RestartPolicySchema.optional(),
        restartBackoff: RestartBackoffSchema.optional(),
        livenessProbe: LivenessProbeSchema.optional(),
        autoPauseMemory: z.literal(true).optional(),
        autoPause: z
            .boolean()
            .optional(),
        autoResume: z
            .boolean()
            .optional(),
        exposure: z
            .enum(['public', 'restricted'])
            .default('restricted'),
        projectId: ProjectIdSchema.optional(),
    })
        .strict()
        .refine(body => body.livenessProbe === undefined || (body.restartPolicy !== undefined && body.restartPolicy !== 'Never'), { message: 'A liveness probe requires OnFailure or Always restartPolicy', path: ['livenessProbe'] })
        .refine((body) => body.autoResume !== true || body.autoPause === true, {
        message: 'autoResume requires autoPause: true — a killed sandbox cannot be woken',
        path: ['autoResume'],
    });
    const RunCommandBodySchema = z
        .object({
        command: z.string().min(1).max(65536),
        cwd: GuestPathSchema.optional(),
        envs: EnvsSchema.optional(),
        timeoutMs: z.coerce
            .number()
            .int()
            .positive()
            .max(limits.maxCommandTimeoutMs)
            .default(limits.defaultCommandTimeoutMs),
        background: z
            .boolean()
            .default(false),
        stdin: z
            .boolean()
            .default(false),
    })
        .strict()
        .refine((body) => !body.stdin || body.background, {
        message: 'stdin is only meaningful with background: true',
        path: ['stdin'],
    });
    const RunCodeBodySchema = z
        .object({
        code: z.string().min(1).max(1000000),
        language: RunCodeLanguageSchema,
        envs: EnvsSchema.optional(),
        timeoutMs: z.coerce
            .number()
            .int()
            .positive()
            .max(limits.maxCommandTimeoutMs)
            .default(limits.defaultCodeTimeoutMs),
    })
        .strict();
    const WriteFileBodySchema = z
        .object({
        path: GuestPathSchema,
        content: z.string().max(limits.bodyLimitBytes),
    })
        .strict();
    const ResumeBodySchema = z
        .object({
        timeoutSeconds: sandboxLifetime
            .optional(),
        autoPause: z.boolean().optional(),
    })
        .strict();
    const SetTimeoutBodySchema = z
        .object({
        timeoutSeconds: sandboxLifetime,
    })
        .strict();
    const ForkSandboxBodySchema = z
        .object({
        timeoutSeconds: sandboxLifetime
            .default(limits.defaultSandboxTimeoutSeconds),
        metadata: MetadataSchema.optional(),
        network: SandboxNetworkPolicySchema.optional(),
        snapshotName: z.string().min(1).max(128).regex(/^(?!tpl-|snap-)/, 'Snapshot names must not start with tpl- or snap-').optional(),
        snapshotMode: SnapshotModeSchema.optional(),
    })
        .strict();
    const RefreshBodySchema = z
        .object({
        extendBySeconds: z.coerce
            .number()
            .int()
            .positive()
            .max(limits.maxSandboxTimeoutSeconds)
            .optional(),
    })
        .strict();
    const PtyQuerySchema = z
        .object({
        cols: boundedIntegerParam({ label: 'cols', max: 2000 })
            .optional(),
        rows: boundedIntegerParam({ label: 'rows', max: 2000 })
            .optional(),
        pid: boundedIntegerParam({ label: 'pid', max: 4194304 })
            .optional(),
        cwd: GuestPathSchema.optional(),
        timeoutMs: boundedIntegerParam({
            label: 'timeoutMs',
            min: 1000,
            max: limits.maxSandboxTimeoutSeconds * 1000,
        })
            .default(limits.defaultSandboxTimeoutSeconds * 1000),
    })
        .strict()
        .refine((query) => (query.cols === undefined) === (query.rows === undefined), {
        message: 'cols and rows must be sent together',
        path: ['cols'],
    });
    const CreateScheduleBodySchema = z
        .object({
        name: z.string().min(1).max(200).optional(),
        cron: CronExpressionSchema,
        sandbox: CreateSandboxBodySchema,
        enabled: z
            .boolean()
            .default(true),
    })
        .strict();
    const UpdateScheduleBodySchema = z
        .object({
        name: z.string().min(1).max(200).optional(),
        cron: CronExpressionSchema.optional(),
        enabled: z.boolean().optional(),
        sandbox: CreateSandboxBodySchema.optional(),
    })
        .strict()
        .refine((body) => body.name !== undefined || body.cron !== undefined || body.enabled !== undefined || body.sandbox !== undefined, {
        message: 'nothing to update: set at least one of name, cron, enabled, sandbox',
    });
    return {
        CreateSandboxBodySchema,
        RunCommandBodySchema,
        RunCodeBodySchema,
        WriteFileBodySchema,
        ResumeBodySchema,
        SetTimeoutBodySchema,
        RefreshBodySchema,
        ForkSandboxBodySchema,
        PtyQuerySchema,
        CreateScheduleBodySchema,
        UpdateScheduleBodySchema,
    };
}
export const IdempotencyKeySchema = z
    .string()
    .min(8)
    .max(255);
const MetadataFilterSchema = z
    .string()
    .max(2048)
    .transform((value, ctx) => {
    const pairs: Record<string, string> = {};
    for (const part of value.split(',')) {
        if (part.length === 0)
            continue;
        const separator = part.indexOf('=');
        if (separator <= 0) {
            ctx.addIssue({
                code: 'custom',
                message: `"${part}" is not a key=value pair`,
            });
            return z.NEVER;
        }
        pairs[part.slice(0, separator)] = part.slice(separator + 1);
    }
    return pairs;
});
export const ListSandboxesQuerySchema = z
    .object({
    state: SandboxStateSchema.optional(),
    projectId: ProjectIdSchema.optional(),
    metadata: MetadataFilterSchema.optional(),
    limit: z
        .union([z.number().int(), z.string().regex(/^\d+$/, 'limit must be a whole number')])
        .transform((value) => Number(value))
        .pipe(z.number().int().positive().max(100))
        .default(50),
    nextToken: z
        .string()
        .min(1)
        .max(512)
        .optional(),
})
    .strict();
export const ListSnapshotsQuerySchema = z
    .object({
    sandboxId: z.string().min(1).max(128).optional(),
    name: z.string().min(1).max(256).optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    nextToken: z.string().min(1).max(4096).optional(),
    backend: z.string().min(1).max(64).optional(),
})
    .strict();
