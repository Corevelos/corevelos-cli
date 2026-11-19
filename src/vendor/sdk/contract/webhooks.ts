import { z } from 'zod';
import { IsoTimestampSchema, SubjectIdSchema } from './billing.js';
import { ProjectIdSchema } from './projects.js';
export const WEBHOOK_EVENT_TYPES = [
    'sandbox.created',
    'sandbox.paused',
    'sandbox.resumed',
    'sandbox.killed',
    'sandbox.timed_out',
    'snapshot.created',
    'schedule.fired',
    'schedule.failed',
] as const;
export const WebhookEventTypeSchema = z.enum(WEBHOOK_EVENT_TYPES);
export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>;
export const WebhookEventPayloadSchema = z.object({
    id: z.string().regex(/^evt_[A-Za-z0-9]{16}$/),
    type: WebhookEventTypeSchema,
    createdAt: IsoTimestampSchema,
    subjectId: SubjectIdSchema,
    data: z.record(z.string(), z.unknown()),
});
export type WebhookEventPayload = z.infer<typeof WebhookEventPayloadSchema>;
export const WEBHOOK_SECRET_REGEX = /^whsec_[A-Za-z0-9]{43}$/;
export const WebhookUrlSchema = z
    .string()
    .url()
    .refine((value) => value.startsWith('https://') || value.startsWith('http://'), {
    message: 'webhook URL must be http(s)',
})
    .max(2048);
export const WebhookDescriptionSchema = z
    .string()
    .min(1)
    .max(200);
export const CreateWebhookBodySchema = z
    .object({
    url: WebhookUrlSchema,
    events: z
        .array(WebhookEventTypeSchema)
        .min(1, 'subscribe to at least one event type')
        .max(WEBHOOK_EVENT_TYPES.length)
        .refine((events) => new Set(events).size === events.length, {
        message: 'duplicate event type in subscription',
    }),
    description: WebhookDescriptionSchema.optional(),
    projectId: ProjectIdSchema.optional(),
})
    .strict();
export const UpdateWebhookBodySchema = z
    .object({
    url: WebhookUrlSchema.optional(),
    events: z
        .array(WebhookEventTypeSchema)
        .min(1, 'subscribe to at least one event type')
        .max(WEBHOOK_EVENT_TYPES.length)
        .refine((events) => new Set(events).size === events.length, {
        message: 'duplicate event type in subscription',
    })
        .optional(),
    description: WebhookDescriptionSchema.nullable()
        .optional(),
})
    .strict()
    .refine((body) => body.url !== undefined || body.events !== undefined || body.description !== undefined, {
    message: 'nothing to update: set at least one of url, events, description',
});
export const WebhookEndpointSchema = z.object({
    webhookId: z.string(),
    url: z.string(),
    events: z.array(WebhookEventTypeSchema),
    description: z.string().nullable(),
    projectId: ProjectIdSchema.nullable(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
});
export type WebhookEndpoint = z.infer<typeof WebhookEndpointSchema>;
export const CreateWebhookResponseSchema = WebhookEndpointSchema.extend({
    secret: z
        .string()
        .regex(WEBHOOK_SECRET_REGEX),
});
export type CreateWebhookResponse = z.infer<typeof CreateWebhookResponseSchema>;
export const RotateWebhookResponseSchema = z.object({
    webhookId: z.string(),
    secret: z
        .string()
        .regex(WEBHOOK_SECRET_REGEX),
});
export type RotateWebhookResponse = z.infer<typeof RotateWebhookResponseSchema>;
export const ListWebhooksResponseSchema = z.object({
    webhooks: z.array(WebhookEndpointSchema),
});
export type ListWebhooksResponse = z.infer<typeof ListWebhooksResponseSchema>;
export const WebhookDeliveryStatusSchema = z.enum(['pending', 'delivered', 'failed']);
export const WebhookDeliverySchema = z.object({
    deliveryId: z.string(),
    webhookId: z.string(),
    eventId: z.string(),
    eventType: WebhookEventTypeSchema,
    status: WebhookDeliveryStatusSchema,
    attempts: z.number().int().min(0),
    lastResponseStatus: z
        .number()
        .int()
        .nullable(),
    lastError: z
        .string()
        .nullable(),
    createdAt: IsoTimestampSchema,
    deliveredAt: IsoTimestampSchema.nullable(),
    nextAttemptAt: IsoTimestampSchema.nullable(),
});
export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;
export const ListWebhookDeliveriesResponseSchema = z.object({
    deliveries: z.array(WebhookDeliverySchema),
    nextCursor: z.string().optional(),
});
export type ListWebhookDeliveriesResponse = z.infer<typeof ListWebhookDeliveriesResponseSchema>;
export const RedeliverWebhookResponseSchema = z.object({
    deliveryId: z.string(),
    status: z.literal('queued'),
});
export type RedeliverWebhookResponse = z.infer<typeof RedeliverWebhookResponseSchema>;
