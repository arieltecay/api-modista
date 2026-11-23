import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import Coupon from '../../models/Coupon/index.js';
import Course from '../../models/Course.js';
import Inscription from '../../models/Inscription.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { startTestServer, type TestServer } from '../../utils/testing/httpServer.js';

let stopDb: () => Promise<void>;
let server: TestServer;
let adminHeaders: Record<string, string>;
let userHeaders: Record<string, string>;

const COURSE_UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_UUID = '22222222-2222-4222-8222-222222222222';

before(async () => {
  process.env.JWT_SECRET = 'test-secret'; // read when the auth middleware is imported
  const { default: jwt } = await import('jsonwebtoken');
  const { createCouponsRouter } = await import('../../routes/Coupons/index.js');
  const token = (role: string) => jwt.sign({ userId: 'u1', email: 'admin@example.com', role }, 'test-secret');
  adminHeaders = { authorization: `Bearer ${token('admin')}` };
  userHeaders = { authorization: `Bearer ${token('user')}` };

  stopDb = await startTestDb();
  await Promise.all([Coupon.init(), Inscription.init(), Course.init()]);
  server = await startTestServer((app) => app.use('/api/coupons', createCouponsRouter()));
});
after(async () => {
  await server.close();
  await stopDb();
});
beforeEach(async () => {
  await Promise.all([Coupon.deleteMany({}), Inscription.deleteMany({}), Course.deleteMany({})]);
  await createCourse(COURSE_UUID, 'Curso Online de Modista', 20900);
});

const createCourse = (uuid: string, title: string, price: number) =>
  Course.create({ uuid, title, price, shortDescription: 's', longDescription: 'l', imageUrl: 'https://x/y.png', category: 'online' });

const daysFromNow = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

const validBody = (overrides: Record<string, unknown> = {}) => ({
  code: 'modista20',
  type: 'percent',
  value: 20,
  courseId: COURSE_UUID,
  startsAt: daysFromNow(-1),
  endsAt: daysFromNow(10),
  ...overrides,
});

const createCoupon = (overrides: Record<string, unknown> = {}) =>
  Coupon.create({ ...validBody(), code: 'MODISTA20', startsAt: new Date(daysFromNow(-1)), endsAt: new Date(daysFromNow(10)), ...overrides });

const body = (response: { body: unknown }) => response.body as Record<string, any>;

// ---- authorization ----

test('every admin endpoint requires an authenticated admin', async () => {
  const coupon = await createCoupon();
  const id = String(coupon._id);

  for (const request of [
    (headers: Record<string, string>) => server.get('/api/coupons', headers),
    (headers: Record<string, string>) => server.get('/api/coupons/summary', headers),
    (headers: Record<string, string>) => server.get(`/api/coupons/${id}`, headers),
    (headers: Record<string, string>) => server.post('/api/coupons', validBody({ code: 'OTRO10' }), headers),
    (headers: Record<string, string>) => server.patch(`/api/coupons/${id}`, { active: false }, headers),
  ]) {
    assert.equal((await request({})).status, 401);
    assert.equal((await request(userHeaders)).status, 403);
  }
  assert.equal((await Coupon.countDocuments()), 1);
  assert.equal((await Coupon.findById(id))?.active, true);
});

// ---- create ----

test('creates a coupon with the code in uppercase and records who created it', async () => {
  const response = await server.post('/api/coupons', validBody({ maxUses: 50 }), adminHeaders);

  assert.equal(response.status, 201);
  assert.equal(body(response).code, 'MODISTA20');
  assert.equal(body(response).status, 'active');
  assert.equal(body(response).courseTitle, 'Curso Online de Modista');
  assert.equal((await Coupon.findOne({ code: 'MODISTA20' }))?.createdBy, 'admin@example.com');
});

test('a coupon for every course is allowed when no course is given', async () => {
  const response = await server.post('/api/coupons', validBody({ courseId: null }), adminHeaders);

  assert.equal(response.status, 201);
  assert.equal(body(response).courseId, null);
});

