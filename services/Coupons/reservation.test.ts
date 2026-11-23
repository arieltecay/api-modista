import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import mongoose from 'mongoose';
import Coupon from '../../models/Coupon/index.js';
import Inscription from '../../models/Inscription.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { confirmCouponUse, priceWithCoupon } from './index.js';
import { claimSeat, liveSeats, mercadoPagoExpiration, releaseSeat, restoreReservation } from './reservation.js';

let stopDb: () => Promise<void>;
before(async () => {
  stopDb = await startTestDb();
  await Promise.all([Coupon.init(), Inscription.init()]);
});
after(async () => stopDb());
beforeEach(async () => {
  await Coupon.deleteMany({});
  await Inscription.deleteMany({});
});

const MINUTE = 60 * 1000;
const NOW = new Date('2026-11-23T15:00:00Z');
const at = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);
const id = () => new mongoose.Types.ObjectId();

const createCoupon = (overrides: Record<string, unknown> = {}) =>
  Coupon.create({
    code: 'MODISTA20', type: 'percent', value: 20, courseId: 'course-uuid', maxUses: 1,
    startsAt: new Date('2026-11-01T00:00:00Z'), endsAt: new Date('2026-11-30T23:59:59Z'), ...overrides,
  });
const seatsOf = async (couponId: unknown) => (await Coupon.findById(couponId))?.seats ?? [];

let counter = 0;
const createInscription = (coupon: { _id: unknown; code: string }, overrides: Record<string, unknown> = {}) => {
  counter += 1;
  return Inscription.create({
    nombre: 'Beatriz', apellido: 'Mendoza', email: `b${counter}@example.com`, celular: '3815551234', courseId: 'course-uuid',
    courseTitle: 'Curso', coursePrice: 16720, listPrice: 20900, discountAmount: 4180, couponId: coupon._id, couponCode: coupon.code,
    fechaInscripcion: at(-5), couponReservedAt: at(-5), ...overrides,
  });
};

// ---- the seat list is the authority ----

test('seats are given until the cap and the next buyer is refused', async () => {
  const coupon = await createCoupon({ maxUses: 2 });

  const results = [await claimSeat(coupon._id, id(), NOW), await claimSeat(coupon._id, id(), NOW), await claimSeat(coupon._id, id(), NOW)];

  assert.deepEqual(results, [true, true, false]);
  assert.equal((await seatsOf(coupon._id)).length, 2);
});

test('a seat is held for 60 minutes and is free for the next buyer one minute later', async () => {
  const coupon = await createCoupon({ maxUses: 1 });
  const first = id();
  assert.equal(await claimSeat(coupon._id, first, NOW), true);

  assert.equal(await claimSeat(coupon._id, id(), at(59)), false);
  assert.equal(await claimSeat(coupon._id, id(), at(61)), true);
  assert.equal((await seatsOf(coupon._id)).length, 1, 'the expired seat was dropped');
});

test('asking again for the same inscription renews its seat instead of taking another', async () => {
  const coupon = await createCoupon({ maxUses: 2 });
  const mine = id();

  await claimSeat(coupon._id, mine, NOW);
  assert.equal(await claimSeat(coupon._id, mine, at(30)), true);

  const seats = await seatsOf(coupon._id);
  assert.equal(seats.length, 1);
  assert.equal(seats[0].until?.getTime(), at(90).getTime());
});

test('many people racing, even with clocks that disagree, get exactly as many seats as the cap allows', async () => {
  const coupon = await createCoupon({ maxUses: 5 });

  const results = await Promise.all(Array.from({ length: 40 }, (_, index) => claimSeat(coupon._id, id(), at((index % 7) - 3))));

  assert.equal(results.filter(Boolean).length, 5);
  assert.equal((await seatsOf(coupon._id)).length, 5);
});

test('uses already confirmed count against the cap', async () => {
  const coupon = await createCoupon({ maxUses: 2, usedCount: 2 });

  assert.equal(await claimSeat(coupon._id, id(), NOW), false);
});

test('a coupon without cap needs no seat and writes none', async () => {
  const coupon = await createCoupon({ maxUses: null });

  assert.equal(await claimSeat(coupon._id, id(), NOW), true);
  assert.equal((await seatsOf(coupon._id)).length, 0);
});

test('an unknown coupon gives no seat', async () => {
  assert.equal(await claimSeat(id(), id(), NOW), false);
});

