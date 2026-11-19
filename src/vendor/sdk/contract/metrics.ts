import { z } from 'zod';
const Percent = z.number().min(0).max(100);
export const CpuMetricsSchema = z.object({
    count: z.number().int().positive().optional(),
    usedPct: Percent.optional(),
});
export const MemoryMetricsSchema = z.object({
    totalMiB: z.number().nonnegative().optional(),
    usedMiB: z.number().nonnegative().optional(),
    availableMiB: z.number().nonnegative().optional(),
    usedPct: Percent.optional(),
});
export const DiskMetricsSchema = z.object({
    path: z.string(),
    totalMiB: z.number().nonnegative().optional(),
    usedMiB: z.number().nonnegative().optional(),
    availableMiB: z.number().nonnegative().optional(),
    usedPct: Percent.optional(),
});
export const LoadMetricsSchema = z.object({
    one: z.number().nonnegative(),
    five: z.number().nonnegative(),
    fifteen: z.number().nonnegative(),
});
export const SandboxMetricsSchema = z.object({
    sandboxId: z.string(),
    source: z.enum(['host', 'guest', 'guest-workload']),
    sampledAt: z.string(),
    sampleWindowMs: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
    cpu: CpuMetricsSchema,
    memory: MemoryMetricsSchema,
    network: z.object({
        ingressBytes: z.number().nonnegative().optional(),
        ingressPackets: z.number().nonnegative().optional(),
        ingressDropBytes: z.number().nonnegative().optional(),
        ingressDropPackets: z.number().nonnegative().optional(),
        egressBytes: z.number().nonnegative().optional(),
        egressPackets: z.number().nonnegative().optional(),
        egressDropBytes: z.number().nonnegative().optional(),
        egressDropPackets: z.number().nonnegative().optional(),
        snatAllocationFailures: z.number().nonnegative().optional(),
    }).optional(),
    disk: DiskMetricsSchema,
    load: LoadMetricsSchema.optional(),
    uptimeSeconds: z.number().nonnegative().optional(),
    processCount: z.number().int().nonnegative().optional(),
    unavailable: z.array(z.string()),
});
