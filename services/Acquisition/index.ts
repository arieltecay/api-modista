import AcquisitionEvent from '../../models/AcquisitionEvent/index.js';
import AcquisitionSignalAttempt from '../../models/AcquisitionSignalAttempt/index.js';
import AcquisitionVisit from '../../models/AcquisitionVisit/index.js';
import { META_MARKETING_CONSENT_VERSION } from '../../utils/metaMarketingConsent.js';
import { classifyAcquisition } from './classifier.js';
import { getIgnoredReferrerHosts } from './config.js';
import { toReferrerHost } from './sanitize.js';
import type { EventBody, VisitBody } from './schemas.js';
import type { IngestOutcome } from './types.js';

const DUPLICATE_KEY_ERROR = 11000;
const SCHEMA_VERSION = 1;

export const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === DUPLICATE_KEY_ERROR;

/** Drops unset values so upserts never write `null`/`undefined` keys. */
export const compact = <T extends Record<string, unknown>>(values: T): Partial<T> =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== '')) as Partial<T>;

/** True when the visit already exists and belongs to a different visitor. */
export const isVisitOwnedByAnother = async (visitId: string, visitorId: string): Promise<boolean> => {
  const visit = await AcquisitionVisit.findOne({ visitId }).select('visitorId').lean();
  return visit !== null && visit.visitorId !== visitorId;
};

/** Consent revocation: removes every individualizable record of the visitor. */
export const purgeVisitorData = async (visitorId: string): Promise<void> => {
  await Promise.all([
    AcquisitionVisit.deleteMany({ visitorId }),
    AcquisitionEvent.deleteMany({ visitorId }),
    AcquisitionSignalAttempt.deleteMany({ visitorId }),
  ]);
};

const advanceVisitActivity = async (visitId: string, visitorId: string, at: Date) =>
  AcquisitionVisit.findOneAndUpdate({ visitId, visitorId }, { $max: { lastActivityAt: at } });

/**
 * Idempotent upsert of a consented visit. Attribution is classified here, never trusted from the
 * client, and is immutable after creation; later calls only move `lastActivityAt` forward.
 * Schema validators do not run on upserts: the Zod schema is the gate.
 */
export const recordVisit = async (input: VisitBody): Promise<IngestOutcome> => {
  const rawAttribution = compact({ ...input.utm });
  const referrerHost = toReferrerHost(input.referrer, getIgnoredReferrerHosts());
  const classification = classifyAcquisition({
    source: rawAttribution.source,
    medium: rawAttribution.medium,
    campaign: rawAttribution.campaign,
    referrerHost,
  });

  try {
    const previous = await AcquisitionVisit.findOneAndUpdate(
      { visitId: input.visitId, visitorId: input.visitorId },
      {
        $max: { lastActivityAt: input.lastActivityAt },
        $setOnInsert: compact({
          startedAt: input.startedAt,
          entryPath: input.entryPath,
          landingSlug: input.landingSlug,
          referrerHost,
          rawAttribution,
          classification,
          device: input.device,
          hasFbc: input.hasFbc ?? false,
          hasFbp: input.hasFbp ?? false,
          consentVersion: META_MARKETING_CONSENT_VERSION,
          schemaVersion: SCHEMA_VERSION,
        }),
      },
      { upsert: true, new: false },
    );
    return previous ? 'updated' : 'created';
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    // Same visitId: either a concurrent identical upsert (ours) or a visit owned by someone else.
    const own = await advanceVisitActivity(input.visitId, input.visitorId, input.lastActivityAt);
    return own ? 'updated' : 'conflict';
  }
};

/**
 * Records a public behavioural event once per eventId. The visit may not exist yet (events can
 * outrun the visit request), but a visit or an eventId owned by another visitor is a conflict.
 */
export const recordEvent = async (input: EventBody, receivedAt = new Date()): Promise<IngestOutcome> => {
  if (await isVisitOwnedByAnother(input.visitId, input.visitorId)) return 'conflict';

  try {
    // visitorId is in the filter so an eventId taken by another visitor can never be adopted.
    const result = await AcquisitionEvent.updateOne(
      { eventId: input.eventId, visitorId: input.visitorId },
      {
        $setOnInsert: compact({
          visitId: input.visitId,
          name: input.name,
          occurredAt: input.occurredAt,
          receivedAt,
          path: input.path,
          landingSlug: input.landingSlug,
          courseId: input.courseId,
          source: 'browser',
          schemaVersion: SCHEMA_VERSION,
        }),
      },
      { upsert: true },
    );
    if (result.upsertedCount === 0) return 'updated';
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const own = await AcquisitionEvent.exists({ eventId: input.eventId, visitorId: input.visitorId });
    return own ? 'updated' : 'conflict';
  }

  await advanceVisitActivity(input.visitId, input.visitorId, input.occurredAt);
  return 'created';
};
