import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import AcquisitionEvent from '../../models/AcquisitionEvent/index.js';
import AcquisitionSignalAttempt from '../../models/AcquisitionSignalAttempt/index.js';
import AcquisitionVisit from '../../models/AcquisitionVisit/index.js';
import { META_MARKETING_CONSENT_VERSION } from '../../utils/metaMarketingConsent.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { recordMetaMarketingConsent } from '../privacy/marketingConsent.js';
import { purgeIfConsentRevoked } from './consent.js';

let stopDb: () => Promise<void>;

before(async () => {
  stopDb = await startTestDb();
});
after(async () => stopDb());

const headersFor = (visitorId: string) => ({
  'x-meta-consent': 'granted',
  'x-meta-consent-version': META_MARKETING_CONSENT_VERSION,
  'x-session-id': visitorId,
});

const lateWrite = async (visitorId: string) => {
  const now = new Date();
  const visitId = randomUUID();
  const eventId = randomUUID();
  await AcquisitionVisit.create({
    visitId, visitorId, startedAt: now, lastActivityAt: now, entryPath: '/',
    classification: { sourcePlatform: 'unknown', acquisitionType: 'direct', channelGroup: 'direct', reason: 'direct_no_signals', classifierVersion: 1 },
    consentVersion: META_MARKETING_CONSENT_VERSION,
  });
  await AcquisitionEvent.create({ eventId, visitId, visitorId, name: 'page_view', occurredAt: now, source: 'browser' });
  await AcquisitionSignalAttempt.create({ eventId, visitId, visitorId, channel: 'browser_pixel', status: 'invoked', occurredAt: now });
};

const total = async (visitorId: string) =>
  (await AcquisitionVisit.countDocuments({ visitorId })) +
  (await AcquisitionEvent.countDocuments({ visitorId })) +
  (await AcquisitionSignalAttempt.countDocuments({ visitorId }));

test('a write that raced with a revocation is purged after the fact', async () => {
  const visitorId = randomUUID();
  await recordMetaMarketingConsent(visitorId, true);
  await recordMetaMarketingConsent(visitorId, false);
  await lateWrite(visitorId); // the in-flight request wrote after the revocation cleanup ran
  assert.equal(await total(visitorId), 3);

  assert.equal(await purgeIfConsentRevoked(headersFor(visitorId), visitorId), true);
  assert.equal(await total(visitorId), 0);
});

test('with consent still valid nothing is purged', async () => {
  const visitorId = randomUUID();
  await recordMetaMarketingConsent(visitorId, true);
  await lateWrite(visitorId);
  assert.equal(await purgeIfConsentRevoked(headersFor(visitorId), visitorId), false);
  assert.equal(await total(visitorId), 3);
});
