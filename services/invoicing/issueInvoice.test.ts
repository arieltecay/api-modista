import assert from 'node:assert/strict';
import test, { after, before, beforeEach, mock } from 'node:test';
import mongoose from 'mongoose';
import Invoice from '../../models/Invoice/index.js';
import { logger } from '../logger.js';
import { createFakeArca } from '../../utils/testing/fakeArca.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { ArcaRejectedError, ArcaUnavailableError } from './errors.js';
import { issueInvoiceForInscription } from './issueInvoice.js';
import type { ArcaClientPort, IssueInvoiceDeps, IssueInvoiceInput } from './types.js';

let stopDb: () => Promise<void>;
before(async () => {
  stopDb = await startTestDb();
  await Invoice.init();
});
after(async () => stopDb());
beforeEach(async () => {
  await Invoice.deleteMany({});
});

const NOW = new Date('2026-11-21T18:00:00Z');
const DAY = '2026-11-21';

const deps = (client: ArcaClientPort): IssueInvoiceDeps => ({
  client,
  config: { cuit: '27346513670', pointOfSale: 1, environment: 'homologation' },
  emitter: { legalName: 'GUEVARA MICAELA DENISE', cuit: '27346513670', address: 'Tucumán', ivaCondition: 'Responsable Monotributo' },
  now: () => NOW,
});

const input = (overrides: Partial<IssueInvoiceInput> = {}): IssueInvoiceInput => ({
  inscriptionId: new mongoose.Types.ObjectId().toString(),
  total: 20900,
  description: 'CURSO ONLINE',
  receiverName: 'BEATRIZ MENDOZA',
  receiverEmail: 'beatriz@example.com',
  ...overrides,
});

test('authorizes a Factura C to a final consumer and stores everything the front needs', async () => {
  const { client } = createFakeArca();
  const data = input({ mpPaymentId: '555' });

  const result = await issueInvoiceForInscription(data, deps(client));

  assert.equal(result.status, 'authorized');
  assert.equal(result.issued, true);
  const saved = await Invoice.findById(result.invoiceId).lean();
  assert.equal(saved?.number, 1);
  assert.equal(saved?.cae, 'CAE1');
  assert.equal(saved?.caeExpiresAt, '2026-12-01');
  assert.equal(saved?.pointOfSale, 1);
  assert.equal(saved?.total, 20900);
  assert.deepEqual(saved?.lines.map((line) => ({ ...line })), [{ description: 'CURSO ONLINE', quantity: 1, unitPrice: 20900 }]);
  assert.equal(saved?.receiver?.name, 'BEATRIZ MENDOZA');
  assert.equal(saved?.emitter?.cuit, '27346513670');
  assert.match(saved?.fiscalQrUrl ?? '', /^https:\/\/www\.afip\.gob\.ar\/fe\/qr\/\?p=/);
  assert.match(saved?.publicToken ?? '', /^[a-f0-9]{64}$/);
  assert.equal(saved?.mpPaymentId, '555');
});

test('is idempotent: a second call for the same inscription does not ask ARCA again', async () => {
  const { client, state } = createFakeArca();
  const data = input();

  const first = await issueInvoiceForInscription(data, deps(client));
  const second = await issueInvoiceForInscription(data, deps(client));

  assert.equal(second.invoiceId, first.invoiceId);
  assert.equal(second.issued, false);
  assert.equal(state.requests.length, 1);
  assert.equal(await Invoice.countDocuments(), 1);
});

test('two simultaneous calls for the same inscription issue a single invoice', async () => {
  const { client, state } = createFakeArca();
  const data = input();

  const [a, b] = await Promise.all([issueInvoiceForInscription(data, deps(client)), issueInvoiceForInscription(data, deps(client))]);

  assert.equal(a.invoiceId, b.invoiceId);
  assert.equal(state.requests.length, 1);
  assert.equal(await Invoice.countDocuments(), 1);
});

