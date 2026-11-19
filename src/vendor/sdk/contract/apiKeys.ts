import { z } from 'zod';
import { ListIntervalsResponseSchema, SubjectIdSchema, UsageSummarySchema } from './billing.js';
import { ProjectIdSchema } from './projects.js';
export const API_KEY_ID_LENGTH = 10;
export const API_KEY_SECRET_LENGTH = 43;
export const API_KEY_TOKEN_REGEX = new RegExp(`^cv_[A-Za-z0-9]{${API_KEY_ID_LENGTH}}_[A-Za-z0-9]{${API_KEY_SECRET_LENGTH}}$`);
export const isApiKeyToken = (value: string): boolean => API_KEY_TOKEN_REGEX.test(value);
export const ApiKeyNameSchema = z
    .string()
    .min(1)
    .max(100)
    .refine((value) => !value.includes('\0'), { message: 'key name must not contain NUL bytes' });
export const CreateApiKeyBodySchema = z
    .object({
    name: ApiKeyNameSchema,
    aiAccess: z.boolean().optional(),
    projectId: ProjectIdSchema.optional(),
})
    .strict();
export const ApiKeyInfoSchema = z.object({
    keyId: z.string(),
    name: z.string(),
    category: z.enum(['general', 'velos-agent']).default('general'),
    aiAccess: z.boolean().default(false),
    managed: z.boolean().default(false),
    projectId: ProjectIdSchema.nullable(),
    createdAt: z.string(),
    lastUsedAt: z
        .string()
        .nullable(),
    revokedAt: z
        .string()
        .nullable(),
});
export const CreateApiKeyResponseSchema = ApiKeyInfoSchema.extend({
    key: z
        .string()
        .regex(API_KEY_TOKEN_REGEX),
});
export const ListApiKeysResponseSchema = z.object({
    keys: z.array(ApiKeyInfoSchema),
});
export const RevokeApiKeyResponseSchema = z.object({
    status: z.literal('revoked'),
    keyId: z.string(),
});
export const KeyUsageResponseSchema = z.object({
    keyId: z.string(),
    subjectId: SubjectIdSchema,
    usage: UsageSummarySchema,
});
export const KeyUsageIntervalsResponseSchema = ListIntervalsResponseSchema;
