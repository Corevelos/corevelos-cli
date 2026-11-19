import { z } from 'zod';
export const IsoTimestampSchema = z.iso
    .datetime({ offset: true });
export const MicroAmountSchema = z
    .number()
    .int();
export const CurrencySchema = z
    .string()
    .regex(/^[A-Z]{3}$/, 'currency must be a 3-letter ISO 4217 code');
export const SubjectIdSchema = z
    .string()
    .min(1)
    .max(255);
export const BillingMeterSchema = z.enum(['vcpu', 'memory', 'storage']);
export const MagnitudeUnitSchema = z.enum(['millicores', 'mib']);
export const BillingBasisSchema = z.enum(['measured', 'declared', 'estimated']);
export const BillingResourceTypeSchema = z.enum(['sandbox', 'volume', 'snapshot']);
export const BillingGranularitySchema = z.enum(['second', 'minute', 'hour']);
export const BillingRoundingSchema = z.enum(['up', 'nearest', 'down']);
export const IntervalCloseReasonSchema = z.enum([
    'caller',
    'reconciler',
    'state_change',
    'shutdown',
    'magnitude_change',
    'voided',
]);
export const IntervalOpenedBySchema = z.enum(['recorder', 'reconciler']);
export const BillingAccountStatusSchema = z.enum(['active', 'suspended', 'closed']);
export const InvoiceStatusSchema = z.enum(['draft', 'finalized', 'void']);
export const UsageIntervalSchema = z.object({
    id: z.string().min(1),
    subjectId: SubjectIdSchema,
    resourceType: BillingResourceTypeSchema,
    resourceId: z.string().min(1),
    meter: BillingMeterSchema,
    magnitude: z.number().int().nonnegative(),
    magnitudeUnit: MagnitudeUnitSchema,
    startedAt: IsoTimestampSchema,
    endedAt: IsoTimestampSchema.nullable(),
    endedAtUpperBound: IsoTimestampSchema.nullable(),
    lastSeenAt: IsoTimestampSchema,
    basis: BillingBasisSchema,
    openedBy: IntervalOpenedBySchema,
    closeReason: IntervalCloseReasonSchema.nullable(),
    openedByKeyId: z.string().min(1).max(64).nullable(),
    projectId: z.string().min(1).nullable().default(null),
    attributes: z.record(z.string(), z.string()).default({}),
});
export const ListIntervalsResponseSchema = z.object({
    items: z.array(UsageIntervalSchema),
    nextCursor: z.string().optional(),
});
export const RATE_NANOS_PER_MICRO = 1000;
export const HourlyRateMicrosSchema = z.number().nonnegative()
    .max(Number.MAX_SAFE_INTEGER / RATE_NANOS_PER_MICRO)
    .multipleOf(1 / RATE_NANOS_PER_MICRO);
