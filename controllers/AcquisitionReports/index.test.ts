import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';
import AcquisitionVisit from '../../models/AcquisitionVisit/index.js';
import Inscription from '../../models/Inscription.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { startTestServer } from '../../utils/testing/httpServer.js';
import express from 'express';
import { handleReportError } from './index.js';
import { ReportRangeError } from '../../services/AcquisitionReports/range.js';
import type { TestServer } from '../../utils/testing/httpServer.js';

let stopDb: () => Promise<void>;
let server: TestServer;
let adminHeaders: Record<string, string>;
let userHeaders: Record<string, string>;

before(async () => {
  process.env.JWT_SECRET = 'test-secret'; // read when the auth middleware is imported
  const { default: jwt } = await import('jsonwebtoken');
  const { createAcquisitionReportsRouter } = await import('../../routes/admin/acquisition.js');
  const token = (role: string) => jwt.sign({ userId: 'u1', email: 'admin@example.com', role }, 'test-secret');
  adminHeaders = { authorization: `Bearer ${token('admin')}` };
  userHeaders = { authorization: `Bearer ${token('user')}` };

  stopDb = await startTestDb();
  await Promise.all([AcquisitionVisit.init(), Inscription.init()]);
  server = await startTestServer((app) => app.use('/api/admin/acquisition', createAcquisitionReportsRouter()));
});
after(async () => {
  await server.close();
  await stopDb();
});
beforeEach(async () => {
  await Promise.all([AcquisitionVisit.deleteMany({}), Inscription.deleteMany({})]);
});

const RANGE = 'from=2026-11-10&to=2026-11-16';
const ENDPOINTS = ['overview', 'channels'];

test('every report endpoint requires an authenticated admin', async () => {
  for (const endpoint of ENDPOINTS) {
    const path = `/api/admin/acquisition/${endpoint}?${RANGE}`;
    assert.equal((await server.get(path)).status, 401, `${endpoint} anonymous`);
    assert.equal((await server.get(path, { authorization: 'Bearer garbage' })).status, 403, `${endpoint} bad token`);
    assert.equal((await server.get(path, userHeaders)).status, 403, `${endpoint} non-admin`);
    assert.equal((await server.get(path, adminHeaders)).status, 200, `${endpoint} admin`);
  }
});

test('rejects invalid queries with 400 and never echoes the values', async () => {
  const invalid = [
    'to=2026-11-16',
    'from=2026-11-16&to=2026-11-10',
    `${RANGE}&timezone=Mars/Olympus`,
    'from=2026-01-01&to=2026-12-31',
    `${RANGE}&outcomeWindowDays=14`,
    `${RANGE}&perspective=linear`,
    `${RANGE}&reportingMode=rolling`,
    `${RANGE}&campaign=black&campaign=cyber`,
    `${RANGE}&campaign=${'x'.repeat(200)}`,
  ];
  for (const endpoint of ENDPOINTS) {
    for (const params of invalid) {
      const response = await server.get(`/api/admin/acquisition/${endpoint}?${params}`, adminHeaders);
      assert.equal(response.status, 400, `${endpoint}?${params.slice(0, 60)}`);
      assert.equal((response.body as { success: boolean }).success, false);
      assert.ok(!JSON.stringify(response.body).includes('Olympus'));
    }
  }
});

test('operator-looking query keys are ignored: they do not filter the data nor reach the database', async () => {
  for (const campaign of ['x', 'y']) {
    await AcquisitionVisit.create({
      visitId: randomUUID(), visitorId: randomUUID(), startedAt: new Date('2026-11-11T12:00:00.000Z'), lastActivityAt: new Date('2026-11-11T12:00:00.000Z'),
      entryPath: '/lp', rawAttribution: { campaign },
      classification: { sourcePlatform: 'unknown', acquisitionType: 'direct', channelGroup: 'direct', reason: 'direct_no_signals', classifierVersion: 1 },
      consentVersion: 'v1',
    });
  }
  const operators = await server.get(`/api/admin/acquisition/overview?${RANGE}&campaign[$ne]=x&$where=1`, adminHeaders);
  assert.equal(operators.status, 200);
  assert.equal((operators.body as { data: { visits: number } }).data.visits, 2);
  const exact = await server.get(`/api/admin/acquisition/overview?${RANGE}&campaign=x`, adminHeaders);
  assert.equal((exact.body as { data: { visits: number } }).data.visits, 1);
});

