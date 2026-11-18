import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before } from 'node:test';
import AcquisitionEvent from '../../models/AcquisitionEvent/index.js';
import AcquisitionSignalAttempt from '../../models/AcquisitionSignalAttempt/index.js';
import AcquisitionVisit from '../../models/AcquisitionVisit/index.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { META_MARKETING_CONSENT_VERSION } from '../../utils/metaMarketingConsent.js';
import { hasCurrentMetaMarketingConsent, recordMetaMarketingConsent } from './marketingConsent.js';

let stopDb: () => Promise<void>;

before(async () => {
  stopDb = await startTestDb();
});
after(async () => stopDb());

const seed = async (visitorId: string) => {
  const visitId = randomUUID();
  const eventId = randomUUID();
  const now = new Date();
  await AcquisitionVisit.create({
    visitId,
    visitorId,
    startedAt: now,
    lastActivityAt: now,
    entryPath: '/lp/curso',
    classification: { sourcePlatform: 'unknown', acquisitionType: 'direct', channelGroup: 'direct', reason: 'direct_no_signals', classifierVersion: 1 },
    consentVersion: META_MARKETING_CONSENT_VERSION,
  });
  await AcquisitionEvent.create({ eventId, visitId, visitorId, name: 'page_view', occurredAt: now, source: 'browser' });
  await AcquisitionSignalAttempt.create({ eventId, visitId, visitorId, channel: 'browser_pixel', status: 'invoked', occurredAt: now });
  return { visitId, eventId };
};

const countFor = async (visitorId: string) => ({
  visits: await AcquisitionVisit.countDocuments({ visitorId }),
  events: await AcquisitionEvent.countDocuments({ visitorId }),
  signals: await AcquisitionSignalAttempt.countDocuments({ visitorId }),
});

test('revoking marketing consent deletes every acquisition record of that visitor and only theirs', async () => {
  const revoked = randomUUID();
  const kept = randomUUID();
  await recordMetaMarketingConsent(revoked, true);
  await recordMetaMarketingConsent(kept, true);
  await seed(revoked);
  await seed(kept);

  await recordMetaMarketingConsent(revoked, false);

  assert.deepEqual(await countFor(revoked), { visits: 0, events: 0, signals: 0 });
  assert.deepEqual(await countFor(kept), { visits: 1, events: 1, signals: 1 });
  assert.equal(await hasCurrentMetaMarketingConsent(revoked, META_MARKETING_CONSENT_VERSION), false);
  assert.equal(await hasCurrentMetaMarketingConsent(kept, META_MARKETING_CONSENT_VERSION), true);
});

test('granting consent does not delete anything', async () => {
  const visitorId = randomUUID();
  await seed(visitorId);
  await recordMetaMarketingConsent(visitorId, true);
  assert.deepEqual(await countFor(visitorId), { visits: 1, events: 1, signals: 1 });
});
