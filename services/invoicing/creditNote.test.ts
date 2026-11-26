import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import mongoose from 'mongoose';
import CreditNote from '../../models/CreditNote/index.js';
import Invoice from '../../models/Invoice/index.js';
import { createFakeArca } from '../../utils/testing/fakeArca.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { issueCreditNote, resendCreditNote, retryCreditNote, retryPendingCreditNotes } from './creditNote.js';
import { ArcaRejectedError, ArcaUnavailableError } from './errors.js';
import type { EmailSender } from './notify.js';
import type { ArcaClientPort, IssueInvoiceDeps } from './types.js';

let stopDb: () => Promise<void>;
before(async () => {
  stopDb = await startTestDb();
  await Promise.all([Invoice.init(), CreditNote.init()]);
});
after(async () => stopDb());

const NOW = new Date('2026-11-21T18:00:00Z');
const emitter = { legalName: 'GUEVARA MICAELA DENISE', cuit: '27346513670', address: 'Tucumán', ivaCondition: 'Responsable Monotributo' };

/** Each test works on its own point of sale, so nothing has to be cleaned between tests. */
let lastPointOfSale = 10;
const scenario = async (overrides: Record<string, unknown> = {}) => {
  lastPointOfSale += 1;
  const pointOfSale = lastPointOfSale;
  const arca = createFakeArca();
  const deps = (client: ArcaClientPort = arca.client): IssueInvoiceDeps => ({
    client,
    config: { cuit: '27346513670', pointOfSale, environment: 'homologation' },
    emitter,
    now: () => NOW,
  });
  const createInvoice = (number: number, extra: Record<string, unknown> = {}) =>
    Invoice.create({
      inscriptionId: new mongoose.Types.ObjectId(),
      status: 'authorized',
      environment: 'homologation',
      pointOfSale,
      number,
      cae: '86471092959722',
      caeExpiresAt: '2026-12-02',
      issuedAt: new Date('2026-11-20T18:00:00Z'),
      total: 20900,
      lines: [{ description: 'Curso Online', quantity: 1, unitPrice: 20900 }],
      receiver: { name: 'BEATRIZ MENDOZA', email: 'beatriz@example.com' },
      emitter,
      publicToken: new mongoose.Types.ObjectId().toString().padEnd(64, '0'),
      ...extra,
    });
  const invoice = await createInvoice(7, overrides);
  const sent: Array<Parameters<EmailSender>[0]> = [];
  const send: EmailSender = async (options) => void sent.push(options);
  const request = { invoiceId: String(invoice._id), reason: 'Devolución del curso', createdBy: 'admin1' };
  return { arca, deps, createInvoice, invoice, sent, send, request, pointOfSale };
};

test('issues a Nota de Crédito C for the whole invoice, associated to it, and emails it', async () => {
  const { arca, deps, invoice, sent, send, request, pointOfSale } = await scenario();

  const outcome = await issueCreditNote(request, { deps: deps(), send });

  assert.deepEqual(outcome, { kind: 'done', result: { status: 'authorized', issued: true } });
  assert.deepEqual(arca.state.requests[0].credits, { pointOfSale, number: 7, issueDate: invoice.issuedAt });
  assert.equal(arca.state.requests[0].total, 20900);
  const note = await CreditNote.findOne({ invoiceId: invoice._id }).lean();
  assert.equal(note?.number, 1);
  assert.equal(note?.reason, 'Devolución del curso');
  assert.equal(note?.createdBy, 'admin1');
  assert.equal(note?.creditedInvoice?.number, 7);
  assert.notEqual(note?.publicToken, invoice.publicToken);
  const payload = JSON.parse(Buffer.from(new URL(note?.fiscalQrUrl ?? '').searchParams.get('p') ?? '', 'base64').toString());
  assert.equal(payload.tipoCmp, 13);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].templateName, 'creditNoteReady');
  assert.ok(note?.emailSentAt);
  assert.equal((await Invoice.findById(invoice._id))?.status, 'authorized');
});

test('two simultaneous clicks issue a single credit note', async () => {
  const { arca, deps, invoice, sent, send, request } = await scenario();

  await Promise.all([issueCreditNote(request, { deps: deps(), send }), issueCreditNote(request, { deps: deps(), send })]);

  assert.equal(arca.state.requests.length, 1);
  assert.equal(await CreditNote.countDocuments({ invoiceId: invoice._id }), 1);
  assert.equal(sent.length, 1);
});

test('asking again for an already credited invoice does not go to ARCA', async () => {
  const { arca, deps, send, request } = await scenario();
  await issueCreditNote(request, { deps: deps(), send });

  const again = await issueCreditNote(request, { deps: deps(), send });

  assert.deepEqual(again, { kind: 'done', result: { status: 'authorized', issued: false } });
  assert.equal(arca.state.requests.length, 1);
});

