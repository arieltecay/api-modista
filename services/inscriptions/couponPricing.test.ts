import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import Coupon from '../../models/Coupon/index.js';
import Course from '../../models/Course.js';
import Inscription from '../../models/Inscription.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { assertOutboundBlocked, blockOutbound } from '../../utils/testing/noOutbound.js';

const COURSE_UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_UUID = '22222222-2222-4222-8222-222222222222';
const STATIC_LINK = 'https://mpago.la/static-full-price';

let stopDb: () => Promise<void>;
let createInscription: typeof import('./inscriptionService.js').createInscription;
let mpPreference: typeof import('../payments/mpClient.js').mpPreference;
let preferencePrices: number[];
let preferenceBodies: Array<Record<string, unknown>>;
let preferenceShouldFail = false;

before(async () => {
  // Read when the modules load: MP "configured", email in smtp mode without credentials (fails fast, writes no file).
  process.env.MERCADO_PAGO_ACCESS_TOKEN = 'test-token';
  blockOutbound();
  stopDb = await startTestDb();
  await Promise.all([Coupon.init(), Inscription.init(), Course.init()]);
  ({ createInscription } = await import('./inscriptionService.js'));
  ({ mpPreference } = await import('../payments/mpClient.js'));
  assertOutboundBlocked();
  (mpPreference as { create: unknown }).create = async ({ body }: { body: { items: Array<{ unit_price: number }> } }) => {
    if (preferenceShouldFail) throw new Error('MP down');
    preferencePrices.push(body.items[0].unit_price);
    preferenceBodies.push(body as unknown as Record<string, unknown>);
    return { id: 'pref-1', init_point: 'https://mp/init', sandbox_init_point: 'https://mp/sandbox' };
  };
});
after(async () => stopDb());
beforeEach(async () => {
  await Promise.all([Coupon.deleteMany({}), Inscription.deleteMany({}), Course.deleteMany({})]);
  await Course.create({
    uuid: COURSE_UUID, title: 'Curso Online de Modista', price: 20900, mpPaymentLink: STATIC_LINK,
    shortDescription: 's', longDescription: 'l', imageUrl: 'https://x/y.png', category: 'online',
  });
  preferencePrices = [];
  preferenceBodies = [];
  preferenceShouldFail = false;
});

const DAY = 24 * 60 * 60 * 1000;
const createCoupon = (overrides: Record<string, unknown> = {}) =>
  Coupon.create({
    code: 'MODISTA20', type: 'percent', value: 20, courseId: COURSE_UUID,
    startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + DAY), ...overrides,
  });

let counter = 0;
const body = (overrides: Record<string, unknown> = {}) => {
  counter += 1;
  return {
    nombre: 'Beatriz', apellido: 'Mendoza', email: `beatriz${counter}@example.com`, celular: '3815551234',
    courseId: COURSE_UUID, courseTitle: 'x', coursePrice: 1, ...overrides,
  };
};

test('a valid coupon lowers the saved price and the MercadoPago preference to the final price', async () => {
  const coupon = await createCoupon();

  const result = await createInscription(body({ couponCode: ' modista20 ' }) as never);

  const saved = await Inscription.findOne();
  assert.equal(saved?.coursePrice, 16720);
  assert.equal(saved?.listPrice, 20900);
  assert.equal(saved?.discountAmount, 4180);
  assert.equal(saved?.couponCode, 'MODISTA20');
  assert.equal(String(saved?.couponId), String(coupon._id));
  assert.deepEqual(preferencePrices, [16720]);
  assert.equal(result.mpInitPoint, 'https://mp/init');
});

test('creating the inscription does not count a use: only an approved payment does', async () => {
  const coupon = await createCoupon({ maxUses: 1 });

  await createInscription(body({ couponCode: 'MODISTA20' }) as never);

  assert.equal((await Coupon.findById(coupon._id))?.usedCount, 0);
  assert.equal((await Inscription.findOne())?.couponConfirmedAt, undefined);
});

