import { z } from 'zod';
const WorkOsOrganizationIdSchema = z
    .string()
    .regex(/^org_[A-Za-z0-9]+$/, 'must be a WorkOS organization id');
const WorkOsUserIdSchema = z
    .string()
    .regex(/^user_[A-Za-z0-9]+$/, 'must be a WorkOS user id');
const WorkOsMembershipIdSchema = z
    .string()
    .regex(/^om_[A-Za-z0-9]+$/, 'must be a WorkOS organization membership id');
const WorkOsInvitationIdSchema = z
    .string()
    .regex(/^invitation_[A-Za-z0-9]+$/, 'must be a WorkOS invitation id');
export const PlanTierSchema = z.enum(['developer', 'business', 'enterprise']);
export const AccountPlanSchema = z.object({
    subjectId: z.string().min(1),
    subjectType: z.enum(['personal', 'organization']),
    tier: PlanTierSchema,
    name: z.enum(['Developer', 'Business', 'Enterprise']),
    source: z.enum(['personal_default', 'organization_metadata', 'organization_default']),
    entitlements: z.object({
        organizationWorkspace: z.boolean(),
        memberManagement: z.boolean(),
        enterpriseIdentity: z.boolean(),
    }),
});
export const AssignableOrganizationRoleSchema = z.enum(['member', 'billing', 'admin']);
export const OrganizationMemberSchema = z.object({
    membershipId: WorkOsMembershipIdSchema,
    userId: WorkOsUserIdSchema,
    email: z.string().email().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    role: z.string().min(1),
    roles: z.array(z.string().min(1)),
    joinedAt: z.string(),
});
export const OrganizationInvitationSchema = z.object({
    invitationId: WorkOsInvitationIdSchema,
    email: z.string().email(),
    role: z.string().nullable(),
    state: z.enum(['pending', 'accepted', 'expired', 'revoked']),
    expiresAt: z.string(),
    createdAt: z.string(),
});
export const OrganizationContextSchema = z.object({
    organization: z.object({
        id: WorkOsOrganizationIdSchema,
        name: z.string().min(1),
    }),
    plan: AccountPlanSchema,
    membership: z.object({
        id: WorkOsMembershipIdSchema,
        role: z.string().min(1),
        roles: z.array(z.string().min(1)),
    }),
    canManageMembers: z.boolean(),
    canManageBilling: z.boolean(),
    canViewBilling: z.boolean(),
});
export const OrganizationPageQuerySchema = z
    .object({
    after: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
})
    .strict();
export const ListOrganizationMembersResponseSchema = z.object({
    items: z.array(OrganizationMemberSchema),
    nextToken: z.string().optional(),
});
export const ListOrganizationInvitationsResponseSchema = z.object({
    items: z.array(OrganizationInvitationSchema),
    nextToken: z.string().optional(),
});
export const SendOrganizationInvitationBodySchema = z
    .object({
    email: z.string().trim().toLowerCase().email().max(254),
    role: AssignableOrganizationRoleSchema.default('member'),
})
    .strict();
export const CreateOrganizationBodySchema = z
    .object({
    name: z.string().trim().min(2).max(100),
})
    .strict();
export const UpdateOrganizationBodySchema = z
    .object({
    name: z.string().trim().min(2).max(100),
})
    .strict();
export const UpdateOrganizationMemberBodySchema = z
    .object({ role: AssignableOrganizationRoleSchema })
    .strict();
export const TransferOrganizationOwnershipBodySchema = z
    .object({
    membershipId: WorkOsMembershipIdSchema,
    confirmation: z.string().trim().min(1).max(100),
})
    .strict();
export const OrganizationMembershipIdParamsSchema = z.object({
    membershipId: WorkOsMembershipIdSchema,
});
export const OrganizationInvitationIdParamsSchema = z.object({
    invitationId: WorkOsInvitationIdSchema,
});
export type SendOrganizationInvitationBody = z.infer<typeof SendOrganizationInvitationBodySchema>;
export type UpdateOrganizationMemberBody = z.infer<typeof UpdateOrganizationMemberBodySchema>;
export type TransferOrganizationOwnershipBody = z.infer<typeof TransferOrganizationOwnershipBodySchema>;
