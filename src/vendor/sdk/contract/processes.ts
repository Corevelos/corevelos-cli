import { z } from 'zod';
export const ProcessInfoSchema = z.object({
    pid: z.number().int().positive(),
    cmd: z.string(),
    args: z.array(z.string()),
    envs: z.record(z.string(), z.string()),
    cwd: z.string().optional(),
    tag: z
        .string()
        .optional(),
    captured: z
        .boolean(),
});
export const ListProcessesResponseSchema = z.object({
    processes: z.array(ProcessInfoSchema),
});
export const StartCommandResponseSchema = z.object({
    pid: z.number().int().positive(),
    command: z.string(),
    startedAt: z.string(),
    stdinOpen: z.boolean(),
    captured: z
        .boolean(),
});
export const ProcessOutputResponseSchema = z.object({
    pid: z.number().int().positive(),
    running: z.boolean(),
    stdout: z.string(),
    stderr: z.string(),
    exitCode: z.number().int().optional(),
    error: z.string().optional(),
    truncated: z
        .boolean(),
    droppedChars: z
        .number()
        .int()
        .nonnegative(),
});
export const SendStdinResponseSchema = z.object({
    pid: z.number().int().positive(),
    bytesSent: z.number().int().nonnegative(),
    stdinClosed: z.boolean(),
});
