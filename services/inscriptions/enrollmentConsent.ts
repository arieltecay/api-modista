import { logger } from '../logger.js';

/** Verification for optional marketing signals cannot block a purchase. */
export const enrollmentMarketingConsent = async (
  requested: boolean,
  verify: () => Promise<boolean>,
  maxWaitMs = 1000,
): Promise<boolean> => {
  if (!requested) return false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      verify(),
      new Promise<null>((resolve) => { timeout = setTimeout(() => resolve(null), maxWaitMs); }),
    ]);
    if (result === null) {
      logger.warn('[createInscription] Marketing consent lookup timed out; continuing without tracking');
      return false;
    }
    return result;
  } catch (error) {
    logger.warn('[createInscription] Marketing consent lookup unavailable; continuing without tracking', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};