test('releasing a seat frees it', async () => {
  const coupon = await createCoupon({ maxUses: 1 });
  const mine = id();
  await claimSeat(coupon._id, mine, NOW);

  await releaseSeat(coupon._id, mine);

  assert.equal(await claimSeat(coupon._id, id(), NOW), true);
});

test('lowering the cap below the reserved seats keeps them but admits nobody new', async () => {
  const coupon = await createCoupon({ maxUses: 3 });
  for (let index = 0; index < 3; index += 1) await claimSeat(coupon._id, id(), NOW);

  await Coupon.updateOne({ _id: coupon._id }, { maxUses: 1 });

  assert.equal(await claimSeat(coupon._id, id(), NOW), false);
  assert.equal((await seatsOf(coupon._id)).length, 3);
});

test('liveSeats counts only the seats still held and can leave one out', () => {
  const mine = id();
  const seats = [{ inscriptionId: mine, until: at(10) }, { inscriptionId: id(), until: at(10) }, { inscriptionId: id(), until: at(-1) }];

  assert.equal(liveSeats(seats, NOW), 2);
  assert.equal(liveSeats(seats, NOW, mine), 1);
  assert.equal(liveSeats(undefined, NOW), 0);
});

// ---- price and confirmation ----

test('a coupon whose last seats are held is exhausted for the next buyer, and free again when they end', async () => {
  const coupon = await createCoupon({ maxUses: 1 });
  await claimSeat(coupon._id, id(), new Date());
  const purchase = { courseId: 'course-uuid', price: 20900 };

  const blocked = await priceWithCoupon('MODISTA20', purchase, new Date());
  const freed = await priceWithCoupon('MODISTA20', purchase, new Date(Date.now() + 61 * MINUTE));

  assert.deepEqual(blocked, { valid: false, reason: 'exhausted' });
  assert.equal(freed.valid, true);
});

test('confirming a payment turns the seat of that inscription into a counted use, once', async () => {
  const coupon = await createCoupon({ maxUses: 2 });
  const inscription = await createInscription(coupon);
  await claimSeat(coupon._id, inscription._id, new Date());
  await claimSeat(coupon._id, id(), new Date());

  await confirmCouponUse(String(inscription._id));
  await confirmCouponUse(String(inscription._id));

  const stored = await Coupon.findById(coupon._id);
  assert.equal(stored?.usedCount, 1);
  assert.equal(stored?.seats.length, 1, 'only the other buyer keeps a seat');
});

test('the MercadoPago preference of a coupon expires exactly when its seat does', () => {
  const expiration = mercadoPagoExpiration(NOW, at(20));

  assert.equal(expiration.expires, true);
  assert.equal(expiration.expiration_date_from, '2026-11-23T15:00:00.000+00:00');
  assert.equal(expiration.expiration_date_to, '2026-11-23T15:20:00.000+00:00');
});

// ---- retrying a payment ----

test('retrying while the seat is still held changes nothing and keeps the same expiry', async () => {
  const coupon = await createCoupon();
  const inscription = await createInscription(coupon);
  await claimSeat(coupon._id, inscription._id, at(-10));

  const result = await restoreReservation(inscription, NOW);

  assert.deepEqual(result, { ok: true, until: at(50) });
});

test('retrying after the seat ended takes a new one if the coupon still has room', async () => {
  const coupon = await createCoupon({ maxUses: 1 });
  const inscription = await createInscription(coupon, { fechaInscripcion: at(-120) });
  await claimSeat(coupon._id, inscription._id, at(-120));

  const result = await restoreReservation(inscription, NOW);

  assert.deepEqual(result, { ok: true, until: at(60) });
  assert.equal((await seatsOf(coupon._id)).length, 1);
});

test('retrying after the seat ended fails if somebody else holds the last one', async () => {
  const coupon = await createCoupon({ maxUses: 1 });
  const late = await createInscription(coupon, { fechaInscripcion: at(-120) });
  await claimSeat(coupon._id, late._id, at(-120));
  await claimSeat(coupon._id, id(), at(-5));

  assert.deepEqual(await restoreReservation(late, NOW), { ok: false });
});

