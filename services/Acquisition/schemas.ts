import { z } from 'zod';
import { isWithinClientClockWindow, toCleanPath } from './sanitize.js';

/** Behavioural events the browser may report; `lead`, `initiate_checkout` and `purchase` are server-only. */
export const PUBLIC_EVENT_NAMES = [
  'page_view',
  'course_detail_view',
  'pricing_visible',
  'cta_click',
  'form_view',
  'form_start',
  'form_submit',
  'scroll_50',
  'scroll_90',
  'redirect_to_payment',
] as const;

const uuid = z.uuid();

const clientDate = z.iso
  .datetime()
  .transform((value) => new Date(value))
  .refine((date) => isWithinClientClockWindow(date), 'timestamp outside the accepted window');

const cleanPath = z
  .string()
  .max(512)
  .transform(toCleanPath)
  .pipe(z.string());

const slug = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/i);
const utmValue = z.string().trim().max(120);

/** Stable ids may be deterministic (e.g. `view_content_<course>_<prefix>`), so only the charset is fixed. */
const eventId = z.string().regex(/^[A-Za-z0-9_.:-]{8,128}$/);

export const visitBodySchema = z
  .object({
    visitId: uuid,
    visitorId: uuid,
    startedAt: clientDate,
    lastActivityAt: clientDate,
    entryPath: cleanPath,
    landingSlug: slug.optional(),
    referrer: z.string().max(2048).optional(),
    utm: z
      .object({
        source: utmValue.optional(),
        medium: utmValue.optional(),
        campaign: utmValue.optional(),
        term: utmValue.optional(),
        content: utmValue.optional(),
      })
      .optional(),
    device: z.enum(['mobile', 'desktop', 'tablet', 'unknown']).optional(),
    hasFbc: z.boolean().optional(),
    hasFbp: z.boolean().optional(),
  })
  .refine((visit) => visit.lastActivityAt >= visit.startedAt, {
    path: ['lastActivityAt'],
    message: 'lastActivityAt must not precede startedAt',
  });

export const eventBodySchema = z.object({
  eventId,
  visitId: uuid,
  visitorId: uuid,
  name: z.enum(PUBLIC_EVENT_NAMES),
  occurredAt: clientDate,
  path: cleanPath.optional(),
  landingSlug: slug.optional(),
  courseId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
});

export const browserSignalBodySchema = z.object({
  eventId,
  visitId: uuid,
  visitorId: uuid,
  channel: z.literal('browser_pixel'),
  status: z.literal('invoked'),
  occurredAt: clientDate,
});

export type VisitBody = z.infer<typeof visitBodySchema>;
export type EventBody = z.infer<typeof eventBodySchema>;
export type BrowserSignalBody = z.infer<typeof browserSignalBodySchema>;
