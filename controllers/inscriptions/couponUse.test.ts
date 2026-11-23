import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import type { Request, Response } from 'express';
import Coupon from '../../models/Coupon/index.js';
import Inscription from '../../models/Inscription.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { assertOutboundBlocked, blockOutbound } from '../../utils/testing/noOutbound.js';

let stopDb: () => Promise<void>;
let controller: typeof import('./inscriptionsController.js');

before(async () => {
  // Mails in smtp mode without credentials fail fast and are only logged: nothing is written or sent.
  blockOutbound();
  stopDb = await startTestDb();
  await Promise.all([Coupon.init(), Inscription.init()]);
  controller = await import('./inscriptionsController.js');
  assertOutboundBlocked();
});
after(async () => stopDb());
beforeEach(async () => {
  await Promise.all([Coupon.deleteMany({}), Inscription.deleteMany({})]);
});

const respond = () => {
  const out: { status: number; body: unknown } = { status: 200, body: undefined };
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(payload: unknown) {
      out.body = payload;
      return res;
    },
  };
  return { res: res as unknown as Response, out };
};

const createCouponInscription = async () => {
  const coupon = await Coupon.create({
    code: 'MODISTA20', type: 'percent', value: 20, startsAt: new Date('2026-11-01T00:00:00Z'), endsAt: new Date('2026-11-30T23:59:59Z'),
  });
  const inscription = await Inscription.create({
    nombre: 'Beatriz', apellido: 'Mendoza', email: 'beatriz@example.com', celular: '3815551234', courseId: 'course-uuid',
    courseTitle: 'Curso', coursePrice: 16720, listPrice: 20900, discountAmount: 4180, couponId: coupon._id, couponCode: 'MODISTA20',
  });
  return { coupon, inscription };
};

const usedCount = async (couponId: unknown) => (await Coupon.findById(couponId))?.usedCount;

test('marking an inscription with coupon as paid by hand counts the use once, even if repeated', async () => {
  const { coupon, inscription } = await createCouponInscription();
  const id = String(inscription._id);

  await controller.updatePaymentStatus({ params: { id }, body: { paymentStatus: 'pending' } } as unknown as Request<{ id: string }, {}, { paymentStatus: 'pending' | 'paid' }>, respond().res);
  assert.equal(await usedCount(coupon._id), 0);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { res, out } = respond();
    await controller.updatePaymentStatus({ params: { id }, body: { paymentStatus: 'paid' } } as never, res);
    assert.equal(out.status, 200);
  }
  assert.equal(await usedCount(coupon._id), 1);
});

test('a payment added by hand counts the use only when the discounted price is fully covered', async () => {
  const { coupon, inscription } = await createCouponInscription();
  const id = String(inscription._id);

  await controller.addPayment({ params: { id }, body: { amount: 5000 } } as never, respond().res);
  assert.equal(await usedCount(coupon._id), 0);

  await controller.addPayment({ params: { id }, body: { amount: 11720 } } as never, respond().res);

  assert.equal((await Inscription.findById(id))?.paymentStatus, 'paid');
  assert.equal(await usedCount(coupon._id), 1);
});

test('an inscription without coupon is marked paid by hand exactly as before', async () => {
  const inscription = await Inscription.create({
    nombre: 'Ana', apellido: 'Pérez', email: 'ana@example.com', celular: '3815551235', courseId: 'course-uuid', courseTitle: 'Curso', coursePrice: 20900,
  });
  const { res, out } = respond();

  await controller.updatePaymentStatus({ params: { id: String(inscription._id) }, body: { paymentStatus: 'paid' } } as never, res);

  assert.equal(out.status, 200);
  assert.equal((await Inscription.findById(inscription._id))?.paymentStatus, 'paid');
});
