import { z } from 'zod';
export const NEVER_TIMEOUT = -1 as const;
export interface ContractLimits {
    maxSandboxTimeoutSeconds: number;
    defaultSandboxTimeoutSeconds: number;
    maxCommandTimeoutMs: number;
    defaultCommandTimeoutMs: number;
    defaultCodeTimeoutMs: number;
    bodyLimitBytes: number;
    maxUploadBytes: number;
    maxDownloadBytes: number;
}
export const DEFAULT_LIMITS: ContractLimits = {
    maxSandboxTimeoutSeconds: 3600,
    defaultSandboxTimeoutSeconds: 600,
    maxCommandTimeoutMs: 600000,
    defaultCommandTimeoutMs: 120000,
    defaultCodeTimeoutMs: 120000,
    bodyLimitBytes: 8 * 1024 * 1024,
    maxUploadBytes: 32 * 1024 * 1024,
    maxDownloadBytes: 32 * 1024 * 1024,
};
const ResourceAmountsSchema = z.object({
    concurrentSandboxes: z.number().int().nonnegative(),
    vcpuMilli: z.number().int().nonnegative(),
    memoryMib: z.number().int().nonnegative(),
    storageMib: z.number().int().nonnegative(),
});
export const ResourcePoolCapacitySchema = z.object({
    observedAt: z.iso.datetime(),
    storageAccounting: z.literal('conservative_reservation'),
    limits: ResourceAmountsSchema,
    used: ResourceAmountsSchema,
    held: ResourceAmountsSchema,
    remaining: ResourceAmountsSchema,
    trialVelos: z.object({
        expiresAt: z.iso.datetime(),
        limits: ResourceAmountsSchema, used: ResourceAmountsSchema,
        held: ResourceAmountsSchema, remaining: ResourceAmountsSchema,
    }).optional(),
    admission: z.object({ sandbox: ResourceAmountsSchema, storageResource: ResourceAmountsSchema, fork: ResourceAmountsSchema }),
});
export const LimitsResponseSchema = z.object({
    maxSandboxTimeoutSeconds: z.number().int().positive(),
    defaultSandboxTimeoutSeconds: z.number().int().positive(),
    maxCommandTimeoutMs: z.number().int().positive(),
    defaultCommandTimeoutMs: z.number().int().positive(),
    defaultCodeTimeoutMs: z.number().int().positive(),
    bodyLimitBytes: z.number().int().positive(),
    maxUploadBytes: z.number().int().positive(),
    maxDownloadBytes: z.number().int().positive(),
    resources: ResourcePoolCapacitySchema.optional(),
}) satisfies z.ZodType<ContractLimits>;
