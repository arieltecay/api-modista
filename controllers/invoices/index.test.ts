import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import mongoose from 'mongoose';
import CreditNote from '../../models/CreditNote/index.js';
import Invoice from '../../models/Invoice/index.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { startTestServer, type TestServer } from '../../utils/testing/httpServer.js';
import type { InvoicesServices } from './types.js';

let stopDb: () => Promise<void>;
let server: TestServer;
let adminHeaders: Record<string, string>;
let userHeaders: Record<string, string>;
const calls = { retry: [] as string[], resend: [] as string[], creditNote: [] as Array<Parameters<InvoicesServices['issueCreditNote']>[0]> };
let creditNoteOutcome: Awaited<ReturnType<InvoicesServices['issueCreditNote']>> = { kind: 'done', result: { status: 'authorized', issued: true } };
let retryOutcome: Awaited<ReturnType<InvoicesServices['retry']>>;
let resendOk = true;

const services: InvoicesServices = {
  retry: async (id) => {
    calls.retry.push(id);
    return retryOutcome;
  },
  resend: async (id) => {
    calls.resend.push(id);
    return resendOk;
  },
  issueCreditNote: async (request) => {
    calls.creditNote.push(request);
    return creditNoteOutcome;
  },
  retryCreditNote: async (id) => {
    calls.retry.push(`note:${id}`);
    return creditNoteOutcome;
  },
  resendCreditNote: async (id) => {
    calls.resend.push(`note:${id}`);
    return resendOk;
  },
};

before(async () => {
  process.env.JWT_SECRET = 'test-secret'; // read when the auth middleware is imported
  process.env.FRONTEND_URL = 'https://modista-app.com';
  const { default: jwt } = await import('jsonwebtoken');
  const { createInvoicesRouter } = await import('../../routes/invoices/index.js');
  const token = (role: string) => jwt.sign({ userId: 'u1', email: 'admin@example.com', role }, 'test-secret');
  adminHeaders = { authorization: `Bearer ${token('admin')}` };
  userHeaders = { authorization: `Bearer ${token('user')}` };

  stopDb = await startTestDb();
  await Invoice.init();
  server = await startTestServer((app) => app.use('/api/invoices', createInvoicesRouter(services)));
});
after(async () => {
  await server.close();
  await stopDb();
});
beforeEach(async () => {
  await Invoice.deleteMany({});
  calls.retry.length = 0;
  calls.resend.length = 0;
  resendOk = true;
  calls.creditNote.length = 0;
  creditNoteOutcome = { kind: 'done', result: { status: 'authorized', issued: true } };
  retryOutcome = { kind: 'not_found' };
});

let sequence = 0;
const createInvoice = (overrides: Record<string, unknown> = {}) => {
  sequence += 1;
  return Invoice.create({
    inscriptionId: new mongoose.Types.ObjectId(),
    status: 'authorized',
    environment: 'homologation',
    pointOfSale: 1,
    number: sequence,
    cae: '86471092959722',
    caeExpiresAt: '2026-12-02',
    issuedAt: new Date('2026-11-21T18:00:00Z'),
    total: 20900,
    lines: [{ description: 'Curso Online de Modista', quantity: 1, unitPrice: 20900 }],
    receiver: { name: 'BEATRIZ MENDOZA', email: 'beatriz@example.com' },
    emitter: { legalName: 'GUEVARA MICAELA DENISE', cuit: '27346513670', address: 'Tucumán', ivaCondition: 'Responsable Monotributo' },
    fiscalQrUrl: 'https://www.afip.gob.ar/fe/qr/?p=abc',
    publicToken: sequence.toString(16).padStart(64, 'a'),
    ...overrides,
  });
};

const body = (response: { body: unknown }) => response.body as Record<string, any>;

// ---- public page ----

test('the public page of an authorized invoice shows only what the invoice needs', async () => {
  const invoice = await createInvoice();

  const response = await server.get(`/api/invoices/public/${invoice.publicToken}`);

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body(response)).sort(), [
    'cae', 'caeExpiresAt', 'emitter', 'environment', 'fiscalQrUrl', 'issuedAt', 'lines', 'number', 'pointOfSale', 'receiver', 'total',
  ]);
  assert.deepEqual(body(response).receiver, { name: 'BEATRIZ MENDOZA' });
  assert.equal(body(response).environment, 'homologation');
  assert.equal(JSON.stringify(response.body).includes('beatriz@example.com'), false);
  assert.equal(JSON.stringify(response.body).includes(String(invoice._id)), false);
});

test('the public page is never cached or indexed', async () => {
  const invoice = await createInvoice();

  const response = await server.get(`/api/invoices/public/${invoice.publicToken}`);

  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.match(response.headers.get('x-robots-tag') ?? '', /noindex/);
});

test('a malformed, unknown or not yet authorized token is just a 404', async () => {
  const pending = await createInvoice({ status: 'pending', cae: undefined });

  for (const token of ['abc', 'g'.repeat(64), 'f'.repeat(64), pending.publicToken]) {
    assert.equal((await server.get(`/api/invoices/public/${token}`)).status, 404, token.slice(0, 8));
  }
});

