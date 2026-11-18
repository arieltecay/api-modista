import type { IncomingHttpHeaders } from 'node:http';
import { hasCurrentMetaMarketingConsent } from '../privacy/marketingConsent.js';
import { isMetaMarketingConsentGranted } from '../../utils/metaMarketingConsent.js';
import { purgeVisitorData } from './index.js';

const firstValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/**
 * Returns the visitor id (X-Session-Id) only when the request carries a granted, current
 * marketing consent for it; otherwise undefined and nothing identifiable may be recorded.
 */
export const getConsentedVisitorId = async (headers: IncomingHttpHeaders): Promise<string | undefined> => {
  const consent = headers['x-meta-consent'];
  const version = headers['x-meta-consent-version'];
  const visitorId = firstValue(headers['x-session-id']);
  if (!visitorId || !isMetaMarketingConsentGranted(consent, version)) return undefined;

  return (await hasCurrentMetaMarketingConsent(visitorId, firstValue(version))) ? visitorId : undefined;
};

/**
 * Re-checks consent after a write: a revocation that landed between the first check and the write
 * has already run its cleanup, so the late record must be removed here. True when it purged.
 */
export const purgeIfConsentRevoked = async (headers: IncomingHttpHeaders, visitorId: string): Promise<boolean> => {
  if (await getConsentedVisitorId(headers)) return false;
  await purgeVisitorData(visitorId);
  return true;
};
