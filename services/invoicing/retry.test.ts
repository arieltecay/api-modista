import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import mongoose from 'mongoose';
import Invoice from '../../models/Invoice/index.js';
import { createFakeArca } from '../../utils/testing/fakeArca.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import type { EmailSender } from './notify.js';
import { retryInvoiceById, retryPendingInvoices } from './retry.js';
import type { ArcaClientPort, IssueInvoiceDeps } from './types.js';

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

const deps = (client: ArcaClientPort): IssueInvoiceDeps => ({
  client,
  config: { cuit: '27346513670', pointOfSale: 1, environment: 'homologation' },
  emitter: { legalName: 'GUEVARA MICAELA DENISE', cuit: '27346513670', address: 'Tucumán', ivaCondition: 'Responsable Monotributo' },
  now: () => NOW,
});

const createInvoice = async ({ updatedAt, ...overrides }: Record<string, unknown> = {}) => {
  const invoice = await Invoice.create({
    inscriptionId: new mongoose.Types.ObjectId(),
    status: 'pending',
    environment: 'homologation',
    pointOfSale: 1,
    issuedAt: NOW,
    total: 20900,
    lines: [{ description: 'Curso Online', quantity: 1, unitPrice: 20900 }],
    receiver: { name: 'BEATRIZ MENDOZA', email: 'beatriz@example.com' },
    emitter: deps(createFakeArca().client).emitter,
    publicToken: new mongoose.Types.ObjectId().toString().padEnd(64, '0'),
    ...overrides,
  });
  // Timestamps are managed by Mongoose; set them directly to arrange who counts as "least recently tried".
  if (updatedAt) await Invoice.updateOne({ _id: invoice._id }, { $set: { updatedAt } }, { timestamps: false });
  return invoice;
};

const mailbox = () => {
  const sent: string[] = [];
  const send: EmailSender = async (options) => void sent.push(options.to);
  return { sent, send };
};

test('finishes pending invoices and emails each receiver once', async () => {
  const { client } = createFakeArca();
  const first = await createInvoice();
  await createInvoice({ receiver: { name: 'ANA PEREZ', email: 'ana@example.com' } });
  const { sent, send } = mailbox();

  const summary = await retryPendingInvoices({ deps: deps(client), send });

  assert.deepEqual(summary, { processed: 2, authorized: 2, failed: 0, stillPending: 0 });
  assert.deepEqual(sent.sort(), ['ana@example.com', 'beatriz@example.com']);
  assert.equal((await Invoice.findById(first._id))?.status, 'authorized');
  assert.ok((await Invoice.findById(first._id))?.emailSentAt);
});

test('leaves an invoice pending and untouched by the mail when ARCA is still down', async () => {
  const { client, state } = createFakeArca();
  const { ArcaUnavailableError } = await import('./errors.js');
  state.failNext.push(new ArcaUnavailableError('still down'));
  await createInvoice();
  const { sent, send } = mailbox();

  const summary = await retryPendingInvoices({ deps: deps(client), send });

  assert.deepEqual(summary, { processed: 1, authorized: 0, failed: 0, stillPending: 1 });
  assert.equal(sent.length, 0);
});

test('ignores failed invoices, other environments and invoices another worker holds', async () => {
  const { client, state } = createFakeArca();
  await createInvoice({ status: 'failed' });
  await createInvoice({ environment: 'production' });
  await createInvoice({ lockedUntil: new Date(NOW.getTime() + 30_000) });
  const { sent, send } = mailbox();

  const summary = await retryPendingInvoices({ deps: deps(client), send });

  assert.equal(summary.processed, 0);
  assert.equal(state.requests.length, 0);
  assert.equal(sent.length, 0);
});