test('the unlinked bucket cannot be used as a channel filter (400)', async () => {
  const response = await server.get(`/api/admin/acquisition/channels?${RANGE}&channel=unlinked`, adminHeaders);
  assert.equal(response.status, 400);
});

test('errors are mapped without leaking driver text: range 400, Mongo timeout 504, anything else 500', async () => {
  const failing = await startTestServer((app) => {
    const router = express.Router();
    router.get('/range', () => { throw new ReportRangeError('Rango inválido'); });
    router.get('/timeout', () => { throw Object.assign(new Error('operation exceeded time limit on acquisitionvisits $lookup'), { codeName: 'MaxTimeMSExpired', code: 50 }); });
    router.get('/boom', () => { throw new Error('E11000 collection inscriptions index email_1 dup key a@b.com'); });
    router.use(handleReportError);
    app.use('/r', router);
  });
  try {
    const range = await failing.get('/r/range');
    assert.deepEqual([range.status, (range.body as { message: string }).message], [400, 'Rango inválido']);
    const timeout = await failing.get('/r/timeout');
    assert.equal(timeout.status, 504);
    const boom = await failing.get('/r/boom');
    assert.equal(boom.status, 500);
    for (const response of [timeout, boom]) {
      const text = JSON.stringify(response.body);
      for (const leak of ['acquisitionvisits', '$lookup', 'inscriptions', 'a@b.com', 'E11000']) assert.ok(!text.includes(leak), leak);
    }
  } finally {
    await failing.close();
  }
});

test('overview returns the documented envelope', async () => {
  const response = await server.get(`/api/admin/acquisition/overview?${RANGE}`, adminHeaders);
  const body = response.body as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), [
    'coverage', 'data', 'generatedAt', 'outcomeWindowDays', 'outcomesComplete', 'perspective', 'range', 'reportingMode', 'timezone',
  ]);
  assert.equal(body.timezone, 'America/Argentina/Tucuman');
  assert.equal(body.reportingMode, 'acquisition_cohort');
  assert.equal(body.outcomeWindowDays, 30);
  assert.equal(body.perspective, 'visit_touch');
  assert.deepEqual(body.coverage, {
    observedConsentedVisits: 0, knownChannelVisits: 0, attributionCoverage: null, totalSiteVisits: null, measurementCoverage: null,
  });
});

test('channels returns rows and totals and leaks no personal data', async () => {
  const visitorId = randomUUID();
  await AcquisitionVisit.create({
    visitId: randomUUID(), visitorId, startedAt: new Date('2026-11-11T12:00:00.000Z'), lastActivityAt: new Date('2026-11-11T12:00:00.000Z'),
    entryPath: '/lp', classification: { sourcePlatform: 'instagram', acquisitionType: 'paid', channelGroup: 'meta_paid', reason: 'paid_medium', classifierVersion: 1 },
    consentVersion: 'v1',
  });
  await Inscription.create({
    nombre: 'Maria', apellido: 'Gomez', email: 'maria.gomez@example.com', celular: '3815551234', courseId: 'c1', courseTitle: 'Curso', coursePrice: 1000,
  });
  const response = await server.get(`/api/admin/acquisition/channels?${RANGE}`, adminHeaders);
  const { data } = response.body as { data: { channels: Array<{ channelGroup: string; visits: number }>; totals: { visits: number } } };
  assert.deepEqual(data.channels.map((row) => [row.channelGroup, row.visits]), [['meta_paid', 1]]);
  assert.equal(data.totals.visits, 1);
  const serialized = JSON.stringify(response.body);
  for (const secret of ['maria', 'Gomez', '3815551234', visitorId]) assert.ok(!serialized.includes(secret), secret);
});

test('only GET is exposed', async () => {
  const response = await server.post(`/api/admin/acquisition/overview?${RANGE}`, {}, adminHeaders);
  assert.equal(response.status, 404);
});