// ---- admin ----

test('every admin endpoint requires an authenticated admin', async () => {
  const invoice = await createInvoice();
  const id = String(invoice._id);

  for (const request of [
    () => server.get('/api/invoices', {}),
    () => server.get(`/api/invoices/${id}`, {}),
    () => server.post(`/api/invoices/${id}/retry`, {}, {}),
    () => server.post(`/api/invoices/${id}/resend`, {}, {}),
  ]) {
    assert.equal((await request()).status, 401);
  }
  assert.equal((await server.get('/api/invoices', userHeaders)).status, 403);
  assert.equal((await server.post(`/api/invoices/${id}/resend`, {}, userHeaders)).status, 403);
  assert.equal((await server.get('/api/invoices', adminHeaders)).status, 200);
});

test('lists invoices newest first, with the public link only for authorized ones', async () => {
  const authorized = await createInvoice();
  await createInvoice({ status: 'pending', cae: undefined, number: undefined, lastError: 'timeout' });

  const response = await server.get('/api/invoices', adminHeaders);

  assert.equal(body(response).total, 2);
  const items = body(response).items as Array<Record<string, any>>;
  const shown = items.find((item) => item.id === String(authorized._id));
  assert.equal(shown?.publicUrl, `https://modista-app.com/factura/${authorized.publicToken}`);
  assert.equal(shown?.courseTitle, 'Curso Online de Modista');
  assert.equal(shown?.receiver.email, 'beatriz@example.com');
  const pending = items.find((item) => item.status === 'pending');
  assert.equal(pending?.publicUrl, undefined);
  assert.equal(pending?.lastError, 'timeout');
  assert.equal(JSON.stringify(response.body).includes('publicToken'), false);
});

test('filters by status and by receiver email, and paginates', async () => {
  await createInvoice();
  await createInvoice({ receiver: { name: 'ANA PEREZ', email: 'ana@example.com' } });
  await createInvoice({ status: 'failed', cae: undefined });

  assert.equal(body(await server.get('/api/invoices?status=failed', adminHeaders)).total, 1);
  assert.equal(body(await server.get('/api/invoices?q=ANA@', adminHeaders)).total, 1);
  const page = body(await server.get('/api/invoices?limit=2&page=2', adminHeaders));
  assert.equal(page.items.length, 1);
  assert.equal(page.total, 3);
  assert.equal(page.limit, 2);
});

test('rejects invalid list queries with 400', async () => {
  for (const query of ['status=nope', 'limit=1000', 'page=0']) {
    assert.equal((await server.get(`/api/invoices?${query}`, adminHeaders)).status, 400, query);
  }
});

test('a regex in the search box is treated as plain text', async () => {
  await createInvoice();

  assert.equal(body(await server.get('/api/invoices?q=.*', adminHeaders)).total, 0);
});

test('shows one invoice, or 404 for an invalid or unknown id', async () => {
  const invoice = await createInvoice();

  assert.equal((await server.get(`/api/invoices/${invoice._id}`, adminHeaders)).status, 200);
  assert.equal((await server.get('/api/invoices/not-an-id', adminHeaders)).status, 404);
  assert.equal((await server.get(`/api/invoices/${new mongoose.Types.ObjectId()}`, adminHeaders)).status, 404);
});

test('retry runs the retry service and reports the new status', async () => {
  const invoice = await createInvoice({ status: 'failed' });
  retryOutcome = { kind: 'done', result: { invoiceId: String(invoice._id), status: 'authorized', issued: true } };

  const response = await server.post(`/api/invoices/${invoice._id}/retry`, {}, adminHeaders);

  assert.equal(response.status, 200);
  assert.equal(body(response).status, 'authorized');
  assert.deepEqual(calls.retry, [String(invoice._id)]);
});

test('retry answers 404 for an unknown invoice and 503 when invoicing is disabled', async () => {
  const invoice = await createInvoice({ status: 'failed' });

  assert.equal((await server.post(`/api/invoices/${invoice._id}/retry`, {}, adminHeaders)).status, 404);
  retryOutcome = { kind: 'disabled', reason: 'ARCA_PRODUCTION_ENABLED no es "true"' };
  assert.equal((await server.post(`/api/invoices/${invoice._id}/retry`, {}, adminHeaders)).status, 503);
});

test('resend emails an authorized invoice again', async () => {
  const invoice = await createInvoice();

  const response = await server.post(`/api/invoices/${invoice._id}/resend`, {}, adminHeaders);

  assert.equal(response.status, 200);
  assert.deepEqual(calls.resend, [String(invoice._id)]);
});

test('resend refuses an invoice that is not authorized yet and reports a failed send', async () => {
  const pending = await createInvoice({ status: 'pending', cae: undefined });
  const authorized = await createInvoice();

  assert.equal((await server.post(`/api/invoices/${pending._id}/resend`, {}, adminHeaders)).status, 409);
  assert.equal(calls.resend.length, 0);
  resendOk = false;
  assert.equal((await server.post(`/api/invoices/${authorized._id}/resend`, {}, adminHeaders)).status, 502);
  assert.equal((await server.post(`/api/invoices/${new mongoose.Types.ObjectId()}/resend`, {}, adminHeaders)).status, 404);
});

