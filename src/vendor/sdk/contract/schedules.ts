import { z } from 'zod';
import { IsoTimestampSchema } from './billing.js';
import { ProjectIdSchema } from './projects.js';
const CRON_FIELD_PATTERN = /^(\*|\d{1,2}(-\d{1,2})?)(\/\d{1,2})?(,(\*|\d{1,2}(-\d{1,2})?)(\/\d{1,2})?)*$/;
export function isCronStructure(value: string): boolean {
    if (value.length > 200)
        return false;
    const fields = value.trim().split(/\s+/);
    if (fields.length !== 5)
        return false;
    return fields.every((field) => CRON_FIELD_PATTERN.test(field));
}
export const CronExpressionSchema = z
    .string()
    .trim()
    .refine(isCronStructure, {
    message: 'cron must be five UTC fields — minute hour day-of-month month day-of-week — using *, a, a-b, a-b/n, */n or comma-separated lists (digits only, no names)',
});
export const ScheduleRunStatusSchema = z.enum(['firing', 'fired', 'failed']);
export const ScheduleSchema = z.object({
    scheduleId: z.string(),
    name: z.string().nullable(),
    projectId: ProjectIdSchema.nullable(),
    cron: CronExpressionSchema,
    enabled: z.boolean(),
    sandbox: z.record(z.string(), z.unknown()),
    nextRunAt: IsoTimestampSchema
        .nullable(),
    lastRunAt: IsoTimestampSchema.nullable(),
    lastRunStatus: ScheduleRunStatusSchema
        .nullable(),
    lastRunError: z
        .string()
        .nullable(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
});
export type Schedule = z.infer<typeof ScheduleSchema>;
export const ListSchedulesResponseSchema = z.object({
    schedules: z.array(ScheduleSchema),
});
export type ListSchedulesResponse = z.infer<typeof ListSchedulesResponseSchema>;
