import { z } from 'zod';
import { ProcessOutputResponseSchema } from './processes.js';
import { SandboxLogEntrySchema } from './logs.js';
import { ExecutionResultSchema, RunCodeResponseSchema } from './responses.js';
export const CodeStreamEventSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('stdout'), line: z.string(), timestamp: z.number() }),
    z.object({ type: z.literal('stderr'), line: z.string(), timestamp: z.number() }),
    z.object({ type: z.literal('result'), result: ExecutionResultSchema }),
    z.object({ type: z.literal('execution_error'), error: RunCodeResponseSchema.shape.error.unwrap() }),
    z.object({ type: z.literal('complete'), execution: RunCodeResponseSchema }),
    z.object({ type: z.literal('failure'), error: z.object({ status: z.number().int().min(400).max(599), code: z.string(), message: z.string() }) }),
]);
export type CodeStreamEvent = z.infer<typeof CodeStreamEventSchema>;
export const LogStreamEventSchema = z.discriminatedUnion('type', [
    z
        .object({
        type: z.literal('snapshot'),
        logs: z.array(SandboxLogEntrySchema),
        total: z.number().int().nonnegative(),
        truncated: z.boolean(),
    }),
    z
        .object({
        type: z.literal('log'),
        entry: SandboxLogEntrySchema,
    }),
    z
        .object({ type: z.literal('gone') }),
]);
export type LogStreamEvent = z.infer<typeof LogStreamEventSchema>;
export const ProcessOutputStreamEventSchema = z.discriminatedUnion('type', [
    z
        .object({
        type: z.literal('snapshot'),
        output: ProcessOutputResponseSchema,
    }),
    z
        .object({
        type: z.literal('append'),
        stream: z.enum(['stdout', 'stderr']),
        chunk: z.string(),
    }),
    z
        .object({
        type: z.literal('dropped'),
        chars: z
            .number()
            .int()
            .nonnegative(),
    }),
    z
        .object({
        type: z.literal('exit'),
        exitCode: z.number().int().optional(),
        error: z.string().optional(),
    }),
]);
export type ProcessOutputStreamEvent = z.infer<typeof ProcessOutputStreamEventSchema>;
