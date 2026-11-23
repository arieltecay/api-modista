import assert from 'node:assert/strict';
import test, { after, before, beforeEach, mock } from 'node:test';
import mongoose from 'mongoose';
import Coupon from '../../models/Coupon/index.js';
import Inscription from '../../models/Inscription.js';
import { listIndexKeys, startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { logger } from '../logger.js';
import { claimSeat } from './reservation.js';
import { confirmCouponUse, findCouponByCode, getCouponStats, getCouponSummary, updateCoupon as updateCouponService } from './index.js';

let stopDb: () => Promise<void>;
before(async () => {
  stopDb = await startTestDb();
  await Coupon.init();
  await Inscription.init();
});
after(async () => stopDb());
beforeEach(async () => {
  await Coupon.deleteMany({});
  await Inscription.deleteMany({});
});

const createCoupon = (overrides: Record<string, unknown> = {}) =>
  Coupon.create({
    code: 'MODISTA20',
    type: 'percent',
    value: 20,
    courseId: 'course-uuid',
    startsAt: new Date('2026-11-01T00:00:00Z'),
    endsAt: new Date('2026-11-30T23:59:59Z'),
    ...overrides,
  });

let counter = 0;
const createInscription = (overrides: Record<string, unknown> = {}) => {
  counter += 1;
  return Inscription.create({
    nombre: 'Beatriz',
    apellido: 'Mendoza',
    email: `beatriz${counter}@example.com`,
    celular: '3815551234',
    courseId: 'course-uuid',
    courseTitle: 'CURSO ONLINE',
    coursePrice: 16720,
    ...overrides,
  });
};

test('codes are stored uppercase, unique, and found ignoring case and spaces', async () => {
  await createCoupon({ code: ' modista20 ' });

  assert.equal((await findCouponByCode('modista20'))?.code, 'MODISTA20');
  assert.equal((await findCouponByCode('  Modista20  '))?.code, 'MODISTA20');
  assert.equal(await findCouponByCode('OTRO'), null);
  await assert.rejects(createCoupon({ code: 'MODISTA20' }), /E11000|duplicate/);
});

test('the schema rejects a percent over 99, a non positive value and an inverted window', async () => {
  await assert.rejects(createCoupon({ code: 'A1', type: 'percent', value: 100 }));
  await assert.rejects(createCoupon({ code: 'A2', type: 'percent', value: 0 }));
  await assert.rejects(createCoupon({ code: 'A3', type: 'fixed', value: -5 }));
  await assert.rejects(
    createCoupon({ code: 'A4', startsAt: new Date('2026-12-01T00:00:00Z'), endsAt: new Date('2026-11-01T00:00:00Z') })
  );
});

test('confirming a paid inscription counts one use, and a repeated webhook does not count it twice', async () => {
  const coupon = await createCoupon();
  const inscription = await createInscription({ couponId: coupon._id, couponCode: coupon.code, discountAmount: 4180, listPrice: 20900 });

  await confirmCouponUse(String(inscription._id));
  await confirmCouponUse(String(inscription._id));

  assert.equal((await Coupon.findById(coupon._id))?.usedCount, 1);
});

test('confirming runs once even when two webhooks arrive at the same time', async () => {
  const coupon = await createCoupon();
  const inscription = await createInscription({ couponId: coupon._id, couponCode: coupon.code });

  await Promise.all([confirmCouponUse(String(inscription._id)), confirmCouponUse(String(inscription._id))]);

  assert.equal((await Coupon.findById(coupon._id))?.usedCount, 1);
});

test('confirming an inscription without coupon, or an unknown one, changes nothing', async () => {
  const coupon = await createCoupon();
  const plain = await createInscription();

  await confirmCouponUse(String(plain._id));
  await confirmCouponUse(String(new mongoose.Types.ObjectId()));

  assert.equal((await Coupon.findById(coupon._id))?.usedCount, 0);
});

test('if the counter cannot be incremented the claim is released, so the next webhook still counts the use', async () => {
  const coupon = await createCoupon();
  const inscription = await createInscription({ couponId: coupon._id, couponCode: coupon.code });
  const original = Coupon.findOneAndUpdate.bind(Coupon);
  (Coupon as { findOneAndUpdate: unknown }).findOneAndUpdate = () => ({
    lean: async () => {
      throw new Error('db down');
    },
  });

  try {
    await assert.rejects(confirmCouponUse(String(inscription._id)), /db down/);
  } finally {
    (Coupon as { findOneAndUpdate: unknown }).findOneAndUpdate = original;
  }

  assert.equal((await Inscription.findById(inscription._id))?.couponConfirmedAt, undefined);
  await confirmCouponUse(String(inscription._id));
  assert.equal((await Coupon.findById(coupon._id))?.usedCount, 1);
});

test('stats count only paid inscriptions as uses and add discount and net revenue', async () => {
  const coupon = await createCoupon();
  const base = { couponId: coupon._id, couponCode: coupon.code, listPrice: 20900, discountAmount: 4180, coursePrice: 16720 };
  await createInscription({ ...base, paymentStatus: 'paid', paymentDate: new Date('2026-11-10T15:00:00Z') });
  await createInscription({ ...base, paymentStatus: 'paid', paymentDate: new Date('2026-11-10T20:00:00Z') });
  await createInscription({ ...base, paymentStatus: 'paid', paymentDate: new Date('2026-11-12T15:00:00Z') });
  await createInscription({ ...base, paymentStatus: 'pending' });
  await createInscription(); // without coupon: must not leak in

  const stats = await getCouponStats(String(coupon._id), 'America/Argentina/Tucuman');

  assert.equal(stats.started, 4);
  assert.equal(stats.uses, 3);
  assert.equal(stats.discountTotal, 12540);
  assert.equal(stats.netRevenue, 50160);
  assert.deepEqual(stats.daily, [
    { day: '2026-11-10', uses: 2 },
    { day: '2026-11-12', uses: 1 },
  ]);
  assert.equal(stats.recent.length, 4);
  assert.equal(JSON.stringify(stats.recent).includes('@example.com'), false);
});

test('a payment at 23:30 in Tucumán counts for that local day, not for the next UTC day', async () => {
  const coupon = await createCoupon();
  const base = { couponId: coupon._id, couponCode: coupon.code, listPrice: 20900, discountAmount: 4180, coursePrice: 16720 };
  await createInscription({ ...base, paymentStatus: 'paid', paymentDate: new Date('2026-11-11T02:30:00Z') }); // 10/11 23:30 ART

  const stats = await getCouponStats(String(coupon._id), 'America/Argentina/Tucuman');

  assert.deepEqual(stats.daily, [{ day: '2026-11-10', uses: 1 }]);
  assert.deepEqual((await getCouponStats(String(coupon._id), 'UTC')).daily, [{ day: '2026-11-11', uses: 1 }]);
});

test('a partial payment is not a use, and a paid inscription without date counts but has no day', async () => {
  const coupon = await createCoupon();
  const base = { couponId: coupon._id, couponCode: coupon.code, listPrice: 20900, discountAmount: 4180, coursePrice: 16720 };
  await createInscription({ ...base, paymentStatus: 'partial', paymentDate: new Date('2026-11-10T15:00:00Z') });
  await createInscription({ ...base, paymentStatus: 'paid' });

  const stats = await getCouponStats(String(coupon._id));

  assert.equal(stats.started, 2);
  assert.equal(stats.uses, 1);
  assert.deepEqual(stats.daily, []);
});

test('a code that is not plain ASCII never matches a coupon, even if it uppercases into one', async () => {
  await createCoupon({ code: 'SSS' });

  assert.equal(await findCouponByCode('ßs'), null);
  assert.equal((await findCouponByCode(' sss '))?.code, 'SSS');
});

test('a coupon without sales reports zeros and empty lists', async () => {
  const coupon = await createCoupon();

  const stats = await getCouponStats(String(coupon._id), 'America/Argentina/Tucuman');

  assert.deepEqual({ ...stats, recent: stats.recent.length }, { started: 0, uses: 0, discountTotal: 0, netRevenue: 0, daily: [], recent: 0 });
});

test('the summary adds up every coupon and counts the active ones inside their window', async () => {
  const live = await createCoupon({ code: 'LIVE' });
  await createCoupon({ code: 'PAUSED', active: false });
  await createCoupon({ code: 'OLD', endsAt: new Date('2026-01-31T00:00:00Z'), startsAt: new Date('2026-01-01T00:00:00Z') });
  await createInscription({
    couponId: live._id, couponCode: 'LIVE', paymentStatus: 'paid', paymentDate: new Date('2026-11-10T15:00:00Z'),
    listPrice: 20900, discountAmount: 4180, coursePrice: 16720,
  });

  const summary = await getCouponSummary(new Date('2026-11-23T15:00:00Z'));

  assert.deepEqual(summary, { activeCoupons: 1, uses: 1, discountTotal: 4180, netRevenue: 16720 });
});

test('a payment approved after its seat was lost is still counted, and the overuse is reported', async () => {
  const coupon = await createCoupon({ maxUses: 1, usedCount: 1 });
  const inscription = await createInscription({ couponId: coupon._id, couponCode: coupon.code });
  const warn = mock.method(logger, 'warn', () => logger);

  try {
    await confirmCouponUse(String(inscription._id));
  } finally {
    warn.mock.restore();
  }

  assert.equal((await Coupon.findById(coupon._id))?.usedCount, 2);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0].arguments[0]), /sobreuso/i);
});

