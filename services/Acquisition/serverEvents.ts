import { Types } from 'mongoose';
import AcquisitionEvent from '../../models/AcquisitionEvent/index.js';
import AcquisitionVisit from '../../models/AcquisitionVisit/index.js';
import { logger } from '../logger.js';
import { isAcquisitionTrackingEnabled } from './config.js';
import { redactError } from './errors.js';
import { compact, isDuplicateKeyError } from './index.js';
import { CLIENT_CLOCK_FUTURE_TOLERANCE_MS } from './sanitize.js';
import { recordServerCapiStatus } from './signals.js';
import type { MetaDeliveryOutcome, MetaProjectionInput } from './types.js';

const SERVER_EVENT_NAMES: ReadonlyMap<string, 'lead' | 'initiate_checkout' | 'purchase'> = new Map([
  ['Lead', 'lead'],
  ['InitiateCheckout', 'initiate_checkout'],
  ['Purchase', 'purchase'],
]);

const SCHEMA_VERSION = 1;
const INSCRIPTION_ID = /^[0-9a-f]{24}$/;
const CAPI_EVENT_ID = /^(?:lead|checkout|purchase)_([0-9a-f]{24})$/;

/** `lead_<id>`, `checkout_<id>` and `purchase_<id>` carry the inscription id. */
export const parseInscriptionId = (eventId: string): string | undefined => CAPI_EVENT_ID.exec(eventId)?.[1];

/** Analytics must never break an inscription or a payment: failures are logged without values. */
const bestEffort = async (label: string, work: () => Promise<void>): Promise<void> => {
  try {
    await work();
  } catch (error) {
    logger.warn(`[Acquisition] ${label} failed: ${redactError(error).message}`);
  }
};

const READ_TIMEOUT_MS = 2000;

/**
 * Lead, checkout and purchase of an inscription belong to the visit that was current when the
 * inscription was created. The ObjectId embeds that instant, so the answer is the same for all
 * three events (no race between them, even days apart) and never depends on another visitor's data.
 * A visit that started shortly after (client clock skew) is used only if none started before.
 */
const resolveVisitId = async (visitorId: string, inscriptionId: string | undefined, occurredAt: Date) => {
  const anchor = inscriptionId ? new Types.ObjectId(inscriptionId).getTimestamp() : occurredAt;
  const startedBefore = await AcquisitionVisit.findOne({ visitorId, startedAt: { $lte: anchor } })
    .sort({ startedAt: -1 })
    .select('visitId')
    .maxTimeMS(READ_TIMEOUT_MS)
    .lean();
  if (startedBefore) return startedBefore.visitId;

  const upTo = new Date(anchor.getTime() + CLIENT_CLOCK_FUTURE_TOLERANCE_MS);
  const startedSoonAfter = await AcquisitionVisit.findOne({ visitorId, startedAt: { $gt: anchor, $lte: upTo } })
    .sort({ startedAt: 1 })
    .select('visitId')
    .maxTimeMS(READ_TIMEOUT_MS)
    .lean();
  return startedSoonAfter?.visitId;
};

/**
 * Server-authoritative `lead` / `initiate_checkout` / `purchase` events. Called only after the
 * Meta consent check passed. Carries no value: revenue always comes from payments.
 */
export const recordServerConversion = async (input: MetaProjectionInput): Promise<void> => {
  const name = SERVER_EVENT_NAMES.get(input.eventName);
  const { visitorId } = input;
  if (!isAcquisitionTrackingEnabled() || !name || !visitorId) return;

  await bestEffort('server conversion', async () => {
    const inscriptionId = [input.inscriptionId, parseInscriptionId(input.eventId)].find(
      (candidate): candidate is string => candidate !== undefined && INSCRIPTION_ID.test(candidate),
    );
    const visitId = await resolveVisitId(visitorId, inscriptionId, input.occurredAt);
    if (!visitId) return;

    try {
      await AcquisitionEvent.updateOne(
        { eventId: input.eventId, visitorId },
        {
          $setOnInsert: compact({
            visitId,
            name,
            occurredAt: input.occurredAt,
            receivedAt: new Date(),
            inscriptionId,
            courseId: input.courseId,
            source: 'server',
            schemaVersion: SCHEMA_VERSION,
          }),
        },
        { upsert: true },
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
  });
};

/** CAPI signal state right after the outbox accepted (or delivered) the event. */
export const recordCapiDelivery = async (input: MetaProjectionInput, delivery: MetaDeliveryOutcome): Promise<void> => {
  if (!isAcquisitionTrackingEnabled() || !delivery.accepted) return;

  await bestEffort('capi delivery', () =>
    recordServerCapiStatus({
      eventId: input.eventId,
      status: delivery.delivered ? 'delivered' : 'accepted',
      attempts: delivery.delivered ? 1 : 0,
      occurredAt: input.occurredAt,
      visitorId: input.visitorId,
    }),
  );
};
