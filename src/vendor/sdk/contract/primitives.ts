import { z } from 'zod';
export const SandboxIdParamsSchema = z.object({
    sandboxId: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[A-Za-z0-9._-]+$/, 'sandboxId may only contain letters, digits, dot, dash, underscore')
        .refine((value) => !value.includes('..'), {
        message: 'sandboxId must not contain ".."',
    }),
});
export function boundedIntegerParam(bounds: {
    label: string;
    min?: number;
    max: number;
}) {
    return z
        .union([
        z.number().int(),
        z.string().regex(/^\d+$/, `${bounds.label} must be a whole number`),
    ])
        .transform((value) => Number(value))
        .pipe(z.number().int().min(bounds.min ?? 1).max(bounds.max));
}
export const GuestPathSchema = z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => value.startsWith('/'), { message: 'path must be absolute (start with "/")' })
    .refine((value) => !value.includes('\0'), { message: 'path must not contain NUL bytes' })
    .refine((value) => !value.split('/').includes('..'), {
    message: 'path must not contain ".." segments',
});
const boundedStringMap = (maxKeys: number, maxValueLength: number) => z
    .record(z.string().min(1).max(256), z.string().max(maxValueLength))
    .refine((value) => Object.keys(value).length <= maxKeys, {
    message: `at most ${maxKeys} entries are allowed`,
});
export const MetadataSchema = boundedStringMap(32, 1024);
export const EnvsSchema = boundedStringMap(64, 32768);
export const RunCodeLanguageSchema = z
    .enum(['python', 'javascript', 'typescript', 'r', 'java', 'bash'])
    .default('python');
export const SandboxStateSchema = z.enum(['running', 'paused', 'pausing', 'unknown']);
export const SandboxExposureSchema = z.enum(['public', 'restricted']);
