import { z } from 'zod';
import { boundedIntegerParam } from './primitives.js';
export const PTY_SUBPROTOCOL = 'corevelos.pty.v1';
export const PTY_BEARER_SUBPROTOCOL_PREFIX = 'corevelos.bearer.';
const ColsSchema = boundedIntegerParam({ label: 'cols', max: 2000 });
const RowsSchema = boundedIntegerParam({ label: 'rows', max: 2000 });
export const PtyInputMessageSchema = z
    .object({
    type: z.literal('input'),
    data: z
        .string()
        .max(65536),
})
    .strict();
export const PtyResizeMessageSchema = z
    .object({ type: z.literal('resize'), cols: ColsSchema, rows: RowsSchema })
    .strict();
export const PtyKillMessageSchema = z.object({ type: z.literal('kill') }).strict();
export const PtyDetachMessageSchema = z.object({ type: z.literal('detach') }).strict();
export const PtyPingMessageSchema = z.object({ type: z.literal('ping') }).strict();
export const PtyClientMessageSchema = z.discriminatedUnion('type', [
    PtyInputMessageSchema,
    PtyResizeMessageSchema,
    PtyKillMessageSchema,
    PtyDetachMessageSchema,
    PtyPingMessageSchema,
]);
export const PtyReadyMessageSchema = z
    .object({
    type: z.literal('ready'),
    pid: z.number().int().positive(),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional(),
    reattached: z.boolean(),
})
    .strict();
export const PtyExitMessageSchema = z
    .object({
    type: z.literal('exit'),
    exitCode: z.number().int().optional(),
    error: z.string().optional(),
})
    .strict();
export const PtyErrorMessageSchema = z
    .object({ type: z.literal('error'), code: z.string(), message: z.string() })
    .strict();
export const PtyPongMessageSchema = z.object({ type: z.literal('pong') }).strict();
export const PtyServerMessageSchema = z.discriminatedUnion('type', [
    PtyReadyMessageSchema,
    PtyExitMessageSchema,
    PtyErrorMessageSchema,
    PtyPongMessageSchema,
]);