// ---- credit notes ----

const createNote = async (overrides: Record<string, unknown> = {}) => {
  const invoice = await createInvoice();
  sequence += 1;
  const { receiver, emitter, lines, total, environment, pointOfSale } = invoice.toObject();
  const note = await CreditNote.create({
    invoiceId: invoice._id,
    creditedInvoice: { pointOfSale, number: invoice.number, issueDate: invoice.issuedAt },
    reason: 'Motivo interno',
    createdBy: 'u1',
    status: 'authorized',
    environment, pointOfSale, total, lines, receiver, emitter,
    number: sequence,
    cae: '1',
    caeExpiresAt: '2026-12-02',
    issuedAt: new Date('2026-11-22T18:00:00Z'),
    fiscalQrUrl: 'https://www.afip.gob.ar/fe/qr/?p=abc',
    publicToken: sequence.toString(16).padStart(64, 'b'),
    ...overrides,
  });
  return { invoice, note };
};

test('only an admin can issue, retry or resend a credit note', async () => {
  const id = new mongoose.Types.ObjectId().toString();
  for (const path of ['credit-note', 'credit-note/retry', 'credit-note/resend']) {
    assert.equal((await server.post(`/api/invoices/${id}/${path}`, { reason: 'Devolución' })).status, 401, path);
    assert.equal((await server.post(`/api/invoices/${id}/${path}`, { reason: 'Devolución' }, userHeaders)).status, 403, path);
  }
  assert.equal(calls.creditNote.length, 0);
});

test('a credit note needs a reason and records who asked for it', async () => {
  const url = '/api/invoices/abc/credit-note';
  for (const reason of [undefined, '', '  a ', 'x'.repeat(301)]) {
    assert.equal((await server.post(url, { reason }, adminHeaders)).status, 400);
  }
  assert.equal(calls.creditNote.length, 0);

  assert.equal((await server.post(url, { reason: ' Devolución ' }, adminHeaders)).status, 200);
  assert.deepEqual(calls.creditNote, [{ invoiceId: 'abc', reason: 'Devolución', createdBy: 'u1' }]);
  calls.creditNote.length = 0;
});

test('maps each credit note outcome to its status', async () => {
  const cases = [
    [{ kind: 'not_found' }, 404],
    [{ kind: 'not_allowed', reason: 'no' }, 409],
    [{ kind: 'disabled', reason: 'off' }, 503],
  ] as const;
  for (const [outcome, status] of cases) {
    creditNoteOutcome = outcome;
    assert.equal((await server.post('/api/invoices/abc/credit-note', { reason: 'Devolución' }, adminHeaders)).status, status);
    assert.equal((await server.post('/api/invoices/abc/credit-note/retry', {}, adminHeaders)).status, status);
  }
});

test('the admin list carries the credit note, and the public page never its reason', async () => {
  const { invoice, note } = await createNote();

  const list = body(await server.get('/api/invoices', adminHeaders));
  const item = list.items.find((row: { id: string }) => row.id === String(invoice._id));
  assert.equal(item.creditNote.status, 'authorized');
  assert.equal(item.creditNote.publicUrl, `https://modista-app.com/factura/${note.publicToken}`);

  const page = await server.get(`/api/invoices/public/${note.publicToken}`);
  assert.equal(page.status, 200);
  assert.deepEqual(body(page).creditedInvoice, { pointOfSale: 1, number: invoice.number });
  assert.equal(JSON.stringify(page.body).includes('Motivo interno'), false);
  assert.equal(JSON.stringify(page.body).includes('beatriz@example.com'), false);
});

test('a credit note ARCA has not authorized has no public page nor email', async () => {
  const { invoice, note } = await createNote({ status: 'pending' });

  assert.equal((await server.get(`/api/invoices/public/${note.publicToken}`)).status, 404);
  assert.equal((await server.post(`/api/invoices/${invoice._id}/credit-note/resend`, {}, adminHeaders)).status, 409);
});

test('retry and resend act on the credit note of that invoice', async () => {
  const { invoice } = await createNote();
  const url = `/api/invoices/${invoice._id}/credit-note`;

  assert.equal((await server.post(`${url}/retry`, {}, adminHeaders)).status, 200);
  assert.equal((await server.post(`${url}/resend`, {}, adminHeaders)).status, 200);
  assert.deepEqual([calls.retry, calls.resend], [[`note:${invoice._id}`], [`note:${invoice._id}`]]);

  resendOk = false;
  assert.equal((await server.post(`${url}/resend`, {}, adminHeaders)).status, 502);
  assert.equal((await server.post(`/api/invoices/${new mongoose.Types.ObjectId()}/credit-note/resend`, {}, adminHeaders)).status, 404);
});