test('refuses an invoice ARCA has not authorized, of another environment or of another point of sale', async () => {
  const cases = [
    { status: 'pending', cae: undefined },
    { status: 'failed', cae: undefined },
    { environment: 'production' },
    { pointOfSale: 9999 },
  ];
  for (const overrides of cases) {
    const { arca, deps, invoice, send, request } = await scenario(overrides);

    const outcome = await issueCreditNote(request, { deps: deps(), send });

    assert.equal(outcome.kind, 'not_allowed', JSON.stringify(overrides));
    assert.equal(arca.state.requests.length, 0);
    assert.equal(await CreditNote.countDocuments({ invoiceId: invoice._id }), 0);
  }
});

test('an unknown or malformed invoice id is not found', async () => {
  const { deps, send, request } = await scenario();

  for (const invoiceId of ['abc', new mongoose.Types.ObjectId().toString()]) {
    assert.deepEqual(await issueCreditNote({ ...request, invoiceId }, { deps: deps(), send }), { kind: 'not_found' });
  }
});

test('when ARCA is down it stays pending, and the job finishes and emails it', async () => {
  const { arca, deps, invoice, sent, send, request } = await scenario();
  arca.state.failNext.push(new ArcaUnavailableError('down'));

  const first = await issueCreditNote(request, { deps: deps(), send });
  assert.deepEqual(first, { kind: 'done', result: { status: 'pending', issued: false } });
  assert.equal(sent.length, 0);

  await retryPendingCreditNotes({ deps: deps(), send });

  assert.equal((await CreditNote.findOne({ invoiceId: invoice._id }))?.status, 'authorized');
  assert.equal(sent.length, 1);
});

test('a lost answer is reconciled with the note ARCA already has instead of issuing another', async () => {
  const { arca, deps, invoice, send, request } = await scenario();
  arca.state.loseAnswerOnce = true;
  await issueCreditNote(request, { deps: deps(), send });

  const retried = await retryCreditNote(String(invoice._id), { deps: deps(), send });

  assert.deepEqual(retried, { kind: 'done', result: { status: 'authorized', issued: true } });
  assert.equal(arca.state.requests.length, 1);
});

test('never adopts a note of the same amount and day that credits another invoice', async () => {
  const { arca, deps, createInvoice, invoice, send, request } = await scenario();
  const other = await createInvoice(8);
  arca.state.failNext.push(new ArcaUnavailableError('down'));
  await issueCreditNote(request, { deps: deps(), send });
  // ARCA stored a note for the other invoice under the number this one reserved.
  await arca.client.requestCae({ number: 1, total: 20900, issueDate: NOW, credits: { pointOfSale: other.pointOfSale, number: other.number as number, issueDate: NOW } });

  await retryCreditNote(String(invoice._id), { deps: deps(), send });

  const note = await CreditNote.findOne({ invoiceId: invoice._id });
  assert.equal(note?.status, 'authorized');
  assert.equal(note?.number, 2);
  assert.equal(arca.storedCreditNotes.get(2)?.credits?.number, 7);
});

test('a refusal leaves it failed, only the explicit retry reopens it', async () => {
  const { arca, deps, invoice, send, request } = await scenario();
  arca.state.failNext.push(new ArcaRejectedError('10040: no', ['10040']));
  await issueCreditNote(request, { deps: deps(), send });

  const again = await issueCreditNote(request, { deps: deps(), send });
  assert.deepEqual(again, { kind: 'done', result: { status: 'failed', issued: false } });
  await retryPendingCreditNotes({ deps: deps(), send });
  assert.equal((await CreditNote.findOne({ invoiceId: invoice._id }))?.status, 'failed');

  const retried = await retryCreditNote(String(invoice._id), { deps: deps(), send });
  assert.deepEqual(retried, { kind: 'done', result: { status: 'authorized', issued: true } });
});

test('retrying an invoice without credit note is not found', async () => {
  const { deps, invoice, send } = await scenario();

  assert.deepEqual(await retryCreditNote(String(invoice._id), { deps: deps(), send }), { kind: 'not_found' });
});

test('numbers credit notes apart from invoices', async () => {
  const { arca, deps, invoice, send, request } = await scenario();
  await arca.client.requestCae({ number: 1, total: 1, issueDate: NOW });

  await issueCreditNote(request, { deps: deps(), send });

  assert.equal((await CreditNote.findOne({ invoiceId: invoice._id }))?.number, 1);
});

test('escapes what a person wrote before it reaches the email', async () => {
  const { deps, sent, send, request } = await scenario({ receiver: { name: '<a href="x">Ana</a>', email: 'a@example.com' } });

  await issueCreditNote(request, { deps: deps(), send });

  assert.equal(sent[0].data.name.includes('<a'), false);
});

/** The first request reaches ARCA but its answer is lost; ARCA only shows it after the retry consulted. */
const lateCommit = (client: ArcaClientPort): ArcaClientPort => {
  let consults = 0;
  return {
    ...client,
    consult: async (number, kind) => {
      consults += 1;
      return consults === 1 ? null : client.consult(number, kind);
    },
  };
};

test('a request ARCA finished late is adopted on 10016: never two notes for one invoice', async () => {
  const { arca, deps, invoice, send, request } = await scenario();
  arca.state.loseAnswerOnce = true;
  await issueCreditNote(request, { deps: deps(), send });

  await retryCreditNote(String(invoice._id), { deps: deps(lateCommit(arca.client)), send });

  const note = await CreditNote.findOne({ invoiceId: invoice._id });
  assert.equal(note?.status, 'authorized');
  assert.equal(note?.number, 1);
  assert.equal(arca.storedCreditNotes.size, 1);
});