export const RateCardSchema = z.object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(120),
    currency: CurrencySchema,
    granularity: BillingGranularitySchema,
    rounding: BillingRoundingSchema,
    minimumBillableSeconds: z.number().int().nonnegative(),
    vcpuMicrosPerVcpuHour: HourlyRateMicrosSchema,
    memoryMicrosPerGibHour: HourlyRateMicrosSchema,
    storageMicrosPerGibHour: HourlyRateMicrosSchema,
    includedVcpuSeconds: z.number().int().nonnegative().default(0),
    includedGibSecondsMemory: z.number().int().nonnegative().default(0),
    includedGibSecondsStorage: z.number().int().nonnegative().default(0),
    effectiveFrom: IsoTimestampSchema,
});
export const BillingAccountSchema = z.object({
    subjectId: SubjectIdSchema,
    currency: CurrencySchema,
    status: BillingAccountStatusSchema,
    statusReason: z.string().min(1).max(500).nullable(),
    rateCardId: z.string().min(1).max(64),
    spendCapMicros: MicroAmountSchema.nullable(),
    platformLimitMicros: MicroAmountSchema.nullable(),
    effectiveSpendCapMicros: MicroAmountSchema.nullable(),
    balanceMicros: MicroAmountSchema,
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
});
export const SetSpendCapBodySchema = z.object({
    spendCapMicros: MicroAmountSchema.nonnegative().nullable(),
});
export const UsageLineSchema = z.object({
    meter: BillingMeterSchema,
    resourceType: BillingResourceTypeSchema,
    basis: BillingBasisSchema,
    intervalCount: z.number().int().nonnegative(),
    billableSeconds: z.number().int().nonnegative(),
    quantity: z.number().int().nonnegative(),
    quantityUnit: z.enum(['milli_vcpu_seconds', 'mib_seconds']),
    includedQuantity: z.number().int().nonnegative(),
    chargeableQuantity: z.number().int().nonnegative(),
    costMicros: MicroAmountSchema.nonnegative(),
});
export const UsageSummarySchema = z.object({
    subjectId: SubjectIdSchema,
    periodStart: IsoTimestampSchema,
    periodEnd: IsoTimestampSchema,
    currency: CurrencySchema,
    rateCardId: z.string(),
    granularity: BillingGranularitySchema,
    lines: z.array(UsageLineSchema),
    subtotalMicros: MicroAmountSchema.nonnegative(),
    provisional: z.boolean(),
    openIntervalCount: z.number().int().nonnegative(),
    uncertaintyMicros: MicroAmountSchema.nonnegative(),
    generatedAt: IsoTimestampSchema,
});
export const UsageByKeySchema = z.object({
    name: z.string().optional(),
    category: z.enum(['general', 'velos-agent']).optional(),
    keyId: z.string().min(1).max(64).nullable(),
    intervalCount: z.number().int().nonnegative(),
    openIntervalCount: z.number().int().nonnegative(),
    uncertaintyMicros: MicroAmountSchema.nonnegative(),
    subtotalMicros: MicroAmountSchema.nonnegative(),
    lines: z.array(UsageLineSchema),
});
export const UsageByResourceSchema = z.object({
    resourceId: z.string().min(1).max(255),
    resourceType: BillingResourceTypeSchema,
    intervalCount: z.number().int().nonnegative(),
    openIntervalCount: z.number().int().nonnegative(),
    uncertaintyMicros: MicroAmountSchema.nonnegative(),
    subtotalMicros: MicroAmountSchema.nonnegative(),
    lines: z.array(UsageLineSchema),
});
export const UsageByResourceListSchema = z.object({
    rows: z.array(UsageByResourceSchema),
    overflowCount: z.number().int().nonnegative(),
    overflowSubtotalMicros: MicroAmountSchema.nonnegative(),
});
export const UsageBreakdownSchema = z.object({
    subjectId: SubjectIdSchema,
    periodStart: IsoTimestampSchema,
    periodEnd: IsoTimestampSchema,
    currency: CurrencySchema,
    rateCardId: z.string(),
    granularity: BillingGranularitySchema,
    provisional: z.boolean(),
    byKey: z.array(UsageByKeySchema),
    byCategory: z.array(z.object({
        category: z.enum(['general', 'velos-agent', 'unattributed']),
        intervalCount: z.number().int().nonnegative(),
        openIntervalCount: z.number().int().nonnegative(),
        subtotalMicros: MicroAmountSchema.nonnegative(),
    })).optional(),
    byResource: UsageByResourceListSchema,
    generatedAt: IsoTimestampSchema,
});
export const RunCostSummarySchema = z.object({
    subjectId: SubjectIdSchema,
    resourceId: z.string().min(1).max(255),
    firstStartedAt: IsoTimestampSchema,
    currency: CurrencySchema,
    rateCardId: z.string(),
    granularity: BillingGranularitySchema,
    lines: z.array(UsageLineSchema),
    intervalCount: z.number().int().nonnegative(),
    openIntervalCount: z.number().int().nonnegative(),
    subtotalMicros: MicroAmountSchema.nonnegative(),
    provisional: z.boolean(),
    uncertaintyMicros: MicroAmountSchema.nonnegative(),
    generatedAt: IsoTimestampSchema,
});
export const InvoiceSchema = z.object({
    id: z.string().min(1),
    subjectId: SubjectIdSchema,
    currency: CurrencySchema,
    status: InvoiceStatusSchema,
    periodStart: IsoTimestampSchema,
    periodEnd: IsoTimestampSchema,
    rateCardId: z.string(),
    lines: z.array(UsageLineSchema),
    subtotalMicros: MicroAmountSchema.nonnegative(),
    creditMicros: MicroAmountSchema.nonnegative(),
    totalMicros: MicroAmountSchema,
    intervalCount: z.number().int().nonnegative(),
    ledgerDigest: z.string().min(1),
    createdAt: IsoTimestampSchema,
    finalizedAt: IsoTimestampSchema.nullable(),
});
export const ListInvoicesResponseSchema = z.object({
    items: z.array(InvoiceSchema),
    nextCursor: z.string().optional(),
});
export const BillingGateStateSchema = z.object({
    allowed: z.boolean(),
    reason: z.enum(['ok', 'account_status', 'concurrency', 'spend_cap']),
    subtotalMicros: MicroAmountSchema,
    spendCapMicros: MicroAmountSchema.nullable(),
    openSandboxes: z.number().int().nonnegative(),
    maxOpenSandboxes: z.number().int().nonnegative(),
});
export const BillingEstimateSchema = z.object({
    account: BillingAccountSchema,
    rateCard: RateCardSchema,
    usage: UsageSummarySchema,
    gate: BillingGateStateSchema,
});
