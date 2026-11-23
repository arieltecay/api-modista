import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import Inscription from '../../models/Inscription.js';
import Course from '../../models/Course.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { buildAccessEmailData, processWebhookPayment, type PaymentHooks } from './webhookProcessor.js';

let stopDb: () => Promise<void>;
before(async () => {
  stopDb = await startTestDb();
});
after(async () => stopDb());
beforeEach(async () => {
  await Inscription.deleteMany({});
});

interface Recorder {
  calls: string[];
  invoiceInputs: Array<{ total: number; name: string; email: string; mpPaymentId: string; courseTitle: string }>;
  emailInvoiceUrls: Array<string | undefined>;
}

const createHooks = (
  invoice: () => Promise<{ url: string } | null> = async () => ({ url: 'https://modista-app.com/factura/tok' })
): { hooks: PaymentHooks; recorder: Recorder } => {
  const recorder: Recorder = { calls: [], invoiceInputs: [], emailInvoiceUrls: [] };
  const hooks: PaymentHooks = {
    sendPurchaseEvent: async () => void recorder.calls.push('capi'),
    issueInvoice: async (input) => {
      recorder.calls.push('invoice');
      recorder.invoiceInputs.push(input);
      return invoice();
    },
    sendWhatsApp: async () => { recorder.calls.push('whatsapp'); return true; },
    sendAccessEmail: async (_inscription, _link, _id, invoiceUrl) => {
      recorder.calls.push('email');
      recorder.emailInvoiceUrls.push(invoiceUrl);
      return true;
    },
  };
  return { hooks, recorder };
};

const createInscription = (overrides: Record<string, unknown> = {}) =>
  Inscription.create({
    nombre: 'Beatriz',
    apellido: 'Mendoza',
    email: 'beatriz@example.com',
    celular: '3815551234',
    courseId: 'course-uuid',
    courseTitle: 'CURSO ONLINE',
    coursePrice: 20900,
    ...overrides,
  });

const payment = (inscriptionId: string, overrides: Record<string, unknown> = {}) => ({
  id: 555,
  status: 'approved',
  transaction_amount: 20900,
  external_reference: inscriptionId,
  ...overrides,
});

test('a fully paid inscription is invoiced before the access email, which carries the invoice link', async () => {
  const inscription = await createInscription();
  const { hooks, recorder } = createHooks();

  await processWebhookPayment(payment(String(inscription._id)), hooks);

  assert.deepEqual(recorder.calls, ['capi', 'invoice', 'whatsapp', 'email']);
  assert.deepEqual(recorder.invoiceInputs[0], {
    inscriptionId: String(inscription._id),
    total: 20900,
    courseTitle: 'CURSO ONLINE',
    name: 'Beatriz Mendoza',
    email: 'beatriz@example.com',
    mpPaymentId: '555',
  });
  assert.deepEqual(recorder.emailInvoiceUrls, ['https://modista-app.com/factura/tok']);
  const saved = await Inscription.findById(inscription._id);
  assert.equal(saved?.accessWhatsAppStatus, 'accepted');
  assert.equal(saved?.accessEmailStatus, 'accepted');
});

test('a provider rejection keeps the payment paid but records the channel failure', async () => {
  const inscription = await createInscription();
  const { hooks } = createHooks();
  hooks.sendWhatsApp = async () => false;
  hooks.sendAccessEmail = async () => true;
  await processWebhookPayment(payment(String(inscription._id)), hooks);
  const saved = await Inscription.findById(inscription._id);
  assert.equal(saved?.paymentStatus, 'paid');
  assert.equal(saved?.accessWhatsAppStatus, 'failed');
  assert.equal(saved?.accessEmailStatus, 'accepted');
});

test('disabling payment-access WhatsApp skips the template and still sends email', async () => {
  const previous = process.env.PAYMENT_ACCESS_WHATSAPP_ENABLED;
  process.env.PAYMENT_ACCESS_WHATSAPP_ENABLED = 'false';
  try {
    const inscription = await createInscription();
    const { hooks, recorder } = createHooks();
    await processWebhookPayment(payment(String(inscription._id)), hooks);
    const saved = await Inscription.findById(inscription._id);
    assert.equal(saved?.accessWhatsAppStatus, 'disabled');
    assert.equal(saved?.accessEmailStatus, 'accepted');
    assert.deepEqual(recorder.calls, ['capi', 'invoice', 'email']);
  } finally {
    if (previous === undefined) delete process.env.PAYMENT_ACCESS_WHATSAPP_ENABLED;
    else process.env.PAYMENT_ACCESS_WHATSAPP_ENABLED = previous;
  }
});

