import { StorageBackendSchema, TemplateQosSchema } from './runtime.js';
import { z } from 'zod';
import { EgressTargetSchema } from './network.js';
import { SandboxIdParamsSchema } from './primitives.js';
export const CreateTemplateFromSandboxBodySchema = z.strictObject({
    sandboxId: SandboxIdParamsSchema.shape.sandboxId,
    name: z.string().min(1).max(128).optional(),
    dockerBuildId: z.uuid().optional(),
    prepared: z.literal(true),
});
export type CreateTemplateFromSandboxBody = z.infer<typeof CreateTemplateFromSandboxBodySchema>;
export const TemplateBuildCapabilitiesSchema = z.strictObject({
    sandboxCapture: z.boolean(),
    ociImport: z.boolean(),
    capturePreservesMemory: z.literal(true),
});
export const TemplateSummarySchema = z.object({
    templateId: z.string(),
    status: z.string(),
    public: z.boolean(),
    aliases: z.array(z.string()),
    kind: z
        .enum(['template', 'snapshot']),
    source: z.enum(['platform', 'user', 'snapshot']).optional(),
    isDefault: z
        .boolean()
        .optional(),
    canManage: z.boolean().optional(),
    createdBy: z.enum(['user', 'velos']).optional(),
    name: z.string().optional(),
    projectId: z.string().optional(),
    instanceType: z.string().optional(),
    version: z.string().optional(),
    image: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    lastError: z.string().optional(),
    jobId: z.string().optional(),
});
export const TemplateDetailSchema = TemplateSummarySchema.extend({
    storageBackend: StorageBackendSchema.optional(),
    configuredQos: TemplateQosSchema.optional(),
    networkType: z.string().optional(),
    allowInternetAccess: z
        .boolean()
        .optional(),
    replicaCount: z
        .number()
        .int()
        .nonnegative()
        .optional(),
    annotations: z
        .record(z.string(), z.string())
        .optional(),
});
export const ListTemplatesQuerySchema = z
    .object({
    kind: z
        .enum(['template', 'snapshot', 'all'])
        .default('template'),
    instanceType: z.string().min(1).max(64).optional(),
    source: z.enum(['platform', 'user', 'all']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
})
    .strict();
export const ListTemplatesResponseSchema = z.object({
    templates: z.array(TemplateSummarySchema),
    nextOffset: z.number().int().nonnegative().optional(),
});
export const DeleteSnapshotResponseSchema = z.object({
    status: z.literal('deleted'),
    snapshotId: z.string(),
});
export const CreateTemplateBodySchema = z
    .object({
    projectId: z.string().min(1).max(128).optional(),
    backend: StorageBackendSchema.optional(),
    user: z.string().min(1).max(256).optional(),
    qos: TemplateQosSchema.optional(),
    image: z
        .string()
        .min(1)
        .max(512)
        .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/, 'must be an OCI image reference'),
    name: z
        .string()
        .min(1)
        .max(128)
        .optional(),
    cpu: z
        .number()
        .int()
        .min(100)
        .max(64000)
        .optional(),
    memory: z
        .number()
        .int()
        .min(128)
        .max(262144)
        .optional(),
    writableLayerSize: z
        .string()
        .regex(/^[1-9][0-9]{0,4}[MG]$/, 'must be a size like "1G" or "512M"')
        .default('1G'),
    env: z
        .record(z.string().min(1).max(128), z.string().max(4096))
        .optional(),
    command: z
        .array(z.string().max(1024))
        .max(64)
        .optional(),
    args: z
        .array(z.string().max(1024))
        .max(64)
        .optional(),
    exposedPorts: z
        .array(z.number().int().min(1).max(65535))
        .max(32)
        .optional(),
    probePort: z
        .number()
        .int()
        .min(1)
        .max(65535)
        .optional(),
    probePath: z
        .string()
        .min(1)
        .max(512)
        .regex(/^\/[\x21-\x7e]*$/, 'must be an absolute path with no spaces or control characters')
        .optional(),
    allowInternetAccess: z
        .boolean()
        .optional(),
    allowOut: z.array(EgressTargetSchema).max(256).optional(),
    denyOut: z.array(EgressTargetSchema).max(256).optional(),
    dns: z
        .array(EgressTargetSchema)
        .max(8)
        .optional(),
    registryUsername: z
        .string()
        .min(1)
        .max(256)
        .optional(),
    registryPassword: z
        .string()
        .min(1)
        .max(4096)
        .optional(),
    instanceType: z
        .string()
        .min(1)
        .max(64)
        .optional(),
})
    .strict()
    .refine((body) => body.probePath === undefined || body.probePort !== undefined, {
    message: 'probePath needs a probePort — a path alone is not a probe',
    path: ['probePath'],
})
    .refine((body) => body.memory === undefined || body.cpu !== undefined, {
    message: 'memory requires cpu',
    path: ['memory'],
})
    .refine((body) => body.registryPassword === undefined || body.registryUsername !== undefined, { message: 'registryPassword needs a registryUsername', path: ['registryPassword'] });
export const RebuildTemplateBodySchema = z.object({}).strict();
export const SetTemplateAliasBodySchema = z
    .object({
    alias: z
        .union([
        z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'must match ^[a-z0-9][a-z0-9-]{0,63}$'),
        z.literal(''),
        z.null(),
    ]),
})
    .strict();
export const TemplateBuildStateSchema = z
    .enum(['queued', 'building', 'ready', 'failed', 'unknown']);
export const TemplateBuildJobSchema = z.object({
    templateId: z.string(),
    buildId: z.string(),
    status: z.string(),
    state: TemplateBuildStateSchema,
    phase: z.string().optional(),
    progress: z.number().int().min(0).max(100),
});
export const TemplateBuildStatusSchema = z.object({
    templateId: z.string(),
    buildId: z.string(),
    status: z.string(),
    state: TemplateBuildStateSchema,
    progress: z.number().int().min(0).max(100),
    message: z
        .string()
        .optional(),
});
export const TemplateBuildLogsSchema = z.object({
    templateId: z.string(),
    buildId: z.string(),
    status: z.string(),
    state: TemplateBuildStateSchema,
    progress: z.number().int().min(0).max(100),
    lines: z
        .array(z.string()),
});
export const DeleteTemplateResponseSchema = z.object({
    status: z.literal('deleted'),
    templateId: z.string(),
});
