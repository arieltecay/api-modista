import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { Request, Response } from 'express';
import { getEnrollmentConfig, saveEnrollmentConfig } from './botEnrollmentConfigController.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';

let stopDb: () => Promise<void>;
before(async () => { stopDb = await startTestDb(); });
after(async () => stopDb());

const call = async (handler: (req: Request, res: Response) => Promise<unknown>, body?: unknown) => {
  let status = 200;
  let payload: any;
  const res = { status(code: number) { status = code; return res; }, json(value: unknown) { payload = value; return res; } } as unknown as Response;
  await handler({ body } as Request, res);
  return { status, payload };
};

test('GET returns the switch, the active wording and the defaults to restore', async () => {
  const { status, payload } = await call(getEnrollmentConfig);
  assert.equal(status, 200);
  assert.equal(payload.whatsappLookupEnabled, false);
  assert.match(payload.templates.paid, /\{curso\}/);
  assert.deepEqual(payload.templates, payload.defaults);
});

test('PUT saves the wording and the switch, and GET reflects them', async () => {
  const saved = await call(saveEnrollmentConfig, { whatsappLookupEnabled: true, templates: { paid: '¡Listo! {curso} está pago.' } });
  assert.equal(saved.status, 200);
  const { payload } = await call(getEnrollmentConfig);
  assert.equal(payload.whatsappLookupEnabled, true);
  assert.equal(payload.templates.paid, '¡Listo! {curso} está pago.');
  assert.notEqual(payload.defaults.paid, payload.templates.paid);
});

test('PUT rejects placeholders that would expose other data and lines without the course', async () => {
  assert.equal((await call(saveEnrollmentConfig, { templates: { paid: 'Tu email {email} está pago' } })).status, 400);
  assert.equal((await call(saveEnrollmentConfig, { templates: { paid: 'Está pago' } })).status, 400);
  assert.equal((await call(saveEnrollmentConfig, { templates: { notFound: 'x'.repeat(501) } })).status, 400);
  assert.equal((await call(saveEnrollmentConfig, { whatsappLookupEnabled: 'yes' })).status, 400);
});