test('when ARCA is unavailable the invoice stays pending with its number reserved', async () => {
  const { client, state } = createFakeArca();
  state.failNext.push(new ArcaUnavailableError('socket hang up'));

  const result = await issueInvoiceForInscription(input(), deps(client));

  assert.equal(result.status, 'pending');
  const saved = await Invoice.findById(result.invoiceId).lean();
  assert.equal(saved?.number, 1);
  assert.equal(saved?.attempts, 1);
  assert.match(saved?.lastError ?? '', /socket hang up/);
  assert.equal(saved?.lockedUntil ?? null, null);
});

test('a retry after a lost answer adopts the invoice ARCA already has instead of issuing another', async () => {
  const { client, state } = createFakeArca();
  state.loseAnswerOnce = true;
  const data = input();

  const first = await issueInvoiceForInscription(data, deps(client));
  assert.equal(first.status, 'pending');
  const retry = await issueInvoiceForInscription(data, deps(client));

  assert.equal(retry.status, 'authorized');
  assert.equal(state.requests.length, 1);
  const saved = await Invoice.findById(retry.invoiceId).lean();
  assert.equal(saved?.cae, 'CAE1');
});

test('a retry whose number ARCA does not know requests that same number again', async () => {
  const { client, state } = createFakeArca();
  state.failNext.push(new ArcaUnavailableError('timeout before ARCA processed it'));
  const data = input();

  await issueInvoiceForInscription(data, deps(client));
  const retry = await issueInvoiceForInscription(data, deps(client));

  assert.equal(retry.status, 'authorized');
  assert.deepEqual(state.requests.map((request) => request.number), [1, 1]);
});

test('a number taken by another invoice moves on to the next one', async () => {
  const { client, state } = createFakeArca();
  state.failNext.push(new ArcaRejectedError('numero invalido', ['10016']));

  const result = await issueInvoiceForInscription(input(), deps(client));

  assert.equal(result.status, 'authorized');
  assert.equal((await Invoice.findById(result.invoiceId).lean())?.number, 1);
  assert.equal(state.requests.length, 2);
});

test('never adopts an ARCA invoice that is already assigned to another inscription', async () => {
  const { client, state } = createFakeArca();
  const first = await issueInvoiceForInscription(input(), deps(client));
  assert.equal(first.status, 'authorized');
  // Same price and day, and this second invoice believes it reserved number 1 too.
  const second = input();
  await Invoice.create({
    inscriptionId: second.inscriptionId,
    status: 'pending',
    environment: 'homologation',
    pointOfSale: 1,
    number: 1,
    issuedAt: NOW,
    total: second.total,
    lines: [{ description: second.description, quantity: 1, unitPrice: second.total }],
    receiver: { name: second.receiverName, email: second.receiverEmail },
    emitter: deps(client).emitter,
    publicToken: 'b'.repeat(64),
  });

  const result = await issueInvoiceForInscription(second, deps(client));

  assert.equal(result.status, 'authorized');
  assert.equal((await Invoice.findById(result.invoiceId).lean())?.number, 2);
  assert.equal(state.requests.length, 2);
});

test('a refusal from ARCA marks the invoice failed and is not retried automatically', async () => {
  const { client, state } = createFakeArca();
  state.failNext.push(new ArcaRejectedError('10015: Factura C no puede discriminar IVA', ['10015']));
  const data = input();

  const result = await issueInvoiceForInscription(data, deps(client));
  const again = await issueInvoiceForInscription(data, deps(client));

  assert.equal(result.status, 'failed');
  assert.equal(again.status, 'failed');
  assert.equal(state.requests.length, 1);
  assert.match((await Invoice.findById(result.invoiceId).lean())?.lastError ?? '', /10015/);
});