test('without a coupon the price is the course price and no coupon data is stored', async () => {
  await createInscription(body() as never);

  const saved = await Inscription.findOne().lean();
  assert.equal(saved?.coursePrice, 20900);
  for (const field of ['couponId', 'couponCode', 'listPrice', 'discountAmount', 'couponConfirmedAt']) {
    assert.equal(field in (saved ?? {}), false, field);
  }
});

test('coupon columns sent by the client are never trusted', async () => {
  const other = await createCoupon({ code: 'OTHER' });

  await createInscription(
    body({ couponId: other._id, listPrice: 99999, discountAmount: 20899, couponConfirmedAt: new Date(), coursePrice: 1 }) as never
  );

  const saved = await Inscription.findOne().lean();
  assert.equal(saved?.coursePrice, 20900);
  for (const field of ['couponId', 'couponCode', 'listPrice', 'discountAmount', 'couponConfirmedAt']) {
    assert.equal(field in (saved ?? {}), false, field);
  }
});

test('a valid coupon overwrites price columns the client tried to send', async () => {
  await createCoupon();

  await createInscription(body({ couponCode: 'MODISTA20', listPrice: 1, discountAmount: 20899, couponConfirmedAt: new Date() }) as never);

  const saved = await Inscription.findOne().lean();
  assert.equal(saved?.listPrice, 20900);
  assert.equal(saved?.discountAmount, 4180);
  assert.equal('couponConfirmedAt' in (saved ?? {}), false);
});

test('a coupon that does not apply stops the inscription with a 400 and creates nothing', async () => {
  await Course.create({
    uuid: OTHER_UUID, title: 'Otro', price: 5000, shortDescription: 's', longDescription: 'l', imageUrl: 'https://x/y.png', category: 'online',
  });
  await createCoupon({ code: 'PAUSED', active: false });
  await createCoupon({ code: 'OLD', startsAt: new Date(Date.now() - 3 * DAY), endsAt: new Date(Date.now() - 2 * DAY) });
  await createCoupon({ code: 'FULL', maxUses: 1, usedCount: 1 });
  await createCoupon({ code: 'ONLYOTHER', courseId: OTHER_UUID });

  const messages: Record<string, string> = {
    OLD: 'Este cupón ya venció',
    FULL: 'Este cupón ya no tiene lugares disponibles',
  };
  for (const couponCode of ['NOPE', 'PAUSED', 'OLD', 'FULL', 'ONLYOTHER']) {
    await assert.rejects(createInscription(body({ couponCode }) as never), (error: Error & { statusCode?: number }) => {
      assert.equal(error.statusCode, 400, couponCode);
      assert.equal(error.message, messages[couponCode] ?? 'El cupón no es válido para este curso', couponCode);
      return true;
    });
  }
  assert.equal(await Inscription.countDocuments(), 0);
  assert.deepEqual(preferencePrices, []);
});

test('a malformed coupon code is rejected, not ignored', async () => {
  for (const couponCode of [{ $ne: null }, 123, ['A'], 'x'.repeat(100)]) {
    await assert.rejects(createInscription(body({ couponCode }) as never), (error: Error & { statusCode?: number }) => error.statusCode === 400);
  }
  assert.equal(await Inscription.countDocuments(), 0);
});

test('an empty coupon code means no coupon', async () => {
  await createInscription(body({ couponCode: '   ' }) as never);

  assert.equal((await Inscription.findOne())?.coursePrice, 20900);
});

test('if MercadoPago fails, a coupon inscription never falls back to the static full price link', async () => {
  await createCoupon();
  preferenceShouldFail = true;

  const result = await createInscription(body({ couponCode: 'MODISTA20' }) as never);

  assert.equal(result.mpPaymentLink, null);
  assert.equal(result.mpInitPoint, null);
});