test('handles at most `limit` invoices per run, the least recently tried first', async () => {
  const { client } = createFakeArca();
  const oldest = await createInvoice({ updatedAt: new Date('2026-11-20T10:00:00Z') });
  await createInvoice({ updatedAt: new Date('2026-11-21T10:00:00Z') });
  const { send } = mailbox();

  const summary = await retryPendingInvoices({ deps: deps(client), send, limit: 1 });

  assert.equal(summary.processed, 1);
  assert.equal((await Invoice.findById(oldest._id))?.status, 'authorized');
});

test('does not email again an invoice whose link already went in the access email', async () => {
  const { client } = createFakeArca();
  await createInvoice({ emailSentAt: new Date() });
  const { sent, send } = mailbox();

  await retryPendingInvoices({ deps: deps(client), send });

  assert.equal(sent.length, 0);
});

test('an admin retry reopens a failed invoice, issues it and emails the receiver', async () => {
  const { client } = createFakeArca();
  const failed = await createInvoice({ status: 'failed', lastError: '10015: algo' });
  const { sent, send } = mailbox();

  const result = await retryInvoiceById(String(failed._id), { deps: deps(client), send });

  assert.equal(result?.status, 'authorized');
  assert.deepEqual(sent, ['beatriz@example.com']);
  assert.equal((await Invoice.findById(failed._id))?.lastError ?? null, null);
});

test('an admin retry of an already authorized invoice does nothing', async () => {
  const { client, state } = createFakeArca();
  const done = await createInvoice({ status: 'authorized', number: 5, cae: 'X', caeExpiresAt: '2026-12-01' });
  const { sent, send } = mailbox();

  const result = await retryInvoiceById(String(done._id), { deps: deps(client), send });

  assert.equal(result?.status, 'authorized');
  assert.equal(result?.issued, false);
  assert.equal(state.requests.length, 0);
  assert.equal(sent.length, 0);
});

test('an admin retry of an unknown invoice returns null', async () => {
  const { client } = createFakeArca();

  assert.equal(await retryInvoiceById(String(new mongoose.Types.ObjectId()), { deps: deps(client), send: mailbox().send }), null);
});

test('one invoice that blows up does not stop the others', async () => {
  const { client } = createFakeArca();
  const first = await createInvoice({ updatedAt: new Date('2026-11-20T10:00:00Z') });
  const second = await createInvoice({ updatedAt: new Date('2026-11-21T10:00:00Z') });
  let calls = 0;
  const flaky: ArcaClientPort = {
    ...client,
    lastAuthorized: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('unexpected');
      return client.lastAuthorized();
    },
  };

  const summary = await retryPendingInvoices({ deps: deps(flaky), send: mailbox().send });

  assert.deepEqual(summary, { processed: 2, authorized: 1, failed: 0, stillPending: 1 });
  assert.equal((await Invoice.findById(first._id))?.status, 'pending');
  assert.equal((await Invoice.findById(second._id))?.status, 'authorized');
});

test('an invoice that keeps failing does not starve the newer ones: the next run tries another', async () => {
  const { client, state } = createFakeArca();
  const { ArcaUnavailableError } = await import('./errors.js');
  state.failNext.push(new ArcaUnavailableError('down'));
  const stuck = await createInvoice({ updatedAt: new Date('2026-11-20T10:00:00Z') });
  const newer = await createInvoice({ updatedAt: new Date('2026-11-21T10:00:00Z') });

  await retryPendingInvoices({ deps: deps(client), send: mailbox().send, limit: 1 });
  await retryPendingInvoices({ deps: deps(client), send: mailbox().send, limit: 1 });

  assert.equal((await Invoice.findById(stuck._id))?.status, 'pending');
  assert.equal((await Invoice.findById(newer._id))?.status, 'authorized');
});

test('stops starting new invoices once the time budget is spent, but always makes progress', async () => {
  const { client } = createFakeArca();
  await createInvoice();
  await createInvoice();
  await createInvoice();

  const summary = await retryPendingInvoices({ deps: deps(client), send: mailbox().send, budgetMs: 0 });

  assert.equal(summary.processed, 1);
});