test('an unverified mail outcome stays unknown instead of accepted', async () => {
  const inscription = await createInscription();
  const { hooks } = createHooks();
  hooks.sendAccessEmail = async () => null;
  await processWebhookPayment(payment(String(inscription._id)), hooks);
  assert.equal((await Inscription.findById(inscription._id))?.accessEmailStatus, 'unknown');
});

test('a failed course lookup records both channels as failed without claiming access was sent', async () => {
  const inscription = await createInscription();
  const { hooks, recorder } = createHooks();
  const original = Course.findOne;
  (Course as { findOne: unknown }).findOne = () => { throw new Error('db unavailable'); };
  try {
    await processWebhookPayment(payment(String(inscription._id)), hooks);
  } finally {
    (Course as { findOne: unknown }).findOne = original;
  }
  const saved = await Inscription.findById(inscription._id);
  assert.equal(saved?.accessEmailStatus, 'failed');
  assert.equal(saved?.accessWhatsAppStatus, 'failed');
  assert.equal(recorder.calls.includes('email'), false);
  assert.equal(recorder.calls.includes('invoice'), true);
});

test('if ARCA has not answered yet the access email still goes out, without a link', async () => {
  const inscription = await createInscription();
  const { hooks, recorder } = createHooks(async () => null);

  await processWebhookPayment(payment(String(inscription._id)), hooks);

  assert.deepEqual(recorder.calls, ['capi', 'invoice', 'whatsapp', 'email']);
  assert.deepEqual(recorder.emailInvoiceUrls, [undefined]);
});

test('an invoicing crash never blocks the access email', async () => {
  const inscription = await createInscription();
  const { hooks, recorder } = createHooks(async () => {
    throw new Error('unexpected');
  });

  await processWebhookPayment(payment(String(inscription._id)), hooks);

  assert.deepEqual(recorder.calls, ['capi', 'invoice', 'whatsapp', 'email']);
  assert.deepEqual(recorder.emailInvoiceUrls, [undefined]);
});

test('an already-fired Meta purchase no longer skips the invoice, WhatsApp and email', async () => {
  const inscription = await createInscription({ metaPurchaseFiredAt: new Date() });
  const { hooks, recorder } = createHooks();

  await processWebhookPayment(payment(String(inscription._id)), hooks);

  assert.deepEqual(recorder.calls, ['invoice', 'whatsapp', 'email']);
});

test('a partial payment is not invoiced', async () => {
  const inscription = await createInscription();
  const { hooks, recorder } = createHooks();

  await processWebhookPayment(payment(String(inscription._id), { transaction_amount: 5000 }), hooks);

  assert.deepEqual(recorder.calls, []);
  assert.equal((await Inscription.findById(inscription._id))?.paymentStatus, 'partial');
});

test('the same payment notified twice is invoiced once', async () => {
  const inscription = await createInscription();
  const { hooks, recorder } = createHooks();

  await processWebhookPayment(payment(String(inscription._id)), hooks);
  await processWebhookPayment(payment(String(inscription._id)), hooks);

  assert.equal(recorder.calls.filter((call) => call === 'invoice').length, 1);
});

test('rejected or pending payments never reach invoicing', async () => {
  const inscription = await createInscription();
  const { hooks, recorder } = createHooks();

  await processWebhookPayment(payment(String(inscription._id), { id: 1, status: 'rejected' }), hooks);
  await processWebhookPayment(payment(String(inscription._id), { id: 2, status: 'pending' }), hooks);

  assert.deepEqual(recorder.calls, []);
});

test('the access email escapes what the person typed in the form and carries the invoice block only when there is a link', () => {
  const inscription = { nombre: '<b>Ana</b>', apellido: 'Pérez $&', courseTitle: '<i>Curso</i>' };

  const withInvoice = buildAccessEmailData(inscription, 'https://modista-app.com/cursos', 'https://modista-app.com/factura/tok');
  const without = buildAccessEmailData(inscription, 'https://modista-app.com/cursos');

  assert.equal(withInvoice.name.includes('<b>'), false);
  assert.equal(withInvoice.name.includes('$&'), false);
  assert.equal(withInvoice.courseTitle.includes('<i>'), false);
  assert.match(withInvoice.invoiceBlock, /factura\/tok/);
  assert.equal(without.invoiceBlock, '');
});
