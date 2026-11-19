import { z } from 'zod';
export const WorkspaceKindSchema = z.enum(['personal', 'organization']);
export const ProjectIdSchema = z.string().regex(/^proj_[a-z0-9]+$/, 'must be a project id');
export const ProjectSlugSchema = z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'must be a lowercase DNS-label slug');
export const ProjectRoleSchema = z.enum(['member', 'admin']);
export const ProjectLimitsSchema = z
    .object({
    maxConcurrentSandboxes: z.number().int().min(0).nullish(),
    monthlySpendCapMicros: z.number().int().min(0).nullish(),
})
    .strict();
export const ProjectSchema = z.object({
    id: ProjectIdSchema,
    workspaceKind: WorkspaceKindSchema,
    workspaceId: z.string().min(1),
    slug: ProjectSlugSchema,
    name: z.string().min(1),
    isDefault: z.boolean(),
    limits: ProjectLimitsSchema,
    archivedAt: z.string().nullable(),
    createdAt: z.string(),
});
export const ProjectMemberSchema = z.object({
    projectId: ProjectIdSchema,
    userSub: z.string().min(1),
    role: ProjectRoleSchema,
    addedAt: z.string(),
});
export const WorkspaceSummarySchema = z.object({
    kind: WorkspaceKindSchema,
    id: z.string().min(1),
    name: z.string().min(1),
    role: z.string().min(1).optional(),
    projectCount: z.number().int().min(0),
});
export const CreateProjectBodySchema = z
    .object({
    name: z.string().trim().min(2).max(100),
    slug: ProjectSlugSchema.optional(),
    limits: ProjectLimitsSchema.optional(),
})
    .strict();
export const UpdateProjectBodySchema = z
    .object({
    name: z.string().trim().min(2).max(100).optional(),
    limits: ProjectLimitsSchema.optional(),
})
    .strict();
export const AddProjectMemberBodySchema = z
    .object({
    userId: z.string().min(1),
    role: ProjectRoleSchema.default('member'),
})
    .strict();
export const ListProjectsResponseSchema = z.object({ items: z.array(ProjectSchema) });
export const ListWorkspacesResponseSchema = z.object({ items: z.array(WorkspaceSummarySchema) });
export const ListProjectMembersResponseSchema = z.object({ items: z.array(ProjectMemberSchema) });
export type CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;
export type UpdateProjectBody = z.infer<typeof UpdateProjectBodySchema>;
export type AddProjectMemberBodyInput = z.input<typeof AddProjectMemberBodySchema>;