test('two retries racing for one free seat: exactly one gets it', async () => {
  const coupon = await createCoupon({ maxUses: 1 });
  const first = await createInscription(coupon, { fechaInscripcion: at(-120), couponReservedAt: at(-120) });
  const second = await createInscription(coupon, { fechaInscripcion: at(-120), couponReservedAt: at(-120) });

  const results = await Promise.all([restoreReservation(first, NOW), restoreReservation(second, at(1))]);

  assert.equal(results.filter((result) => result.ok).length, 1);
});

test('an inscription that is too old is not renewed, however free the coupon is', async () => {
  const coupon = await createCoupon();
  const old = await createInscription(coupon, { fechaInscripcion: at(-25 * 60), couponReservedAt: at(-25 * 60) });

  assert.deepEqual(await restoreReservation(old, NOW), { ok: false });
});

test('retrying fails if the coupon was paused or ended', async () => {
  const paused = await createCoupon({ code: 'PAUSED', active: false });
  const ended = await createCoupon({ code: 'ENDED', startsAt: new Date('2026-10-01T00:00:00Z'), endsAt: new Date('2026-10-31T00:00:00Z') });

  for (const coupon of [paused, ended]) {
    const inscription = await createInscription(coupon, { fechaInscripcion: at(-120), couponReservedAt: at(-120) });
    assert.deepEqual(await restoreReservation(inscription, NOW), { ok: false }, coupon.code);
  }
});

test('someone who already paid part keeps the discount: no revalidation, even if the coupon ended', async () => {
  const coupon = await createCoupon({ active: false });
  const partial = await createInscription(coupon, { paymentStatus: 'partial', fechaInscripcion: at(-300), couponReservedAt: at(-300) });

  assert.deepEqual(await restoreReservation(partial, NOW), { ok: true, until: at(60) });
});

test('a coupon without cap is renewed by its own reservation window', async () => {
  const coupon = await createCoupon({ maxUses: null });
  const recent = await createInscription(coupon, { couponReservedAt: at(-10) });
  const stale = await createInscription(coupon, { couponReservedAt: at(-90), fechaInscripcion: at(-90) });

  assert.deepEqual(await restoreReservation(recent, NOW), { ok: true, until: at(50) });
  assert.deepEqual(await restoreReservation(stale, NOW), { ok: true, until: at(60) });
  assert.equal((await Inscription.findById(stale._id))?.couponReservedAt?.getTime(), NOW.getTime());
});

test('a seat that is about to end is renewed when the person retries, so the new link is payable', async () => {
  const coupon = await createCoupon();
  const inscription = await createInscription(coupon);
  await claimSeat(coupon._id, inscription._id, at(-57)); // ends in 3 minutes

  const result = await restoreReservation(inscription, NOW);

  assert.deepEqual(result, { ok: true, until: at(60) });
  assert.equal((await seatsOf(coupon._id))[0].until?.getTime(), at(60).getTime());
});

test('a paused or ended coupon stops retries even while the seat is still held', async () => {
  const paused = await createCoupon({ code: 'PAUSED', active: false });
  const ended = await createCoupon({ code: 'ENDED', startsAt: new Date('2026-10-01T00:00:00Z'), endsAt: new Date('2026-11-23T14:00:00Z') });
  const uncapped = await createCoupon({ code: 'NOCAP', maxUses: null, active: false });

  for (const coupon of [paused, ended, uncapped]) {
    const inscription = await createInscription(coupon, { couponReservedAt: at(-10) });
    await claimSeat(coupon._id, inscription._id, at(-10));
    assert.deepEqual(await restoreReservation(inscription, NOW), { ok: false }, coupon.code);
  }
});

test('coupons saved before seats existed still admit exactly as many as the cap allows', async () => {
  const legacy = await Coupon.collection.insertOne({
    code: 'LEGACY', type: 'percent', value: 10, courseId: null, maxUses: 1, active: true,
    startsAt: new Date('2026-11-01T00:00:00Z'), endsAt: new Date('2026-11-30T00:00:00Z'),
  });

  const results = await Promise.all([claimSeat(legacy.insertedId, id(), NOW), claimSeat(legacy.insertedId, id(), NOW)]);

  assert.deepEqual(results.slice().sort(), [false, true]);
});

test('an inscription without coupon is never affected', async () => {
  const inscription = await Inscription.create({
    nombre: 'Ana', apellido: 'Pérez', email: 'ana@example.com', celular: '3815551235', courseId: 'course-uuid', courseTitle: 'Curso', coursePrice: 20900,
  });

  assert.equal((await restoreReservation(inscription, NOW)).ok, true);
});