test('refuses to adopt an ARCA invoice with different data and asks for manual reconciliation', async () => {
  const { client, stored } = createFakeArca();
  const data = input();
  await Invoice.create({
    inscriptionId: data.inscriptionId,
    status: 'pending',
    environment: 'homologation',
    pointOfSale: 1,
    number: 7,
    issuedAt: NOW,
    total: data.total,
    lines: [{ description: data.description, quantity: 1, unitPrice: data.total }],
    receiver: { name: data.receiverName, email: data.receiverEmail },
    emitter: deps(client).emitter,
    publicToken: 'c'.repeat(64),
  });
  stored.set(7, { number: 7, cae: 'OTHER', caeExpiresAt: '2026-12-01', total: 1, issueDate: DAY });

  const result = await issueInvoiceForInscription(data, deps(client));

  assert.equal(result.status, 'failed');
  assert.match((await Invoice.findById(result.invoiceId).lean())?.lastError ?? '', /conciliación manual/i);
});

test('an active lease makes a concurrent worker leave the invoice alone', async () => {
  const { client, state } = createFakeArca();
  const data = input();
  await Invoice.create({
    inscriptionId: data.inscriptionId,
    status: 'pending',
    environment: 'homologation',
    pointOfSale: 1,
    issuedAt: NOW,
    total: data.total,
    lines: [{ description: data.description, quantity: 1, unitPrice: data.total }],
    receiver: { name: data.receiverName, email: data.receiverEmail },
    emitter: deps(client).emitter,
    publicToken: 'd'.repeat(64),
    lockedUntil: new Date(NOW.getTime() + 30_000),
  });

  const result = await issueInvoiceForInscription(data, deps(client));

  assert.equal(result.status, 'pending');
  assert.equal(result.issued, false);
  assert.equal(state.requests.length, 0);
});

test('rounds the total to cents so the invoice, the QR and the reconciliation agree with ARCA', async () => {
  const { client, state } = createFakeArca();

  const result = await issueInvoiceForInscription(input({ total: 12345.67 + 0.1 + 0.2 }), deps(client));

  assert.equal(state.requests[0].total, 12345.97);
  const saved = await Invoice.findById(result.invoiceId).lean();
  assert.equal(saved?.total, 12345.97);
  assert.equal(saved?.lines[0].unitPrice, 12345.97);
});

test('an invoice that waited too long for ARCA is issued with today\'s date, which ARCA accepts', async () => {
  const { client, state } = createFakeArca();
  const data = input();
  const eightDaysAgo = new Date(NOW.getTime() - 8 * 24 * 3_600_000);
  await Invoice.create({
    inscriptionId: data.inscriptionId,
    status: 'pending',
    environment: 'homologation',
    pointOfSale: 1,
    issuedAt: eightDaysAgo,
    total: data.total,
    lines: [{ description: data.description, quantity: 1, unitPrice: data.total }],
    receiver: { name: data.receiverName, email: data.receiverEmail },
    emitter: deps(client).emitter,
    publicToken: 'e'.repeat(64),
  });

  const result = await issueInvoiceForInscription(data, deps(client));

  assert.equal(result.status, 'authorized');
  assert.equal(state.requests[0].issueDate.toISOString(), NOW.toISOString());
  assert.equal((await Invoice.findById(result.invoiceId).lean())?.issuedAt.toISOString(), NOW.toISOString());
});

