import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import Inscription from '../../models/Inscription.js';
import ConversationMessage from '../../models/ConversationMessage.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { answerEnrollmentMessage, classifyEnrollmentMessage } from './index.js';
import { saveEnrollmentConfig } from './config.js';
import BotLookupAttempt from '../../models/BotLookupAttempt/index.js';

let stopDb: () => Promise<void>;
before(async () => { stopDb = await startTestDb(); });
after(async () => stopDb());

test('routes enrollment and payment status questions before purchase intent', () => {
  assert.equal(classifyEnrollmentMessage('Ya pagué mi inscripción, ¿está confirmada?'), 'enrollment');
  assert.equal(classifyEnrollmentMessage('¿Cómo está mi pago?'), 'enrollment');
  assert.equal(classifyEnrollmentMessage('¿Estoy anotada en el curso?'), 'enrollment');
  assert.equal(classifyEnrollmentMessage('¿Cuánto cuesta el curso?'), 'other');
});

test('answers from the stored inscription only when contact fields match', async () => {
  await Inscription.create({ nombre: 'Ana', apellido: 'Paz', email: 'Ana@Example.com', celular: '+54 9 381 555 1234', courseId: 'course-1', courseTitle: 'Una camisa', coursePrice: 100, paymentStatus: 'paid' });
  await ConversationMessage.create({ platform: 'instagram', platform_id: 'ig-1', body: 'Mi inscripción es con Ana@Example.com', direction: 'inbound' });
  assert.match(await answerEnrollmentMessage('instagram', 'ig-1', 'Quiero saber cómo está') ?? '', /email y el celular/);
  const answer = await answerEnrollmentMessage('instagram', 'ig-1', 'Mi celular es 381 555 1234');
  assert.match(answer ?? '', /Una camisa: figura como pagada/);
  assert.doesNotMatch(answer ?? '', /Ana@Example.com|555 1234/);
  assert.match(await answerEnrollmentMessage('instagram', 'ig-1', 'Mi celular es 381 555 9999') ?? '', /No encontré/);
  await saveEnrollmentConfig({ whatsappLookupEnabled: true });
  assert.match(await answerEnrollmentMessage('whatsapp', '5493815551234', 'Mi inscripción') ?? '', /Una camisa: figura como pagada/);
});

test('WhatsApp leaves unrelated texts and unknown senders to the existing flows', async () => {
  await saveEnrollmentConfig({ whatsappLookupEnabled: true });
  assert.equal(await answerEnrollmentMessage('whatsapp', '5493819990000', 'mi teléfono es 381 555 1234'), null);
  assert.equal(await answerEnrollmentMessage('whatsapp', '5493819990000', 'Mi inscripción'), null);
});

test('Instagram: a number without any email is not contact data, so price questions are left to the rule', async () => {
  assert.equal(await answerEnrollmentMessage('instagram', 'ig-price', '¿La camisa cuesta 150.000 - 200.000?'), null);
  assert.equal(await answerEnrollmentMessage('instagram', 'ig-price', 'Llamame al 381 555 1234'), null);
  assert.match(await answerEnrollmentMessage('instagram', 'ig-mail', 'ana@example.com') ?? '', /email y el celular/);
});

test('digits inside the email are not mistaken for the phone number', async () => {
  await Inscription.create({ nombre: 'Eva', apellido: 'Sol', email: 'eva17000000001234@example.com', celular: '+54 9 381 700 0002', courseId: 'course-2', courseTitle: 'Una falda', coursePrice: 100, paymentStatus: 'partial' });
  const answer = await answerEnrollmentMessage('instagram', 'ig-digits', 'Mi inscripción: eva17000000001234@example.com, celular 381 700 0002');
  assert.match(answer ?? '', /Una falda: registra un pago parcial/);
});

test('WhatsApp enrollment lookup is off until the admin turns it on', async () => {
  await Inscription.create({ nombre: 'Lia', apellido: 'Gil', email: 'lia@example.com', celular: '+54 9 381 700 0003', courseId: 'course-3', courseTitle: 'Un abrigo', coursePrice: 100, paymentStatus: 'paid' });
  await saveEnrollmentConfig({ whatsappLookupEnabled: false });
  assert.equal(await answerEnrollmentMessage('whatsapp', '5493817000003', 'Mi inscripción'), null);
  await saveEnrollmentConfig({ whatsappLookupEnabled: true });
  assert.match(await answerEnrollmentMessage('whatsapp', '5493817000003', 'Mi inscripción') ?? '', /Un abrigo/);
});

test('the admin wording is used for the answer, and only the course name is inserted', async () => {
  await Inscription.create({ nombre: 'Noa', apellido: 'Rey', email: 'noa@example.com', celular: '+54 9 381 700 0004', courseId: 'course-4', courseTitle: 'Un saco', coursePrice: 999, paymentStatus: 'pending' });
  await saveEnrollmentConfig({ whatsappLookupEnabled: true, templates: { header: '', footer: 'Gracias por escribirnos.', pending: 'Tu {curso} espera confirmación.' } });
  const answer = await answerEnrollmentMessage('whatsapp', '5493817000004', 'Mi inscripción');
  assert.equal(answer, 'Tu Un saco espera confirmación.\nGracias por escribirnos.');
  await saveEnrollmentConfig({ templates: {} });
});

test('Instagram stops answering enrollment lookups after too many attempts from one sender', async () => {
  await BotLookupAttempt.deleteMany({});
  const ask = () => answerEnrollmentMessage('instagram', 'ig-flood', 'Mi inscripción: nadie@example.com, celular 381 700 9999');
  for (let attempt = 0; attempt < 6; attempt += 1) assert.match(await ask() ?? '', /No encontré/);
  assert.match(await ask() ?? '', /varias consultas seguidas/);
  assert.match(await answerEnrollmentMessage('instagram', 'ig-other', 'Mi inscripción: nadie@example.com, celular 381 700 9999') ?? '', /No encontré/);
});

test('concurrent Instagram lookups from one sender cannot exceed the hourly cap', async () => {
  await BotLookupAttempt.deleteMany({});
  const ask = () => answerEnrollmentMessage('instagram', 'ig-burst', 'Mi inscripción: nadie@example.com, celular 381 700 8888');
  const answers = await Promise.all(Array.from({ length: 12 }, ask));
  assert.equal(answers.filter(answer => /No encontré/.test(answer ?? '')).length, 6);
  assert.equal(answers.filter(answer => /varias consultas seguidas/.test(answer ?? '')).length, 6);
});
