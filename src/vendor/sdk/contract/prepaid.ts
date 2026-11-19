import { z } from 'zod';
export const UsdAmountSchema = z.string().regex(/^(0|[1-9]\d{0,9})(\.\d{1,6})?$/, 'Enter a non-negative USD amount with at most six decimal places');
export const TierLimitsSchema = z.object({
    maxConcurrentSandboxes: z.number().int().positive().max(100000),
    totalVcpu: z.number().int().positive().max(1000000),
    totalMemoryMib: z.number().int().positive().max(1024000000),
    totalStorageMib: z.number().int().positive().max(1024000000),
    maxVcpuPerSandbox: z.number().int().positive().max(1024),
    maxMemoryMibPerSandbox: z.number().int().positive().max(1048576),
    maxDiskMibPerSandbox: z.number().int().positive().max(10485760),
    maxRuntimeSeconds: z.number().int().positive().max(604800),
    apiRateLimitPerMin: z.number().int().positive().max(1000000),
    startsPerMin: z.number().int().positive().max(100000),
}).strict().superRefine((v, ctx) => {
    if (v.maxVcpuPerSandbox > v.totalVcpu || v.maxMemoryMibPerSandbox > v.totalMemoryMib || v.maxDiskMibPerSandbox > v.totalStorageMib) {
        ctx.addIssue({ code: 'custom', message: 'A per-sandbox limit cannot exceed its workspace pool' });
    }
});
export type TierLimits = z.infer<typeof TierLimitsSchema>;
export const PaygTierSchema = z.object({
    tier: z.number().int().min(1).max(6),
    name: z.string().trim().min(1).max(80),
    minimumNetPaidUsd: UsdAmountSchema,
    limits: TierLimitsSchema,
}).strict();
function usdMicros(value: string): bigint {
    const match = /^(0|[1-9]\d{0,9})(?:\.(\d{1,6}))?$/.exec(value);
    return match ? BigInt(match[1]!) * 1000000n + BigInt((match[2] ?? '').padEnd(6, '0')) : 0n;
}
export const PrepaidPolicySchema = z.object({
    version: z.number().int().positive(),
    tiers: z.array(PaygTierSchema).length(6),
    starterCreditUsd: UsdAmountSchema.refine((v) => usdMicros(v) === 200000000n, 'The one-time free grant is $200'),
    trial: z.object({
        modelId: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9@][A-Za-z0-9._@/-]*$/).default('deepseek-flash'),
        totalTokens: z.number().int().positive().max(10000000).default(1000000),
    }).strict().default({ modelId: 'deepseek-flash', totalTokens: 1000000 }),
    storageGraceHours: z.number().int().min(1).max(168),
    lowBalanceUsd: UsdAmountSchema,
}).strict().superRefine((p, ctx) => {
    p.tiers.forEach((tier, i) => {
        if (tier.tier !== i + 1 || (i === 0 ? usdMicros(tier.minimumNetPaidUsd) !== 0n : usdMicros(tier.minimumNetPaidUsd) <= 0n)) {
            ctx.addIssue({ code: 'custom', message: 'Six ordered tiers are required: a free starter with no payment gate, followed by positive paid thresholds' });
        }
        const previous = p.tiers[i - 1];
        if (previous && (usdMicros(tier.minimumNetPaidUsd) <= usdMicros(previous.minimumNetPaidUsd) || Object.keys(tier.limits).some((key) => tier.limits[key as keyof TierLimits] < previous.limits[key as keyof TierLimits]))) {
            ctx.addIssue({ code: 'custom', message: 'Funding thresholds must increase; resource limits cannot decrease between tiers' });
        }
    });
});
export const TierOverrideSchema = z.object({
    expectedVersion: z.number().int().nonnegative(),
    reason: z.string().trim().min(10).max(1000),
    override: z.union([z.object({ tier: z.number().int().min(1).max(6) }).strict(), z.object({ enterprise: z.literal(true), limits: TierLimitsSchema }).strict()]).nullable(),
}).strict();
export const CreditPackSchema = z.object({ productId: z.string().min(1), amountUsd: UsdAmountSchema });
export const PrepaidReservationBreakdownSchema = z.object({
    resourcesUsd: UsdAmountSchema,
    modelsProcessingUsd: UsdAmountSchema,
    modelsUnderReviewUsd: UsdAmountSchema,
    modelReviewCount: z.number().int().nonnegative().safe(),
    oldestModelReviewAt: z.iso.datetime().nullable(),
});
export const PrepaidWalletSchema = z.object({
    subjectId: z.string(), currency: z.literal('USD'),
    balanceUsd: UsdAmountSchema, pendingUsageUsd: UsdAmountSchema, reservedFundingUsd: UsdAmountSchema,
    creditBalances: z.object({
        freeUsd: UsdAmountSchema,
        permanentUsd: UsdAmountSchema,
        starterGrant: z.object({
            amountUsd: UsdAmountSchema, remainingUsd: UsdAmountSchema, expiredUsd: UsdAmountSchema,
            grantedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
            status: z.enum(['active', 'exhausted', 'expired', 'legacy']),
        }).nullable(),
    }).optional(),
    trialEntitlements: z.object({
        modelId: z.string(), totalTokens: z.number().int().nonnegative().safe(),
        usedTokens: z.number().int().nonnegative().safe(), heldTokens: z.number().int().nonnegative().safe(),
        remainingTokens: z.number().int().nonnegative().safe(),
        sandboxId: z.string().nullable(), maxSandboxes: z.literal(1), maxVcpu: z.literal(2), maxMemoryMib: z.literal(2048),
        velosSandboxId: z.string().nullable().optional(), maxVelosSandboxes: z.literal(1).optional(),
        paidAccess: z.boolean(),
    }).optional(),
    reservationBreakdown: PrepaidReservationBreakdownSchema.optional(),
    netPaidUsd: UsdAmountSchema, firstPaymentAt: z.string().nullable(),
    state: z.enum(['unactivated', 'active', 'exhausted', 'blocked']),
    tier: PaygTierSchema.nullable(), enterpriseLimits: TierLimitsSchema.nullable(),
    tierOverride: TierOverrideSchema.shape.override.default(null),
    version: z.number().int().nonnegative(), policy: PrepaidPolicySchema,
    packs: z.array(CreditPackSchema), providerAvailable: z.boolean(),
    lowBalance: z.boolean(), frozenAt: z.string().nullable(),
});
export const PrepaidHistorySchema = z.object({
    purchases: z.array(z.object({ id: z.string(), amountUsd: UsdAmountSchema, refundedUsd: UsdAmountSchema, paidAt: z.string().nullable(), createdAt: z.string() })),
    operations: z.array(z.object({ id: z.string(), kind: z.enum(['debit', 'credit']), amountUsd: UsdAmountSchema, freeUsd: UsdAmountSchema.nullable().optional(), permanentUsd: UsdAmountSchema.nullable().optional(), reason: z.string(), state: z.enum(['pending', 'done', 'insufficient']), createdAt: z.string() })),
    reviews: z.array(z.object({ id: z.string(), transactionId: z.string(), status: z.string(), paymentPrincipalUsd: UsdAmountSchema, refundedAmountUsd: UsdAmountSchema, resolvedAt: z.string().nullable(), createdAt: z.string() })),
});
export const BuyCreditPackSchema = z.object({
    productId: z.string().min(1).max(200),
    subjectId: z.string().min(1).max(200).optional(),
}).strict();
export const CheckoutUrlResponseSchema = z.object({ url: z.string().url() });
export const PaymentRecordSchema = z.object({
    id: z.string().uuid(), subjectId: z.string(), productId: z.string(),
    creditUsd: UsdAmountSchema, totalPaidUsd: UsdAmountSchema.nullable(), taxUsd: UsdAmountSchema.nullable(),
    refundedPaymentUsd: UsdAmountSchema.nullable(), excludedFundingUsd: UsdAmountSchema,
    status: z.enum(['pending', 'paid', 'refunded', 'partially_refunded', 'chargeback', 'checkout_failed']),
    checkoutId: z.string().nullable(), orderId: z.string().nullable(), transactionId: z.string().nullable(),
    paidAt: z.string().nullable(), createdAt: z.string(), invoiceAvailable: z.boolean(),
});
export const PaymentHistorySchema = z.object({ items: z.array(PaymentRecordSchema), nextCursor: z.string().uuid().optional() });
export type PaymentHistory = z.infer<typeof PaymentHistorySchema>;
export const WalletActivitySchema = z.object({ items: PrepaidHistorySchema.shape.operations, nextCursor: z.string().optional() });
