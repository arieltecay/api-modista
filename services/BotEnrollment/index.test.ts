import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import Inscription from '../../models/Inscription.js';
import ConversationMessage from '../../models/ConversationMessage.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { answerEnrollmentMessage, classifyEnrollmentMessage } from './index.js';

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
  assert.match(await answerEnrollmentMessage('whatsapp', '5493815551234', 'Mi inscripción') ?? '', /Una camisa: figura como pagada/);
});

test('WhatsApp leaves unrelated texts and unknown senders to the existing flows', async () => {
  assert.equal(await answerEnrollmentMessage('whatsapp', '5493819990000', 'mi teléfono es 381 555 1234'), null);
  assert.equal(await answerEnrollmentMessage('whatsapp', '5493819990000', 'Mi inscripción'), null);
});

test('digits inside the email are not mistaken for the phone number', async () => {
  await Inscription.create({ nombre: 'Eva', apellido: 'Sol', email: 'eva17000000001234@example.com', celular: '+54 9 381 700 0002', courseId: 'course-2', courseTitle: 'Una falda', coursePrice: 100, paymentStatus: 'partial' });
  const answer = await answerEnrollmentMessage('instagram', 'ig-digits', 'Mi inscripción: eva17000000001234@example.com, celular 381 700 0002');
  assert.match(answer ?? '', /Una falda: registra un pago parcial/);
});
