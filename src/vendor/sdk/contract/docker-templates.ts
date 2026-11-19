import { z } from 'zod';
export const DOCKER_TEMPLATE_MAX_BYTES = 2 * 1024 ** 3;
export const DOCKER_TEMPLATE_CHUNK_BYTES = 4 * 1024 ** 2;
export const DockerTemplateBuildParamsSchema = z.strictObject({
    sandboxId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
    buildId: z.uuid(),
});
export const DockerContextPathSchema = z.string().min(1).max(512).refine(value => !value.startsWith('/') && !/[\\\x00-\x1f\x7f]/.test(value) &&
    value.split('/').every(part => part !== '' && part !== '.' && part !== '..'), 'Use a relative file path without empty, dot, parent, backslash or control-character segments');
const chunk = z.strictObject({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().min(1).max(DOCKER_TEMPLATE_CHUNK_BYTES),
});
const file = z.strictObject({ path: DockerContextPathSchema, chunks: z.array(chunk).max(512), executable: z.boolean().default(false) });
export const PrepareDockerTemplateBodySchema = z.strictObject({
    source: z.enum(['archive', 'context', 'registry']),
    image: z.string().min(1).max(512).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/).optional(),
    dockerfile: DockerContextPathSchema.default('Dockerfile'),
    files: z.array(file).max(2000).default([]),
    reviewed: z.literal(true),
}).superRefine((body, ctx) => {
    const paths = new Set<string>();
    let total = 0, chunks = 0;
    for (const entry of body.files) {
        if (paths.has(entry.path))
            ctx.addIssue({ code: 'custom', message: 'Duplicate input path', path: ['files'] });
        paths.add(entry.path);
        for (const part of entry.chunks) {
            total += part.bytes;
            chunks++;
        }
    }
    for (const path of paths) {
        const parts = path.split('/');
        parts.pop();
        while (parts.length) {
            if (paths.has(parts.join('/')))
                ctx.addIssue({ code: 'custom', message: 'A file cannot also be a directory', path: ['files'] });
            parts.pop();
        }
    }
    if (total > DOCKER_TEMPLATE_MAX_BYTES || chunks > 4096)
        ctx.addIssue({ code: 'custom', message: 'Inputs exceed the 2 GiB or 4096-chunk limit', path: ['files'] });
    if (body.source === 'registry' && (!body.image || body.files.length))
        ctx.addIssue({ code: 'custom', message: 'Registry input needs an image and no uploaded files', path: ['image'] });
    if (body.source === 'archive' && (body.files.length !== 1 || total === 0))
        ctx.addIssue({ code: 'custom', message: 'Select one non-empty docker save archive', path: ['files'] });
    if (body.source === 'context' && !paths.has(body.dockerfile))
        ctx.addIssue({ code: 'custom', message: 'Dockerfile is missing from the selected context', path: ['dockerfile'] });
});
export const DockerTemplatePreparationSchema = z.strictObject({
    sandboxId: z.string(),
    buildId: z.uuid(),
    state: z.enum(['queued', 'building', 'ready', 'failed']),
    phase: z.string().max(128),
    message: z.string().max(1024).optional(),
    imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
    log: z.string().max(16384),
});
export type DockerTemplatePreparation = z.infer<typeof DockerTemplatePreparationSchema>;
