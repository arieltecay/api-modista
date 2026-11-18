import AcquisitionSignalAttempt from '../../models/AcquisitionSignalAttempt/index.js';
import { isStatusValidForChannel } from '../../models/AcquisitionSignalAttempt/types.js';
import { isDuplicateKeyError, isVisitOwnedByAnother } from './index.js';
import type { BrowserSignalBody } from './schemas.js';
import type { IngestOutcome } from './types.js';

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
