import { z } from 'zod';
import { DEFAULT_TIMEZONE } from './range.js';

const text = z.string().trim().min(1).max(120);

const rangeFields = {
  from: z.iso.date(),
  to: z.iso.date(),
  timezone: z.string().trim().min(1).max(64).default(DEFAULT_TIMEZONE),
};

const visitFields = {
  platform: text.optional(),
  campaign: text.optional(),
  source: text.optional(),
  medium: text.optional(),
  landing: text.optional(),
  device: z.enum(['mobile', 'desktop', 'tablet', 'unknown']).optional(),
};

/** `unlinked` is the internal bucket for conversions with no visit, never a channel to filter by. */
const channel = text.refine((value) => value !== 'unlinked', 'reserved bucket name').optional();

/** Query string of overview/channels; unknown keys are dropped, never forwarded to Mongo. */
export const reportQuerySchema = z.object({
  ...rangeFields,
  reportingMode: z.enum(['acquisition_cohort', 'event_period']).default('acquisition_cohort'),
  outcomeWindowDays: z.coerce.number().pipe(z.union([z.literal(7), z.literal(30)])).default(30),
  perspective: z.enum(['visit_touch', 'first_touch', 'last_non_direct']).default('visit_touch'),
  channel,
  ...visitFields,
});

export const funnelQuerySchema = reportQuerySchema.extend({
  course: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
});

export const qualityQuerySchema = z.object(rangeFields);

export const journeysQuerySchema = z.object({
  ...rangeFields,
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  channel,
  ...visitFields,
});

export const liveQuerySchema = z.object({
  windowMinutes: z.coerce.number().pipe(z.union([z.literal(5), z.literal(15), z.literal(30), z.literal(60)])).default(15),
});

export const journeyParamsSchema = z.object({ visitId: z.uuid() });

export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type FunnelQuery = z.infer<typeof funnelQuerySchema>;
export type QualityQuery = z.infer<typeof qualityQuerySchema>;
export type JourneysQuery = z.infer<typeof journeysQuerySchema>;
export type LiveQuery = z.infer<typeof liveQuerySchema>;
