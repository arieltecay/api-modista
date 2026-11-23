import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { Request, Response } from 'express';
import Inscription from '../../models/Inscription.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { getPaymentStatus } from './paymentStatus.js';

let stopDb: () => Promise<void>;
before(async () => { stopDb = await startTestDb(); });
after(async () => stopDb());

test('public payment status returns only channel states, never contact details', async () => {
  const inscription = await Inscription.create({ nombre: 'Ana', apellido: 'Paz', email: 'ana@example.com', celular: '3815551234', courseId: 'course-1', courseTitle: 'Camisas', coursePrice: 100, paymentStatus: 'paid', accessEmailStatus: 'accepted', accessWhatsAppStatus: 'disabled' });
  let payload: Record<string, unknown> = {};
  const response = { json(value: Record<string, unknown>) { payload = value; return response; } } as unknown as Response;
  await getPaymentStatus({ params: { inscriptionId: String(inscription._id) } } as Request<{ inscriptionId: string }>, response);
  assert.deepEqual(payload.accessNotifications, { email: 'accepted', whatsapp: 'disabled' });
  assert.equal(JSON.stringify(payload).includes('ana@example.com'), false);
  assert.equal(JSON.stringify(payload).includes('3815551234'), false);
});
