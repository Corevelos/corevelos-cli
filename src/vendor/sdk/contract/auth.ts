import { z } from 'zod';
export const AuthUserSchema = z.object({
    id: z
        .string(),
    email: z.string().optional(),
    emailVerified: z.boolean().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    profilePictureUrl: z.string().optional(),
    externalId: z.string().optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    lastSignInAt: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
});
export const AuthSessionSchema = z.object({
    accessToken: z.string(),
    refreshToken: z
        .string(),
    expiresAt: z.string(),
    expiresInSeconds: z
        .number()
        .int(),
    user: AuthUserSchema,
    organizationId: z
        .string()
        .optional(),
    authenticationMethod: z
        .string()
        .optional(),
    impersonator: z
        .object({
        email: z.string(),
        reason: z.string().optional(),
    })
        .optional(),
});
export type AuthSession = z.infer<typeof AuthSessionSchema>;
export const CliDeviceAuthorizationSchema = z.object({
    deviceCode: z.string().min(1).max(512),
    userCode: z.string().min(1),
    verificationUri: z.string().url(),
    verificationUriComplete: z.string().url().optional(),
    expiresIn: z.number().int().positive(),
    interval: z.number().int().positive(),
});
export const CliIdentitySchema = z.object({
    userId: z.string(),
    organizationId: z.string().optional(),
    sessionId: z.string().optional(),
    viaApiKey: z.boolean(),
    role: z.string().optional(),
});
