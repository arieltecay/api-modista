import AcquisitionSignalAttempt from '../../models/AcquisitionSignalAttempt/index.js';
import MetaEventDlq from '../../models/MetaEventDlq.js';
import { isStatusValidForChannel, statusesThatMayAdvanceTo } from '../../models/AcquisitionSignalAttempt/types.js';
import { compact, isDuplicateKeyError, isVisitOwnedByAnother } from './index.js';
import type { BrowserSignalBody } from './schemas.js';
import type { IngestOutcome, OutboxSnapshot, ServerCapiSignalInput, ServerCapiStatus } from './types.js';

/**
 * Registers that the browser called `fbq` for an event. `invoked` is the only honest browser
 * state (Meta never confirms back), and a repeat never raises the attempt count. An eventId or
 * visit owned by another visitor is a conflict.
 */
export const recordBrowserPixelInvoked = async (input: BrowserSignalBody): Promise<IngestOutcome> => {
  if (!isStatusValidForChannel('browser_pixel', input.status)) return 'conflict';
  if (await isVisitOwnedByAnother(input.visitId, input.visitorId)) return 'conflict';

  const owner = { eventId: input.eventId, channel: 'browser_pixel', visitorId: input.visitorId } as const;
  try {
    const result = await AcquisitionSignalAttempt.updateOne(
      owner,
      { $setOnInsert: { status: 'invoked', attempts: 1, occurredAt: input.occurredAt, visitId: input.visitId } },
      { upsert: true },
    );
    return result.upsertedCount === 1 ? 'created' : 'updated';
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    return (await AcquisitionSignalAttempt.exists(owner)) ? 'updated' : 'conflict';
  }
};

/** Outbox state -> signal state. A pending event that was already tried is a retry. */
export const mapOutboxStatus = ({ status, attempts }: OutboxSnapshot): ServerCapiStatus => {
  if (status === 'sent') return 'delivered';
  if (status === 'exhausted' || status === 'failed') return 'exhausted';
  return attempts > 0 ? 'retry' : 'pending';
};

/**
 * Advances the `server_capi` attempt of an event and, unless `createIfMissing` is false, creates it.
 * Moves forward only and terminal states never change; stores no payload. Schema validators do not
 * run on updates, so the status is checked here and the transition is enforced by the update filter.
 */
export const recordServerCapiStatus = async (input: ServerCapiSignalInput, createIfMissing = true): Promise<void> => {
  if (!isStatusValidForChannel('server_capi', input.status)) return;
  const identity = { eventId: input.eventId, channel: 'server_capi' } as const;

  const advance = () =>
    AcquisitionSignalAttempt.updateOne(
      { ...identity, status: { $in: statusesThatMayAdvanceTo(input.status) } },
      {
        $set: { status: input.status, ...(input.visitorId ? { visitorId: input.visitorId } : {}) },
        $max: { attempts: input.attempts ?? 0 },
      },
    );
  if ((await advance()).matchedCount > 0 || !createIfMissing) return;

  try {
    await AcquisitionSignalAttempt.updateOne(
      identity,
      {
        $setOnInsert: compact({
          status: input.status,
          attempts: input.attempts ?? 0,
          occurredAt: input.occurredAt,
          visitorId: input.visitorId,
        }),
      },
      { upsert: true },
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    await advance(); // lost the insert race: apply our state on top of the winner's
  }
};

/**
 * Repairs the CAPI signal state from the outbox (`MetaEventDlq`) for rows touched since `since`,
 * newest first so a large window cannot starve recent events. It only advances attempts that
 * already exist: creating them here would resurrect, without a visitor id, data that a consent
 * revocation already purged. Idempotent; reads only eventId/status/attempts, never a payload.
 */
export const reconcileCapiSignals = async ({
  since,
  limit = 500,
}: {
  since: Date;
  limit?: number;
}): Promise<{ processed: number }> => {
  const rows = await MetaEventDlq.find({ updatedAt: { $gte: since } })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .select('eventId status attempts createdAt')
    .lean();

  for (const row of rows) {
    await recordServerCapiStatus(
      { eventId: row.eventId, status: mapOutboxStatus(row), attempts: row.attempts, occurredAt: row.createdAt },
      false,
    );
  }
  return { processed: rows.length };
};