test('if MercadoPago fails, an inscription without coupon keeps the static link as before', async () => {
  preferenceShouldFail = true;

  const result = await createInscription(body() as never);

  assert.equal(result.mpPaymentLink, STATIC_LINK);
});

test('the same email still cannot enroll twice, with or without coupon', async () => {
  await createCoupon();
  const first = body({ couponCode: 'MODISTA20' });
  await createInscription(first as never);

  await assert.rejects(createInscription({ ...first, couponCode: undefined } as never), (error: Error & { statusCode?: number }) => error.statusCode === 409);
});

// ---- seats and reservation ----

test('the last seat of a coupon goes to one buyer; the next one is refused and nothing is left behind', async () => {
  await createCoupon({ maxUses: 1 });
  await createInscription(body({ couponCode: 'MODISTA20' }) as never);

  await assert.rejects(createInscription(body({ couponCode: 'MODISTA20' }) as never), (error: Error & { statusCode?: number }) => error.statusCode === 400);

  assert.equal(await Inscription.countDocuments(), 1);
});

test('people racing for the last seats get exactly as many as the cap allows, and the losers leave nothing behind', async () => {
  await createCoupon({ maxUses: 2 });

  const results = await Promise.allSettled(Array.from({ length: 5 }, () => createInscription(body({ couponCode: 'MODISTA20' }) as never)));

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 2);
  assert.equal(await Inscription.countDocuments({ couponCode: 'MODISTA20' }), 2);
});

test('the seat is free again after the 60 minute reservation of an unpaid inscription', async () => {
  await createCoupon({ maxUses: 1 });
  await createInscription(body({ couponCode: 'MODISTA20' }) as never);
  await Coupon.updateMany({}, { $set: { 'seats.$[].until': new Date(Date.now() - 1000) } }); // its 60 minutes are over

  await createInscription(body({ couponCode: 'MODISTA20' }) as never);

  assert.equal(await Inscription.countDocuments(), 2);
});

test('a coupon inscription gets a MercadoPago preference that expires in 60 minutes; one without coupon does not', async () => {
  await createCoupon();
  await createInscription(body({ couponCode: 'MODISTA20' }) as never);
  await createInscription(body() as never);

  const [withCoupon, withoutCoupon] = preferenceBodies;
  assert.equal(withCoupon.expires, true);
  const to = Date.parse(String(withCoupon.expiration_date_to));
  const reservedAt = (await Inscription.findOne({ couponCode: 'MODISTA20' }))?.couponReservedAt?.getTime() ?? 0;
  assert.equal(to, reservedAt + 60 * 60 * 1000, 'the preference ends exactly when the reservation does');
  assert.equal('expires' in withoutCoupon, false);
});

test('the reservation clock starts when the inscription is created', async () => {
  await createCoupon();
  const before = Date.now();

  await createInscription(body({ couponCode: 'MODISTA20' }) as never);

  const reservedAt = (await Inscription.findOne())?.couponReservedAt?.getTime() ?? 0;
  assert.ok(reservedAt >= before && reservedAt <= Date.now());
});

// ---- an unpaid inscription comes back with a new coupon ----

const pending = (overrides: Record<string, unknown> = {}) =>
  Inscription.create({
    nombre: 'Beatriz', apellido: 'Mendoza', email: 'vuelve@example.com', celular: '3815551234', courseId: COURSE_UUID,
    courseTitle: 'Curso Online de Modista', coursePrice: 20900, ...overrides,
  });
const returning = (overrides: Record<string, unknown> = {}) => body({ email: 'vuelve@example.com', ...overrides }) as never;

test('someone with an unpaid inscription who comes back with a coupon keeps the inscription and gets the discounted price', async () => {
  const coupon = await createCoupon({ maxUses: 5 });
  const old = await pending();

  const result = await createInscription(returning({ couponCode: 'MODISTA20' }));

  assert.equal(await Inscription.countDocuments(), 1);
  const saved = await Inscription.findById(old._id);
  assert.equal(saved?.coursePrice, 16720);
  assert.equal(saved?.listPrice, 20900);
  assert.equal(String(saved?.couponId), String(coupon._id));
  assert.equal(result.mpInitPoint, 'https://mp/init');
  assert.deepEqual(preferencePrices, [16720]);
  assert.equal((await Coupon.findById(coupon._id))?.seats.length, 1);
});

