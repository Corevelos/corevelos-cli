import { z } from 'zod';
export const EGRESS_AUDIT_LEVELS = ['full', 'metadata', 'none'] as const;
export const EgressAuditLevelSchema = z.enum(EGRESS_AUDIT_LEVELS);
export const EgressMatchMethodSchema = z.enum([
    'GET',
    'HEAD',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
    'TRACE',
    'CONNECT',
]);
export const EgressTargetSchema = z
    .string()
    .min(1)
    .max(253)
    .regex(/^[A-Za-z0-9*._:/-]+$/, 'must be a hostname, IP address, or CIDR block — no spaces or control characters');
function isPrintable(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code < 0x20 || code === 0x7f)
            return false;
    }
    return true;
}
const noControlCharacters = (label: string) => ({
    message: `${label} must not contain control characters`,
});
const MAX_INJECT_SECRET_BYTES = 2048;
function utf8ByteLength(value: string): number {
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code < 0x80)
            bytes += 1;
        else if (code < 0x800)
            bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
            const next = value.charCodeAt(index + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                bytes += 4;
                index += 1;
            }
            else
                bytes += 3;
        }
        else
            bytes += 3;
    }
    return bytes;
}
export const EgressMatchSchema = z
    .object({
    sni: EgressTargetSchema.optional(),
    host: EgressTargetSchema.optional(),
    method: z
        .array(EgressMatchMethodSchema)
        .min(1)
        .max(9)
        .optional(),
    path: z.string().min(1).max(1024).refine(isPrintable, noControlCharacters('path')).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    scheme: z.enum(['http', 'https']).optional(),
})
    .strict()
    .refine((match) => match.port === undefined || match.scheme !== undefined, {
    message: 'scheme is required when port is set',
    path: ['scheme'],
});
export const EgressInjectSchema = z
    .object({
    header: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, 'header must be a valid HTTP field name (RFC 9110 token)'),
    secret: z
        .string()
        .min(1)
        .refine(isPrintable, noControlCharacters('secret'))
        .refine((secret) => utf8ByteLength(secret) <= MAX_INJECT_SECRET_BYTES, {
        message: `secret must be at most ${MAX_INJECT_SECRET_BYTES} bytes (UTF-8) — the size the egress fabric accepts`,
    }),
    format: z
        .string()
        .min(1)
        .max(512)
        .refine(isPrintable, noControlCharacters('format'))
        .refine((format) => format.includes('${SECRET}'), {
        message: 'format must contain the ${SECRET} placeholder',
    })
        .optional(),
})
    .strict();
export const EgressActionSchema = z
    .object({
    allow: z.boolean(),
    audit: EgressAuditLevelSchema.optional(),
    inject: z.array(EgressInjectSchema).min(1).max(8).optional(),
})
    .strict();
function hasUniqueHeaders(inject: readonly {
    header: string;
}[]): boolean {
    const seen = new Set(inject.map((entry) => entry.header.toLowerCase()));
    return seen.size === inject.length;
}
export const EgressRuleSchema = z
    .object({
    name: z.string().min(1).max(64).refine(isPrintable, noControlCharacters('name')),
    match: EgressMatchSchema.default({}),
    action: EgressActionSchema,
})
    .strict()
    .refine((rule) => rule.action.inject === undefined || rule.action.allow, {
    message: 'inject requires action.allow: true — upstream ignores it on a denying rule',
    path: ['action', 'inject'],
})
    .refine((rule) => rule.action.inject === undefined ||
    rule.match.host !== undefined ||
    rule.match.sni !== undefined, {
    message: 'inject requires match.host or match.sni, so the credential has one destination',
    path: ['match', 'host'],
})
    .refine((rule) => rule.action.inject === undefined || hasUniqueHeaders(rule.action.inject), {
    message: 'inject entries must name distinct headers',
    path: ['action', 'inject'],
});
export const MaskRequestHostSchema = z
    .string()
    .min(1)
    .max(253)
    .refine(isPrintable, noControlCharacters('maskRequestHost'))
    .refine((value) => /^[A-Za-z0-9.:[\]-]+$/.test(value.replaceAll('${PORT}', '0')), {
    message: 'maskRequestHost must be a host or host:port authority; ${PORT} is the only placeholder',
});
export const SandboxNetworkPolicySchema = z
    .object({
    allowInternetAccess: z
        .boolean()
        .optional(),
    allowOut: z.array(EgressTargetSchema).max(256).optional(),
    denyOut: z.array(EgressTargetSchema).max(256).optional(),
    allowPublicTraffic: z
        .boolean()
        .optional(),
    maskRequestHost: MaskRequestHostSchema.optional(),
    rules: z.array(EgressRuleSchema).max(64).optional(),
})
    .strict()
    .refine((policy) => policy.rules === undefined ||
    new Set(policy.rules.map((rule) => rule.name)).size === policy.rules.length, { message: 'rule names must be unique within a policy', path: ['rules'] })
    .refine((policy) => policy.allowOut === undefined ||
    policy.allowOut.length === 0 ||
    policy.allowInternetAccess === false ||
    (policy.denyOut ?? []).includes('0.0.0.0/0'), {
    message: 'an allowOut list needs a closed default: set allowInternetAccess: false, or add 0.0.0.0/0 to denyOut',
    path: ['allowOut'],
});
export const EgressInjectViewSchema = z.object({
    header: z.string(),
    format: z.string().optional(),
});
export const EgressActionViewSchema = z.object({
    allow: z.boolean(),
    audit: EgressAuditLevelSchema.optional(),
    inject: z.array(EgressInjectViewSchema).optional(),
});
export const EgressRuleViewSchema = z.object({
    name: z.string(),
    match: EgressMatchSchema,
    action: EgressActionViewSchema,
});
export const SandboxNetworkPolicyViewSchema = z.object({
    allowInternetAccess: z.boolean().optional(),
    allowOut: z.array(z.string()).optional(),
    denyOut: z.array(z.string()).optional(),
    allowPublicTraffic: z.boolean().optional(),
    maskRequestHost: z.string().optional(),
    rules: z.array(EgressRuleViewSchema).optional(),
});
export const SandboxNetworkStateSchema = z.object({
    sandboxId: z.string(),
    known: z.boolean(),
    appliedAt: z.string().optional(),
    policy: SandboxNetworkPolicyViewSchema.optional(),
});
