import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';
import { Types } from 'mongoose';
import AcquisitionEvent from '../../models/AcquisitionEvent/index.js';
import AcquisitionSignalAttempt from '../../models/AcquisitionSignalAttempt/index.js';
import AcquisitionVisit from '../../models/AcquisitionVisit/index.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { parseInscriptionId, recordCapiDelivery, recordServerConversion } from './serverEvents.js';

let stopDb: () => Promise<void>;

before(async () => {
  stopDb = await startTestDb();
  await Promise.all([AcquisitionEvent.init(), AcquisitionSignalAttempt.init(), AcquisitionVisit.init()]);
});
after(async () => stopDb());
beforeEach(async () => {
  process.env.ACQUISITION_TRACKING_ENABLED = 'true';
  await Promise.all([AcquisitionEvent.deleteMany({}), AcquisitionSignalAttempt.deleteMany({}), AcquisitionVisit.deleteMany({})]);
});

const NOW = new Date();
const minutes = (offset: number) => new Date(NOW.getTime() + offset * 60_000);
/** A real inscription id: an ObjectId carries the second it was created. */
const inscriptionCreatedAt = (offsetMinutes: number) =>
  Types.ObjectId.createFromTime(Math.floor(minutes(offsetMinutes).getTime() / 1000)).toHexString();

const seedVisit = async (visitorId: string, startedAt: Date) => {
  const visitId = randomUUID();
  await AcquisitionVisit.create({
    visitId, visitorId, startedAt, lastActivityAt: startedAt, entryPath: '/lp/curso',
    classification: { sourcePlatform: 'instagram', acquisitionType: 'paid', channelGroup: 'meta_paid', reason: 'paid_medium', classifierVersion: 1 },
    consentVersion: 'v1',
  });
  return visitId;
};

const META_NAME = { lead: 'Lead', checkout: 'InitiateCheckout', purchase: 'Purchase' } as const;
const conversion = (
  visitorId: string | undefined,
  kind: keyof typeof META_NAME,
  inscriptionId: string,
  overrides: Record<string, unknown> = {},
) => ({
  eventName: META_NAME[kind],
  eventId: `${kind}_${inscriptionId}`,
  occurredAt: NOW,
  visitorId,
  inscriptionId,
  courseId: 'course-1',
  ...overrides,
});

const savedEvent = (name: string) => AcquisitionEvent.findOne({ name }).lean();

test('parses the inscription id out of deterministic CAPI event ids', () => {
  const id = 'a'.repeat(24);
  for (const kind of ['lead', 'checkout', 'purchase']) assert.equal(parseInscriptionId(`${kind}_${id}`), id);
  for (const value of ['view_content_abc', 'lead_xyz', `lead_${id}0`, '']) assert.equal(parseInscriptionId(value), undefined, value);
});

test('a lead becomes a server event linked to the visit current when the inscription was created, without value', async () => {
  const visitorId = randomUUID();
  await seedVisit(visitorId, minutes(-120));
  const current = await seedVisit(visitorId, minutes(-10));
  const inscriptionId = inscriptionCreatedAt(-5);

  await recordServerConversion(conversion(visitorId, 'lead', inscriptionId));
  const saved = await savedEvent('lead');
  assert.equal(saved?.source, 'server');
  assert.equal(saved?.visitId, current);
  assert.equal(saved?.visitorId, visitorId);
  assert.equal(saved?.inscriptionId, inscriptionId);
  assert.equal(saved?.courseId, 'course-1');
  assert.equal(saved?.value, undefined);
});

test('lead, checkout and purchase share one visit even when fired concurrently or days later', async () => {
  const visitorId = randomUUID();
  const leadVisit = await seedVisit(visitorId, minutes(-60 * 24 * 3));
  const inscriptionId = inscriptionCreatedAt(-60 * 24 * 3 + 5);
  await seedVisit(visitorId, minutes(-30)); // the buyer came back later through another visit

  await Promise.all([
    recordServerConversion(conversion(visitorId, 'lead', inscriptionId, { occurredAt: minutes(-60 * 24 * 3 + 5) })),
    recordServerConversion(conversion(visitorId, 'checkout', inscriptionId, { occurredAt: minutes(-60 * 24 * 3 + 5) })),
    recordServerConversion(conversion(visitorId, 'purchase', inscriptionId)),
  ]);
  for (const name of ['lead', 'initiate_checkout', 'purchase']) assert.equal((await savedEvent(name))?.visitId, leadVisit, name);
});

test('a visit that started before the inscription wins over one that started slightly after', async () => {
  const visitorId = randomUUID();
  const before_ = await seedVisit(visitorId, minutes(-10));
  await seedVisit(visitorId, minutes(2));
  await recordServerConversion(conversion(visitorId, 'lead', inscriptionCreatedAt(0)));
  assert.equal((await savedEvent('lead'))?.visitId, before_);
});

test('a visit slightly ahead of the server clock is used only when nothing started before', async () => {
  const visitorId = randomUUID();
  const ahead = await seedVisit(visitorId, minutes(3));
  await recordServerConversion(conversion(visitorId, 'lead', inscriptionCreatedAt(0)));
  assert.equal((await savedEvent('lead'))?.visitId, ahead);
});