test('rejects invalid coupons with 400 and a message, never a stack', async () => {
  const invalid: Array<Record<string, unknown>> = [
    { value: 100 }, // percent over 99
    { value: 0 },
    { value: 10.5 },
    { type: 'fixed', value: -5 },
    { type: 'weird' },
    { code: 'a' },
    { code: 'tiene espacio' },
    { code: 'x'.repeat(33) },
    { startsAt: daysFromNow(5), endsAt: daysFromNow(1) },
    { endsAt: 'not-a-date' },
    { maxUses: 0 },
    { maxUses: 1.5 },
    { maxUses: 10001 }, // the seats of a coupon live in one document
    { courseId: OTHER_UUID }, // no such course
  ];

  for (const overrides of invalid) {
    const response = await server.post('/api/coupons', validBody(overrides), adminHeaders);
    assert.equal(response.status, 400, JSON.stringify(overrides));
    assert.equal(typeof body(response).message, 'string');
    assert.equal(JSON.stringify(response.body).includes('at '), false, 'no stack trace');
  }
  assert.equal(await Coupon.countDocuments(), 0);
});

test('a fixed discount that would leave the chosen course free is refused by the API itself', async () => {
  const tooHigh = await server.post('/api/coupons', validBody({ code: 'BIG', type: 'fixed', value: 20900 }), adminHeaders);
  const fine = await server.post('/api/coupons', validBody({ code: 'FIVE', type: 'fixed', value: 500 }), adminHeaders);

  assert.equal(tooHigh.status, 400);
  assert.equal(body(tooHigh).message, 'El descuento debe ser menor al precio del curso');
  assert.equal(fine.status, 201);
});

test('a code with characters that change when uppercased is refused, so two spellings never collide', async () => {
  for (const code of ['ßßß', 'ııı', 'ﬁﬁﬁ', 'ａｂｃ']) {
    assert.equal((await server.post('/api/coupons', validBody({ code }), adminHeaders)).status, 400, code);
  }
  await createCoupon({ code: 'SSS' });

  const answer = await server.post('/api/coupons/validate', { code: 'ßs', courseId: COURSE_UUID });

  assert.deepEqual(answer.body, { valid: false, message: 'El cupón no es válido para este curso' });
});

test('a repeated code answers 409, ignoring case', async () => {
  await createCoupon();

  const response = await server.post('/api/coupons', validBody({ code: 'Modista20' }), adminHeaders);

  assert.equal(response.status, 409);
});

// ---- list / detail / summary ----

test('lists coupons newest first with their derived status, course title and sales totals', async () => {
  const live = await createCoupon({ code: 'LIVE' });
  await createCoupon({ code: 'PAUSED', active: false });
  await Inscription.create({
    nombre: 'Beatriz', apellido: 'Mendoza', email: 'b@example.com', celular: '3815551234', courseId: COURSE_UUID,
    courseTitle: 'Curso', coursePrice: 16720, listPrice: 20900, discountAmount: 4180, couponId: live._id, couponCode: 'LIVE',
    paymentStatus: 'paid', paymentDate: new Date(),
  });

  const response = await server.get('/api/coupons', adminHeaders);

  assert.equal(response.status, 200);
  assert.equal(body(response).total, 2);
  const items = body(response).items as Array<Record<string, any>>;
  assert.deepEqual(items.map((item) => item.code), ['PAUSED', 'LIVE']);
  const shown = items.find((item) => item.code === 'LIVE');
  assert.equal(shown?.status, 'active');
  assert.equal(shown?.courseTitle, 'Curso Online de Modista');
  assert.equal(shown?.discountTotal, 4180);
  assert.equal(shown?.netRevenue, 16720);
  assert.equal(items.find((item) => item.code === 'PAUSED')?.status, 'paused');
});