test('changing the cap: it cannot go below what is already used or held', async () => {
  const coupon = await createCoupon({ maxUses: 5, usedCount: 2 });
  await claimSeat(coupon._id, new mongoose.Types.ObjectId(), new Date());

  const tooLow = await updateCouponService(String(coupon._id), { maxUses: 2 });
  const enough = await updateCouponService(String(coupon._id), { maxUses: 3 });

  assert.equal(tooLow.ok, false);
  assert.equal(tooLow.ok === false && tooLow.reason, 'invalid');
  assert.equal(enough.ok, true);
});

test('giving a cap to a coupon that had none turns its live reservations into seats', async () => {
  const coupon = await createCoupon({ maxUses: null });
  const base = { couponId: coupon._id, couponCode: coupon.code, listPrice: 20900, discountAmount: 4180, coursePrice: 16720 };
  await createInscription({ ...base, couponReservedAt: new Date(Date.now() - 10 * 60 * 1000) });
  await createInscription({ ...base, couponReservedAt: new Date(Date.now() - 20 * 60 * 1000) });
  await createInscription({ ...base, couponReservedAt: new Date(Date.now() - 200 * 60 * 1000) }); // its 60 minutes are over

  const result = await updateCouponService(String(coupon._id), { maxUses: 3 });

  assert.equal(result.ok, true);
  assert.equal((await Coupon.findById(coupon._id))?.seats.length, 2);
  assert.equal(await claimSeat(coupon._id, new mongoose.Types.ObjectId(), new Date()), true);
  assert.equal(await claimSeat(coupon._id, new mongoose.Types.ObjectId(), new Date()), false);
});

test('coupons are indexed for the availability question (active and end date)', async () => {
  const keys = await listIndexKeys(Coupon);

  assert.ok(keys.some((key) => key.active === 1 && key.endsAt === 1), JSON.stringify(keys));
});
