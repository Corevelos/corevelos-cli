import { z } from 'zod';
import { ProjectIdSchema } from './projects.js';
export const VOLUME_NAME_MAX_LENGTH = 128;
export const VolumeNameSchema = z
    .string()
    .min(1)
    .max(VOLUME_NAME_MAX_LENGTH)
    .regex(/^[A-Za-z0-9_-]+$/, 'volume name may only contain letters, digits, underscore and dash');
const SHADOWED_GUEST_DIRECTORIES = [
    '/bin',
    '/boot',
    '/dev',
    '/etc',
    '/lib',
    '/lib32',
    '/lib64',
    '/libx32',
    '/proc',
    '/root',
    '/run',
    '/sbin',
    '/sys',
    '/usr',
    '/var',
] as const;
const KERNEL_FILESYSTEMS = ['/proc', '/sys', '/dev'] as const;
export const VolumeMountPathSchema = z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => value.startsWith('/'), {
    message: 'mount path must be absolute (start with "/")',
})
    .refine((value) => !value.includes('\0'), { message: 'mount path must not contain NUL bytes' })
    .refine((value) => !/[\x01-\x1f\x7f]/.test(value), {
    message: 'mount path must not contain control characters',
})
    .refine((value) => {
    const segments = value.split('/').slice(1);
    return segments.every((segment, index) => segment === '' ? index === segments.length - 1 : segment !== '.' && segment !== '..');
}, { message: 'mount path must be normalised: no ".", ".." or empty segments' })
    .transform((value) => (value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value))
    .refine((value) => value !== '/', {
    message: 'mount path must not be "/" — a volume over the root shadows the whole guest',
})
    .refine((value) => !SHADOWED_GUEST_DIRECTORIES.includes(value as never), {
    message: `mount path must not shadow a guest system directory (${SHADOWED_GUEST_DIRECTORIES.join(', ')})`,
})
    .refine((value) => !KERNEL_FILESYSTEMS.some((root) => value === root || value.startsWith(`${root}/`)), { message: 'mount path must not be inside /proc, /sys or /dev' });
export const VolumeMountInputSchema = z
    .object({
    name: VolumeNameSchema,
    path: VolumeMountPathSchema,
    readOnly: z
        .boolean()
        .optional(),
})
    .strict();
export const MAX_VOLUME_MOUNTS_PER_SANDBOX = 8;
export const VolumeMountListSchema = z
    .array(VolumeMountInputSchema)
    .max(MAX_VOLUME_MOUNTS_PER_SANDBOX)
    .refine((mounts) => new Set(mounts.map((mount) => mount.name)).size === mounts.length, {
    message: 'each volume may be mounted at most once per sandbox',
})
    .refine((mounts) => new Set(mounts.map((mount) => mount.path)).size === mounts.length, {
    message: 'two volumes cannot share one mount path',
});
export const CreateVolumeBodySchema = z
    .object({
    name: VolumeNameSchema.optional(),
    driver: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9][a-z0-9-]*$/, 'driver may only contain lowercase letters, digits and dash')
        .optional(),
    privateData: z.string()
        .refine(value => /^[\u0001-\uD7FF\uE000-\uFFFF]*$/u.test(value), { message: 'privateData must contain only non-NUL BMP characters' })
        .refine(value => [...value].reduce((bytes, char) => bytes + (char.charCodeAt(0) < 128 ? 1 : char.charCodeAt(0) < 2048 ? 2 : 3), 0) <= 1024, { message: 'privateData must be at most 1024 UTF-8 bytes' })
        .optional(),
    projectId: ProjectIdSchema.optional(),
})
    .strict();
export const VolumeSchema = z.object({
    volumeId: z.string(),
    name: z.string(),
    createdAt: z.string().optional(),
    driver: z.string().optional(),
});
export const VolumeDetailSchema = VolumeSchema.extend({
    hasToken: z
        .boolean(),
    mountedBy: z
        .array(z.string()),
});
export const ListVolumesResponseSchema = z.object({
    volumes: z.array(VolumeSchema),
});
export const DeleteVolumeResponseSchema = z.object({
    status: z.literal('deleted'),
    volumeId: z.string(),
});
