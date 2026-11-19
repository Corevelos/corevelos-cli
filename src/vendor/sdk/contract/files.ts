import { z } from 'zod';
export const FileTypeSchema = z.enum(['file', 'dir', 'symlink']);
export const FileEntrySchema = z.object({
    name: z.string(),
    path: z.string(),
    type: FileTypeSchema.optional(),
    size: z.number().int().nonnegative(),
    mode: z.number().int(),
    permissions: z.string(),
    owner: z.string(),
    group: z.string(),
    modifiedTime: z.string().optional(),
    symlinkTarget: z
        .string()
        .optional(),
});
export const ListFilesResponseSchema = z.object({
    path: z.string(),
    entries: z.array(FileEntrySchema),
});
export const FileExistsResponseSchema = z.object({
    path: z.string(),
    exists: z.boolean(),
});
export const MakeDirResponseSchema = z.object({
    path: z.string(),
    created: z
        .boolean(),
});
export const MoveFileResponseSchema = z.object({
    from: z.string(),
    entry: FileEntrySchema,
});