test('filters by status and by course, and paginates', async () => {
  await createCoupon({ code: 'LIVE' });
  await createCoupon({ code: 'PAUSED', active: false });
  await createCoupon({ code: 'OLD', startsAt: new Date(daysFromNow(-30)), endsAt: new Date(daysFromNow(-20)) });
  await createCoupon({ code: 'SOON', startsAt: new Date(daysFromNow(5)), endsAt: new Date(daysFromNow(15)) });
  await createCoupon({ code: 'FULL', maxUses: 2, usedCount: 2 });
  await createCoupon({ code: 'ANYCOURSE', courseId: null });

  const codes = async (query: string) =>
    ((body(await server.get(`/api/coupons?${query}`, adminHeaders)).items as Array<{ code: string }>) ?? []).map((item) => item.code).sort();

  assert.deepEqual(await codes('status=active'), ['ANYCOURSE', 'LIVE']);
  assert.deepEqual(await codes('status=paused'), ['PAUSED']);
  assert.deepEqual(await codes('status=expired'), ['OLD']);
  assert.deepEqual(await codes('status=scheduled'), ['SOON']);
  assert.deepEqual(await codes('status=exhausted'), ['FULL']);
  assert.deepEqual(await codes(`courseId=${COURSE_UUID}`), ['FULL', 'LIVE', 'OLD', 'PAUSED', 'SOON']);
  const page = await server.get('/api/coupons?limit=2&page=2', adminHeaders);
  assert.equal(body(page).items.length, 2);
  assert.equal(body(page).total, 6);
});

test('rejects invalid list queries with 400', async () => {
  for (const query of ['status=nope', 'page=0', 'limit=1000', 'page=abc']) {
    assert.equal((await server.get(`/api/coupons?${query}`, adminHeaders)).status, 400, query);
  }
});

test('a regex typed in the course filter is plain text', async () => {
  await createCoupon();

  const response = await server.get('/api/coupons?courseId=.*', adminHeaders);

  assert.equal(body(response).total, 0);
});

test('shows one coupon with its stats, 404 for an invalid or unknown id', async () => {
  const coupon = await createCoupon();

  const response = await server.get(`/api/coupons/${coupon._id}`, adminHeaders);

  assert.equal(response.status, 200);
  assert.equal(body(response).code, 'MODISTA20');
  assert.deepEqual(body(response).stats, { started: 0, uses: 0, discountTotal: 0, netRevenue: 0, daily: [], recent: [] });
  assert.equal((await server.get('/api/coupons/not-an-id', adminHeaders)).status, 404);
  assert.equal((await server.get('/api/coupons/64b64b64b64b64b64b64b64b', adminHeaders)).status, 404);
});

test('the summary adds up active coupons, uses, discount and revenue', async () => {
  await createCoupon();

  const response = await server.get('/api/coupons/summary', adminHeaders);

  assert.deepEqual(response.body, { activeCoupons: 1, uses: 0, discountTotal: 0, netRevenue: 0 });
});

// ---- update ----

test('pauses and resumes a coupon, and extends its end date', async () => {
  const coupon = await createCoupon();
  const url = `/api/coupons/${coupon._id}`;

  assert.equal(body(await server.patch(url, { active: false }, adminHeaders)).status, 'paused');
  assert.equal(body(await server.patch(url, { active: true }, adminHeaders)).status, 'active');
  const newEnd = daysFromNow(40);
  const extended = await server.patch(url, { endsAt: newEnd, maxUses: 100 }, adminHeaders);
  assert.equal(extended.status, 200);
  assert.equal(new Date(body(extended).endsAt).toISOString(), newEnd);
  assert.equal(body(extended).maxUses, 100);
  assert.equal((await server.patch(url, { maxUses: null }, adminHeaders)).status, 200);
  assert.equal((await Coupon.findById(coupon._id))?.maxUses, null);
});

test('the code, type, value and course of a coupon cannot be edited', async () => {
  const coupon = await createCoupon();

  for (const change of [{ code: 'NEW' }, { type: 'fixed' }, { value: 90 }, { courseId: null }, { usedCount: 0 }]) {
    assert.equal((await server.patch(`/api/coupons/${coupon._id}`, change, adminHeaders)).status, 400, JSON.stringify(change));
  }
  const stored = await Coupon.findById(coupon._id);
  assert.equal(stored?.code, 'MODISTA20');
  assert.equal(stored?.value, 20);
});

