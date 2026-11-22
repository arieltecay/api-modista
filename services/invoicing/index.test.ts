import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import mongoose from 'mongoose';
import Invoice from '../../models/Invoice/index.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { ArcaUnavailableError } from './errors.js';
import { issueInvoiceForPayment } from './index.js';
import type { ArcaClientPort, InvoicingSettings, PaymentInvoiceInput } from './types.js';

let stopDb: () => Promise<void>;
before(async () => {
  stopDb = await startTestDb();
  await Invoice.init();
});
after(async () => stopDb());
beforeEach(async () => {
  await Invoice.deleteMany({});
});

const enabled: InvoicingSettings = {
  enabled: true,
  config: { cuit: '27346513670', pointOfSale: 1, environment: 'homologation', certificatePem: 'c', privateKeyPem: 'k' },
  emitter: { legalName: 'GUEVARA MICAELA DENISE', cuit: '27346513670', address: 'Tucumán', ivaCondition: 'Responsable Monotributo' },
};

const input = (): PaymentInvoiceInput => ({
  inscriptionId: new mongoose.Types.ObjectId().toString(),
  total: 20900,
  courseTitle: 'CURSO ONLINE',
  name: 'BEATRIZ MENDOZA',
  email: 'beatriz@example.com',
  mpPaymentId: '555',
});

const okClient = (): ArcaClientPort & { calls: number } => {
  const client = {
    calls: 0,
    lastAuthorized: async () => 0,
    consult: async () => null,
    requestCae: async (request: { number: number }) => {
      client.calls += 1;
      return { cae: '86471092958250', caeExpiresAt: '2026-12-02', number: request.number };
    },
  };
  return client;
};

const withFrontend = async <T>(url: string | undefined, run: () => Promise<T>): Promise<T> => {
  const previous = process.env.FRONTEND_URL;
  if (url === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = url;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previous;
  }
};

test('returns the public invoice page url once ARCA authorized it', async () => {
  const link = await withFrontend('https://modista-app.com/', () =>
    issueInvoiceForPayment(input(), { settings: enabled, client: okClient() })
  );

  const saved = await Invoice.findOne().lean();
  assert.equal(link?.url, `https://modista-app.com/factura/${saved?.publicToken}`);
});

test('does nothing and does not call ARCA when invoicing is disabled', async () => {
  const client = okClient();

  const link = await issueInvoiceForPayment(input(), { settings: { enabled: false, reason: 'off' }, client });

  assert.equal(link, null);
  assert.equal(client.calls, 0);
  assert.equal(await Invoice.countDocuments(), 0);
});

test('returns null while ARCA is down so the access email still goes out', async () => {
  const client = okClient();
  client.requestCae = async () => {
    throw new ArcaUnavailableError('socket hang up');
  };

  const link = await issueInvoiceForPayment(input(), { settings: enabled, client });

  assert.equal(link, null);
  assert.equal((await Invoice.findOne().lean())?.status, 'pending');
});

test('gives up waiting after the deadline and leaves the invoice for the retry job', async () => {
  const client = okClient();
  client.requestCae = () => new Promise(() => undefined);

  const started = Date.now();
  const link = await issueInvoiceForPayment(input(), { settings: enabled, client, timeoutMs: 50 });

  assert.equal(link, null);
  assert.ok(Date.now() - started < 1000);
});

test('never throws, even on an unexpected failure', async () => {
  const client = okClient();
  client.lastAuthorized = async () => {
    throw new TypeError('boom');
  };

  assert.equal(await issueInvoiceForPayment(input(), { settings: enabled, client }), null);
});