test('visits that started well after the inscription are never used', async () => {
  const visitorId = randomUUID();
  await seedVisit(visitorId, minutes(60));
  await recordServerConversion(conversion(visitorId, 'purchase', inscriptionCreatedAt(0)));
  assert.equal(await AcquisitionEvent.countDocuments(), 0);
});

test('two visitors never borrow each other’s visit, even with a repeated inscription id', async () => {
  const [first, second] = [randomUUID(), randomUUID()];
  const firstVisit = await seedVisit(first, minutes(-20));
  const secondVisit = await seedVisit(second, minutes(-20));
  const inscriptionId = inscriptionCreatedAt(-5);
  await recordServerConversion(conversion(first, 'lead', inscriptionId));
  await recordServerConversion(conversion(second, 'purchase', inscriptionId));
  assert.equal((await savedEvent('lead'))?.visitId, firstVisit);
  assert.equal((await savedEvent('purchase'))?.visitId, secondVisit);
});

test('an invalid orderId falls back to the inscription id inside the eventId, then to the event time', async () => {
  const visitorId = randomUUID();
  const visitId = await seedVisit(visitorId, minutes(-1000));
  await seedVisit(visitorId, minutes(-1));
  const inscriptionId = inscriptionCreatedAt(-900);
  await recordServerConversion(conversion(visitorId, 'purchase', 'not-an-id', { eventId: `purchase_${inscriptionId}` }));
  const saved = await savedEvent('purchase');
  assert.equal(saved?.visitId, visitId);
  assert.equal(saved?.inscriptionId, inscriptionId);

  await recordServerConversion(conversion(visitorId, 'lead', 'not-an-id', { eventId: 'lead_xyz' }));
  assert.equal((await savedEvent('lead'))?.inscriptionId, undefined);
});

test('repeated emissions of the same conversion are recorded once', async () => {
  const visitorId = randomUUID();
  await seedVisit(visitorId, minutes(-5));
  const inscriptionId = inscriptionCreatedAt(-2);
  for (let i = 0; i < 3; i += 1) {
    await recordServerConversion(conversion(visitorId, 'purchase', inscriptionId, { occurredAt: minutes(i) }));
  }
  assert.equal(await AcquisitionEvent.countDocuments({ name: 'purchase' }), 1);
});

test('no event without a linkable visit, a visitor id, or for non-conversion Meta events', async () => {
  const visitorId = randomUUID();
  const inscriptionId = inscriptionCreatedAt(0);
  await recordServerConversion(conversion(visitorId, 'lead', inscriptionId)); // visitor never had a visit
  await recordServerConversion(conversion(undefined, 'lead', inscriptionId));
  await seedVisit(visitorId, minutes(-1));
  await recordServerConversion(conversion(visitorId, 'lead', inscriptionId, { eventName: 'ViewContent', eventId: 'view_content_x' }));
  await recordServerConversion(conversion(visitorId, 'lead', inscriptionId, { eventName: 'PageView', eventId: 'pageview_x' }));
  assert.equal(await AcquisitionEvent.countDocuments(), 0);
});

test('everything is a no-op while the feature flag is off', async () => {
  process.env.ACQUISITION_TRACKING_ENABLED = 'false';
  const visitorId = randomUUID();
  await seedVisit(visitorId, minutes(-5));
  const lead = conversion(visitorId, 'lead', inscriptionCreatedAt(0));
  await recordServerConversion(lead);
  await recordCapiDelivery(lead, { accepted: true, delivered: true });
  assert.equal(await AcquisitionEvent.countDocuments(), 0);
  assert.equal(await AcquisitionSignalAttempt.countDocuments(), 0);
});

test('CAPI delivery is projected as accepted or delivered, and not at all when not accepted', async () => {
  const visitorId = randomUUID();
  const base = conversion(visitorId, 'lead', inscriptionCreatedAt(0));
  await recordCapiDelivery({ ...base, eventId: 'e-accepted' }, { accepted: true, delivered: false });
  await recordCapiDelivery({ ...base, eventId: 'e-delivered' }, { accepted: true, delivered: true });
  await recordCapiDelivery({ ...base, eventId: 'e-rejected' }, { accepted: false, delivered: false });
  const status = async (eventId: string) => (await AcquisitionSignalAttempt.findOne({ eventId, channel: 'server_capi' }).lean())?.status;
  assert.equal(await status('e-accepted'), 'accepted');
  assert.equal(await status('e-delivered'), 'delivered');
  assert.equal(await status('e-rejected'), undefined);
});

test('CAPI health also covers events that are not conversions (ViewContent, PageView)', async () => {
  const base = conversion(randomUUID(), 'lead', inscriptionCreatedAt(0));
  await recordCapiDelivery({ ...base, eventName: 'ViewContent', eventId: 'view_content_1' }, { accepted: true, delivered: true });
  assert.equal(await AcquisitionSignalAttempt.countDocuments({ eventId: 'view_content_1' }), 1);
});

test('persistence failures never throw into the payment or inscription flow', async () => {
  const visitorId = randomUUID();
  await seedVisit(visitorId, minutes(-1));
  const broken = conversion(visitorId, 'lead', inscriptionCreatedAt(0), { occurredAt: new Date('invalid') });
  await assert.doesNotReject(recordServerConversion(broken));
  await assert.doesNotReject(recordCapiDelivery(broken, { accepted: true, delivered: true }));
});