test('an old invoice ARCA already has is adopted with its original date, not refreshed', async () => {
  const { client, state, stored } = createFakeArca();
  const data = input();
  const eightDaysAgo = new Date(NOW.getTime() - 8 * 24 * 3_600_000);
  await Invoice.create({
    inscriptionId: data.inscriptionId,
    status: 'pending',
    environment: 'homologation',
    pointOfSale: 1,
    number: 7,
    issuedAt: eightDaysAgo,
    total: data.total,
    lines: [{ description: data.description, quantity: 1, unitPrice: data.total }],
    receiver: { name: data.receiverName, email: data.receiverEmail },
    emitter: deps(client).emitter,
    publicToken: 'f'.repeat(64),
  });
  stored.set(7, { number: 7, cae: 'OLDCAE', caeExpiresAt: '2026-11-23', total: data.total, issueDate: '2026-11-13' });

  const result = await issueInvoiceForInscription(data, deps(client));

  assert.equal(result.status, 'authorized');
  assert.equal(state.requests.length, 0);
  const saved = await Invoice.findById(result.invoiceId).lean();
  assert.equal(saved?.cae, 'OLDCAE');
  assert.equal(saved?.issuedAt.toISOString(), eightDaysAgo.toISOString());
});

test('an invoice of another environment is left alone', async () => {
  const { client, state } = createFakeArca();
  const data = input();
  await Invoice.create({
    inscriptionId: data.inscriptionId,
    status: 'pending',
    environment: 'production',
    pointOfSale: 3,
    issuedAt: NOW,
    total: data.total,
    lines: [{ description: data.description, quantity: 1, unitPrice: data.total }],
    receiver: { name: data.receiverName, email: data.receiverEmail },
    emitter: deps(client).emitter,
    publicToken: '9'.repeat(64),
  });

  const result = await issueInvoiceForInscription(data, deps(client));

  assert.equal(result.status, 'pending');
  assert.equal(result.issued, false);
  assert.equal(state.requests.length, 0);
});

/** Runs `action` and returns what the logger received at `level`. */
const logged = async (level: 'info' | 'warn' | 'error', action: () => Promise<unknown>): Promise<string> => {
  const spy = mock.method(logger, level, () => logger);
  try {
    await action();
    return JSON.stringify(spy.mock.calls.map((call) => call.arguments));
  } finally {
    spy.mock.restore();
  }
};

test('logs each authorized invoice with its number and CAE, and nothing personal', async () => {
  const { client } = createFakeArca();
  const data = input();

  const output = await logged('info', () => issueInvoiceForInscription(data, deps(client)));

  assert.match(output, /Factura autorizada/);
  assert.match(output, /"number":1/);
  assert.match(output, /"cae":"CAE1"/);
  assert.doesNotMatch(output, /beatriz@example\.com|BEATRIZ/);
});

test('warns when ARCA does not answer and the invoice stays pending', async () => {
  const { client, state } = createFakeArca();
  state.failNext.push(new ArcaUnavailableError('socket hang up'));

  const output = await logged('warn', () => issueInvoiceForInscription(input(), deps(client)));

  assert.match(output, /queda pendiente/);
  assert.match(output, /socket hang up/);
});

test('logs an error with the ARCA code when ARCA refuses the invoice', async () => {
  const { client, state } = createFakeArca();
  state.failNext.push(new ArcaRejectedError('10015: Factura C no puede discriminar IVA', ['10015']));

  const output = await logged('error', () => issueInvoiceForInscription(input(), deps(client)));

  assert.match(output, /rechazada/);
  assert.match(output, /10015/);
});

test('two equal invoices racing for one number end with one ARCA invoice each', async () => {
  const { client, stored } = createFakeArca();
  const second = input();
  let raced = false;
  const racing: ArcaClientPort = {
    ...client,
    requestCae: async (request) => {
      const result = await client.requestCae(request);
      if (!raced) {
        raced = true;
        // The other one reserved the same number and gets a 10016 before this one stores its CAE.
        await issueInvoiceForInscription(second, deps({ ...client, lastAuthorized: async () => (stored.size > 1 ? stored.size : request.number - 1) }));
      }
      return result;
    },
  };

  const first = await issueInvoiceForInscription(input(), deps(racing));

  assert.equal(first.status, 'authorized');
  const numbers = (await Invoice.find().lean()).map((invoice) => invoice.number).sort();
  assert.deepEqual(numbers, [1, 2]);
  assert.equal(stored.size, 2);
});