test('a worker that lost its lease never overwrites the note another one authorized', async () => {
  const { arca, deps, invoice, send, request } = await scenario();
  const client: ArcaClientPort = {
    ...arca.client,
    requestCae: async () => {
      await CreditNote.updateOne({ invoiceId: invoice._id }, { $set: { status: 'authorized', number: 50, cae: 'OTHER', lockedUntil: null } });
      throw new ArcaUnavailableError('late');
    },
  };

  const outcome = await issueCreditNote(request, { deps: deps(client), send });

  assert.deepEqual(outcome, { kind: 'done', result: { status: 'authorized', issued: false } });
  const note = await CreditNote.findOne({ invoiceId: invoice._id });
  assert.equal(note?.cae, 'OTHER');
  assert.equal(note?.number, 50);
});

test('after a 10016 nobody holds, an older note is dated today', async () => {
  const { arca, deps, invoice, send, request } = await scenario();
  arca.state.failNext.push(new ArcaUnavailableError('down'));
  await issueCreditNote(request, { deps: deps(), send });
  arca.state.failNext.push(new ArcaRejectedError('10016: numero o fecha', ['10016']));
  const nextDay = new Date(NOW.getTime() + 24 * 3_600_000);

  await retryCreditNote(String(invoice._id), { deps: { ...deps(), now: () => nextDay }, send });

  assert.equal(arca.state.requests[arca.state.requests.length - 1].issueDate.toISOString(), nextDay.toISOString());
});

test('a stored note without its association is left for manual reconciliation', async () => {
  const { arca, deps, invoice, send, request } = await scenario();
  arca.state.loseAnswerOnce = true;
  await issueCreditNote(request, { deps: deps(), send });
  delete arca.storedCreditNotes.get(1)?.credits;

  await retryCreditNote(String(invoice._id), { deps: deps(), send });

  const note = await CreditNote.findOne({ invoiceId: invoice._id });
  assert.equal(note?.status, 'failed');
  assert.match(note?.lastError ?? '', /Conciliación manual/);
  assert.equal(arca.state.requests.length, 1);
});

test('retry and job never touch a note of another point of sale', async () => {
  const { arca, deps, invoice, send, request } = await scenario();
  arca.state.failNext.push(new ArcaUnavailableError('down'));
  await issueCreditNote(request, { deps: deps(), send });
  const elsewhere = { ...deps(), config: { ...deps().config, pointOfSale: 9998 } };

  assert.equal((await retryCreditNote(String(invoice._id), { deps: elsewhere, send })).kind, 'not_allowed');
  assert.deepEqual(await retryPendingCreditNotes({ deps: elsewhere, send }), { processed: 0, authorized: 0 });
  assert.equal(arca.state.requests.length, 1);
});

test('the job skips a note another worker holds', async () => {
  const { arca, deps, invoice, send, request } = await scenario();
  arca.state.failNext.push(new ArcaUnavailableError('down'));
  await issueCreditNote(request, { deps: deps(), send });
  await CreditNote.updateOne({ invoiceId: invoice._id }, { $set: { lockedUntil: new Date(NOW.getTime() + 60_000) } });

  assert.deepEqual(await retryPendingCreditNotes({ deps: deps(), send }), { processed: 0, authorized: 0 });
});

test('a failed email leaves the note authorized and unsent, and it can be resent', async () => {
  const { deps, invoice, sent, send, request } = await scenario();

  await issueCreditNote(request, { deps: deps(), send: async () => Promise.reject(new Error('SMTP down')) });
  const note = await CreditNote.findOne({ invoiceId: invoice._id });
  assert.equal(note?.status, 'authorized');
  assert.equal(note?.emailSentAt ?? null, null);

  assert.equal(await resendCreditNote(String(invoice._id), send), true);
  assert.equal(sent.length, 1);
});

test('the email template has no placeholder left unfilled', async () => {
  const { renderTemplate } = await import('../fsTemplate.js');
  const html = await renderTemplate('creditNoteReady', { name: 'Ana', courseTitle: 'Curso', creditNoteUrl: 'https://x.test/factura/1', year: '2026' });

  assert.equal(html.includes('{{'), false);
  assert.ok(html.includes('https://x.test/factura/1'));
});

test('a stored note that credits our invoice but has another date is never replaced by a second one', async () => {
  const { arca, deps, invoice, send, request } = await scenario();
  arca.state.loseAnswerOnce = true;
  await issueCreditNote(request, { deps: deps(), send });
  const stored = arca.storedCreditNotes.get(1);
  if (stored) stored.issueDate = '2026-11-20';

  await retryCreditNote(String(invoice._id), { deps: deps(lateCommit(arca.client)), send });

  const note = await CreditNote.findOne({ invoiceId: invoice._id });
  assert.equal(note?.status, 'failed');
  assert.match(note?.lastError ?? '', /Conciliación manual/);
  assert.equal(arca.storedCreditNotes.size, 1);
});