test('the answer for a repriced inscription never carries the personal data stored in it', async () => {
  await createCoupon();
  await pending({ nombre: 'Dato', apellido: 'Privado', celular: '3810000000' });

  const result = await createInscription(returning({ couponCode: 'MODISTA20', nombre: 'Otra', apellido: 'Persona' }));

  const shown = JSON.stringify(result.data);
  for (const secret of ['Dato', 'Privado', '3810000000', 'vuelve@example.com']) assert.equal(shown.includes(secret), false, secret);
  assert.equal((await Inscription.findOne())?.nombre, 'Dato', 'the stored data is not overwritten by the new request');
});

test('an unpaid inscription whose coupon reservation ended can be repriced with another coupon', async () => {
  const first = await createCoupon({ code: 'FIRST10' });
  await createCoupon({ code: 'SECOND15', value: 15 });
  await pending({ couponId: first._id, couponCode: 'FIRST10', listPrice: 20900, discountAmount: 2090, coursePrice: 18810, couponReservedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) });

  await createInscription(returning({ couponCode: 'SECOND15' }));

  const saved = await Inscription.findOne();
  assert.equal(saved?.couponCode, 'SECOND15');
  assert.equal(saved?.coursePrice, 17765);
});

test('it is still a 409 when the inscription already holds a live coupon reservation, has payments, or no coupon is sent', async () => {
  const coupon = await createCoupon({ maxUses: null });
  const live = await pending({ email: 'live@example.com', couponId: coupon._id, couponCode: 'MODISTA20', listPrice: 20900, discountAmount: 4180, coursePrice: 16720, couponReservedAt: new Date() });
  await pending({ email: 'paid@example.com', paymentStatus: 'paid' });
  await pending({ email: 'partial@example.com', paymentStatus: 'partial', depositAmount: 5000 });
  await pending({ email: 'history@example.com', paymentHistory: [{ amount: 100, notes: 'x' }] });
  await pending({ email: 'nocoupon@example.com' });

  for (const email of ['live@example.com', 'paid@example.com', 'partial@example.com', 'history@example.com']) {
    await assert.rejects(createInscription(body({ email, couponCode: 'MODISTA20' }) as never), (error: Error & { statusCode?: number }) => error.statusCode === 409, email);
  }
  await assert.rejects(createInscription(body({ email: 'nocoupon@example.com' }) as never), (error: Error & { statusCode?: number }) => error.statusCode === 409);
  assert.equal((await Inscription.findById(live._id))?.coursePrice, 16720);
});

test('a coupon that does not apply leaves the unpaid inscription as it was', async () => {
  await createCoupon({ maxUses: 1, usedCount: 1 });
  const old = await pending();

  await assert.rejects(createInscription(returning({ couponCode: 'MODISTA20' })), (error: Error & { statusCode?: number }) => error.statusCode === 400);

  const saved = await Inscription.findById(old._id);
  assert.equal(saved?.coursePrice, 20900);
  assert.equal(saved?.couponId, undefined);
});

test('two people repricing for the last seat: exactly one gets it and the other inscription stays as it was', async () => {
  await createCoupon({ maxUses: 1 });
  await pending({ email: 'a@example.com' });
  await pending({ email: 'b@example.com' });

  const results = await Promise.allSettled([
    createInscription(body({ email: 'a@example.com', couponCode: 'MODISTA20' }) as never),
    createInscription(body({ email: 'b@example.com', couponCode: 'MODISTA20' }) as never),
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(await Inscription.countDocuments({ couponCode: 'MODISTA20' }), 1);
});