test('an update that leaves the window inverted is rejected and nothing changes', async () => {
  const coupon = await createCoupon();

  const response = await server.patch(`/api/coupons/${coupon._id}`, { endsAt: daysFromNow(-5) }, adminHeaders);

  assert.equal(response.status, 400);
  assert.equal((await Coupon.findById(coupon._id))?.endsAt.getTime(), coupon.endsAt.getTime());
});

test('updating an unknown coupon is a 404', async () => {
  assert.equal((await server.patch('/api/coupons/64b64b64b64b64b64b64b64b', { active: false }, adminHeaders)).status, 404);
  assert.equal((await server.patch('/api/coupons/nope', { active: false }, adminHeaders)).status, 404);
});

// ---- public validation ----

test('anyone can check a coupon and gets the final price the server would charge', async () => {
  await createCoupon();

  const response = await server.post('/api/coupons/validate', { code: ' modista20 ', courseId: COURSE_UUID });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { valid: true, code: 'MODISTA20', listPrice: 20900, discountAmount: 4180, finalPrice: 16720 });
});

test('a coupon that ended or ran out says so, and no other reason reveals anything', async () => {
  await createCourse(OTHER_UUID, 'Otro curso', 10000);
  await createCoupon({ code: 'PAUSED', active: false });
  await createCoupon({ code: 'OLD', startsAt: new Date(daysFromNow(-30)), endsAt: new Date(daysFromNow(-20)) });
  await createCoupon({ code: 'FULL', maxUses: 1, usedCount: 1 });
  await createCoupon({ code: 'SOON', startsAt: new Date(daysFromNow(5)), endsAt: new Date(daysFromNow(15)) });
  await createCoupon({ code: 'BIG', type: 'fixed', value: 30000 });
  const ask = async (code: string, courseId = COURSE_UUID) => (await server.post('/api/coupons/validate', { code, courseId })).body;

  assert.deepEqual(await ask('OLD'), { valid: false, message: 'Este cupón ya venció' });
  assert.deepEqual(await ask('FULL'), { valid: false, message: 'Este cupón ya no tiene lugares disponibles' });
  for (const [code, courseId] of [['DOESNOTEXIST', COURSE_UUID], ['PAUSED', COURSE_UUID], ['SOON', COURSE_UUID], ['BIG', COURSE_UUID], ['PAUSED', OTHER_UUID], ['X'.repeat(4), '99999999-9999-4999-8999-999999999999']]) {
    assert.deepEqual(await ask(code, courseId), { valid: false, message: 'El cupón no es válido para este curso' }, code);
  }
});

test('the public check rejects a malformed body with 400', async () => {
  for (const payload of [{}, { code: '' }, { code: 'A', courseId: '' }, { code: 123, courseId: COURSE_UUID }, { code: 'x'.repeat(100), courseId: COURSE_UUID }]) {
    assert.equal((await server.post('/api/coupons/validate', payload)).status, 400, JSON.stringify(payload));
  }
});

test('applying a valid coupon never uses up attempts: only failed checks count towards the limit', async () => {
  await createCoupon();

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const answer = await server.post('/api/coupons/validate', { code: 'MODISTA20', courseId: COURSE_UUID });
    assert.equal(answer.status, 200, `valid check number ${attempt + 1}`);
    assert.equal(body(answer).valid, true);
  }
});

// Last on purpose: it spends the whole budget of the limiter shared by this process.
test('the public check is rate limited and tells the client to wait', async () => {
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 45; attempt += 1) {
    statuses.push((await server.post('/api/coupons/validate', { code: `TRY${attempt}`, courseId: COURSE_UUID })).status);
  }

  assert.ok(statuses.includes(429), 'expected a 429 within 45 attempts');
  assert.equal(statuses[0], 200);
  const limited = await server.post('/api/coupons/validate', { code: 'TRY', courseId: COURSE_UUID });
  assert.equal(limited.status, 429);
  assert.equal(body(limited).success, false);
});
