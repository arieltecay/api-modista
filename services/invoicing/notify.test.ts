import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import mongoose from 'mongoose';
import Invoice from '../../models/Invoice/index.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { markInvoiceEmailed, sendInvoiceEmail, type EmailSender } from './notify.js';

let stopDb: () => Promise<void>;
before(async () => {
  stopDb = await startTestDb();
  await Invoice.init();
});
after(async () => stopDb());
beforeEach(async () => {
  await Invoice.deleteMany({});
});

const createInvoice = (overrides: Record<string, unknown> = {}) =>
  Invoice.create({
    inscriptionId: new mongoose.Types.ObjectId(),
    status: 'authorized',
    environment: 'homologation',
    pointOfSale: 1,
    number: 3,
    cae: '86471092959722',
    caeExpiresAt: '2026-12-02',
    issuedAt: new Date('2026-11-21T18:00:00Z'),
    total: 20900,
    lines: [{ description: 'Curso Online de Modista', quantity: 1, unitPrice: 20900 }],
    receiver: { name: 'BEATRIZ MENDOZA', email: 'beatriz@example.com' },
    emitter: { legalName: 'GUEVARA MICAELA DENISE', cuit: '27346513670', address: 'Tucumán', ivaCondition: 'Responsable Monotributo' },
    publicToken: 'a'.repeat(64),
    ...overrides,
  });

const recorder = () => {
  const sent: Array<Parameters<EmailSender>[0]> = [];
  const send: EmailSender = async (options) => void sent.push(options);
  return { sent, send };
};

test('emails the invoice link to the receiver and records when', async () => {
  const invoice = await createInvoice();
  const { sent, send } = recorder();
  process.env.FRONTEND_URL = 'https://modista-app.com';

  assert.equal(await sendInvoiceEmail(String(invoice._id), send), true);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'beatriz@example.com');
  assert.equal(sent[0].templateName, 'invoiceReady');
  assert.equal(sent[0].data.invoiceUrl, `https://modista-app.com/factura/${'a'.repeat(64)}`);
  assert.equal(sent[0].data.courseTitle, 'Curso Online de Modista');
  assert.ok((await Invoice.findById(invoice._id))?.emailSentAt);
});

test('does not email an invoice ARCA has not authorized', async () => {
  const invoice = await createInvoice({ status: 'pending', cae: undefined });
  const { sent, send } = recorder();

  assert.equal(await sendInvoiceEmail(String(invoice._id), send), false);

  assert.equal(sent.length, 0);
  assert.equal((await Invoice.findById(invoice._id))?.emailSentAt ?? null, null);
});

test('an unknown invoice is not emailed', async () => {
  const { sent, send } = recorder();

  assert.equal(await sendInvoiceEmail(String(new mongoose.Types.ObjectId()), send), false);
  assert.equal(sent.length, 0);
});

test('a failed send is reported and does not record the email as sent', async () => {
  const invoice = await createInvoice();

  const sent = await sendInvoiceEmail(String(invoice._id), async () => {
    throw new Error('SMTP down');
  });

  assert.equal(sent, false);
  assert.equal((await Invoice.findById(invoice._id))?.emailSentAt ?? null, null);
});

test('marks the invoice of an inscription as emailed when the access email already carried the link', async () => {
  const invoice = await createInvoice();

  await markInvoiceEmailed(String(invoice.inscriptionId));

  assert.ok((await Invoice.findById(invoice._id))?.emailSentAt);
});

test('escapes the receiver name and course in the email so nobody can inject HTML', async () => {
  const invoice = await createInvoice({
    receiver: { name: '<a href="https://evil.test">Cobrá acá</a> $&', email: 'x@example.com' },
    lines: [{ description: '<script>alert(1)</script>', quantity: 1, unitPrice: 20900 }],
  });
  const { sent, send } = recorder();

  await sendInvoiceEmail(String(invoice._id), send);

  assert.equal(sent[0].data.name.includes('<a'), false);
  assert.equal(sent[0].data.name.includes('$&'), false);
  assert.equal(sent[0].data.courseTitle.includes('<script>'), false);
  assert.match(sent[0].data.name, /&lt;a href=&quot;https:\/\/evil\.test&quot;&gt;/);
});
