import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import type { Request, Response } from 'express';
import Coupon from '../../models/Coupon/index.js';
import Inscription from '../../models/Inscription.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';

let stopDb: () => Promise<void>;
let createPreference: typeof import('./paymentController.js').createPreference;
let preferenceBodies: Array<Record<string, any>>;

before(async () => {
  process.env.MERCADO_PAGO_ACCESS_TOKEN = 'test-token'; // read when the MercadoPago client loads
  stopDb = await startTestDb();
  await Promise.all([Coupon.init(), Inscription.init()]);
  ({ createPreference } = await import('./paymentController.js'));
  const { mpPreference } = await import('../../services/payments/mpClient.js');
  (mpPreference as { create: unknown }).create = async ({ body }: { body: Record<string, any> }) => {
    preferenceBodies.push(body);
    return { id: 'pref-retry', init_point: 'https://mp/init', sandbox_init_point: 'https://mp/sandbox' };
  };
});
after(async () => stopDb());
beforeEach(async () => {
  await Promise.all([Coupon.deleteMany({}), Inscription.deleteMany({})]);
  preferenceBodies = [];
});

const MINUTE = 60 * 1000;
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * MINUTE);

const respond = () => {
  const out: { status: number; body: Record<string, any> | undefined } = { status: 200, body: undefined };
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(payload: Record<string, any>) {
      out.body = payload;
      return res;
    },
  };
  return { res: res as unknown as Response, out };
};

const retry = async (inscriptionId: unknown) => {
  const { res, out } = respond();
  await createPreference({ body: { inscriptionId: String(inscriptionId) } } as Request<{}, {}, { inscriptionId: string }>, res);
  return out;
};

const createCoupon = (overrides: Record<string, unknown> = {}) =>
  Coupon.create({
    code: 'MODISTA20', type: 'percent', value: 20, courseId: 'course-uuid', maxUses: 1,
    startsAt: new Date(Date.now() - 24 * 60 * MINUTE), endsAt: new Date(Date.now() + 24 * 60 * MINUTE), ...overrides,
  });

let counter = 0;
const createInscription = (overrides: Record<string, unknown> = {}) => {
  counter += 1;
  return Inscription.create({
    nombre: 'Beatriz', apellido: 'Mendoza', email: `r${counter}@example.com`, celular: '3815551234', courseId: 'course-uuid',
    courseTitle: 'Curso', coursePrice: 16720, ...overrides,
  });
};
const withCoupon = (coupon: { _id: unknown; code: string }, reservedMinutesAgo: number) => ({
  listPrice: 20900, discountAmount: 4180, couponId: coupon._id, couponCode: coupon.code,
  couponReservedAt: minutesAgo(reservedMinutesAgo), fechaInscripcion: minutesAgo(reservedMinutesAgo),
});
/** Puts the seat of an inscription in the coupon, as `createInscription` does. */
const holdSeat = (coupon: { _id: unknown }, inscription: { _id: unknown }, reservedMinutesAgo: number) =>
  Coupon.updateOne({ _id: coupon._id }, { $push: { seats: { inscriptionId: inscription._id, until: new Date(Date.now() + (60 - reservedMinutesAgo) * MINUTE) } } });

test('retrying inside the reservation charges the discounted price and the preference expires in 60 minutes', async () => {
  const coupon = await createCoupon();
  const inscription = await createInscription(withCoupon(coupon, 10));
  await holdSeat(coupon, inscription, 10);

  const answer = await retry(inscription._id);

  assert.equal(answer.status, 200);
  assert.equal(preferenceBodies[0].items[0].unit_price, 16720);
  assert.equal(preferenceBodies[0].expires, true);
  const expiresIn = Date.parse(String(preferenceBodies[0].expiration_date_to)) - Date.now();
  assert.ok(expiresIn > 49 * MINUTE && expiresIn <= 50 * MINUTE, 'the preference ends with the seat (50 minutes left), not 60 more');
});

test('retrying after the reservation ended starts a new one while the coupon still has a seat', async () => {
  const coupon = await createCoupon();
  const inscription = await createInscription(withCoupon(coupon, 120));

  const answer = await retry(inscription._id);

  assert.equal(answer.status, 200);
  const reservedAt = (await Inscription.findById(inscription._id))?.couponReservedAt?.getTime() ?? 0;
  assert.ok(Date.now() - reservedAt < 5000, 'the reservation was renewed');
});

test('retrying after the reservation ended is refused if someone else took the last seat', async () => {
  const coupon = await createCoupon();
  const late = await createInscription(withCoupon(coupon, 120));
  const other = await createInscription(withCoupon(coupon, 5));
  await holdSeat(coupon, other, 5);

  const answer = await retry(late._id);

  assert.equal(answer.status, 409);
  assert.equal(answer.body?.code, 'coupon_unavailable');
  assert.equal(answer.body?.message, 'El cupón ya no está disponible');
  assert.equal(preferenceBodies.length, 0);
});

test('retrying is refused when the coupon was paused after the reservation ended', async () => {
  const coupon = await createCoupon({ active: false });
  const inscription = await createInscription(withCoupon(coupon, 120));

  assert.equal((await retry(inscription._id)).status, 409);
});

test('an inscription without coupon retries exactly as before, with no expiry', async () => {
  const inscription = await createInscription({ coursePrice: 20900 });

  const answer = await retry(inscription._id);

  assert.equal(answer.status, 200);
  assert.equal(preferenceBodies[0].items[0].unit_price, 20900);
  assert.equal('expires' in preferenceBodies[0], false);
});
