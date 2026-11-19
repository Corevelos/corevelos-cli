import { z } from 'zod';
export const LogLevelSchema = z
    .enum(['debug', 'info', 'warn', 'error']);
export const SandboxLogEntrySchema = z.object({
    timestamp: z.string(),
    message: z.string(),
    level: LogLevelSchema.optional(),
    fields: z.record(z.string(), z.string()).optional(),
});
export const SandboxLogsResponseSchema = z.object({
    sandboxId: z.string(),
    logs: z.array(SandboxLogEntrySchema),
    total: z.number().int().nonnegative(),
    truncated: z.boolean(),
});
