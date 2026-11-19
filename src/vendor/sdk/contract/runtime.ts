import { z } from 'zod';
export const SnapshotModeSchema = z.enum(['full', 'fs-only']);
export const StorageBackendSchema = z.enum(['xfs', 's3', 'jfs']);
export const RestartPolicySchema = z.enum(['Never', 'OnFailure', 'Always']);
const timing = z.number().int().min(0).max(2147483647).optional();
export const RestartBackoffSchema = z.strictObject({
    initialIntervalSecond: timing, maxIntervalSecond: timing, stableDurationSecond: timing,
    maxRestarts: timing, multiplier: z.number().nonnegative().optional(), jitter: z.number().min(0).max(1).optional(),
});
const port = z.number().int().min(1).max(65535);
export const LivenessProbeSchema = z.strictObject({
    httpGet: z.strictObject({ path: z.string().regex(/^(?:$|\/(?!\/)[^\r\n]*)$/).optional(), port }).optional(),
    tcpSocket: z.strictObject({ port }).optional(),
    initialDelaySecond: timing, periodSecond: timing, probeTimeoutSecond: timing, failureThreshold: timing,
}).refine(value => Number(value.httpGet !== undefined) + Number(value.tcpSocket !== undefined) === 1, { message: 'Exactly one of httpGet and tcpSocket is required' });
export const RestartStatusSchema = z.object({
    restartPolicy: RestartPolicySchema, restartState: z.string(), restartCount: z.number().int().nonnegative(),
    lastExitCode: z.number().int().optional(), lastExitReason: z.string().optional(), lastFinishedAt: z.string().optional(),
    lastRestartAt: z.string().optional(), lastSuccessfulRestartAt: z.string().optional(),
    lastFailedRestartAt: z.string().optional(), nextRestartAt: z.string().optional(),
});
const limit = z.number().int().positive().max(4294967295).optional();
const network = z.strictObject({ bandwidthMbps: limit, packetsPerSecond: limit })
    .refine(value => Object.values(value).some(item => item !== undefined), { message: 'At least one network ceiling is required' });
const blockIo = z.strictObject({ throughputMiBps: limit, iops: limit })
    .refine(value => Object.values(value).some(item => item !== undefined), { message: 'At least one block I/O ceiling is required' });
export const TemplateQosSchema = z.strictObject({ network: network.optional(), blockIo: blockIo.optional() })
    .refine(value => value.network !== undefined || value.blockIo !== undefined, { message: 'At least one QoS section is required' });
export type SnapshotMode = z.infer<typeof SnapshotModeSchema>;
export type StorageBackend = z.infer<typeof StorageBackendSchema>;
export type RestartPolicy = z.infer<typeof RestartPolicySchema>;
export type RestartBackoff = z.infer<typeof RestartBackoffSchema>;
export type LivenessProbe = z.infer<typeof LivenessProbeSchema>;
export type RestartStatus = z.infer<typeof RestartStatusSchema>;
export type TemplateQos = z.infer<typeof TemplateQosSchema>;
