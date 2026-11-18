import { z } from 'zod';
import { DEFAULT_TIMEZONE } from './range.js';

const text = z.string().trim().min(1).max(120);

/** Query string of every report endpoint; unknown keys are dropped, never forwarded to Mongo. */
export const reportQuerySchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  timezone: z.string().trim().min(1).max(64).default(DEFAULT_TIMEZONE),
  reportingMode: z.enum(['acquisition_cohort', 'event_period']).default('acquisition_cohort'),
  outcomeWindowDays: z.coerce.number().pipe(z.union([z.literal(7), z.literal(30)])).default(30),
  perspective: z.enum(['visit_touch', 'first_touch', 'last_non_direct']).default('visit_touch'),
  channel: text.refine((value) => value !== 'unlinked', 'reserved bucket name').optional(),
  platform: text.optional(),
  campaign: text.optional(),
  source: text.optional(),
  medium: text.optional(),
  landing: text.optional(),
  device: z.enum(['mobile', 'desktop', 'tablet', 'unknown']).optional(),
});

export type ReportQuery = z.infer<typeof reportQuerySchema>;
