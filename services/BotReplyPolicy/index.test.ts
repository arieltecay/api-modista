import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import mongoose from 'mongoose';
import BotInstruction from '../../models/BotInstruction.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { fixedReplyOf, geminiRulesOf, getInstagramReplyPolicy, getWhatsAppFixedReply } from './index.js';

let stopDb: () => Promise<void>;
before(async () => { stopDb = await startTestDb(); });
after(async () => stopDb());

test('Instagram stays silent until an active rule matches the message', async () => {
  await BotInstruction.create({ title: 'General', content: 'Información general', isActive: true });
  assert.deepEqual(await getInstagramReplyPolicy('Hola'), []);

  await BotInstruction.create({ title: 'Curso camisa', content: 'El curso empieza el 23 de noviembre.', isActive: true, instagramAutoReply: true, instagramKeywords: ['camisa', 'cuellos'] });
  assert.deepEqual(await getInstagramReplyPolicy('Hola'), []);
  const matched = await getInstagramReplyPolicy('¿Cuándo empieza el curso de CAMISA?');
  assert.equal(matched.length, 1);
  assert.equal(matched[0].title, 'Curso camisa');
});

test('inactive Instagram rules never answer and enrollment needs explicit permission', async () => {
  await BotInstruction.deleteMany({});
  await BotInstruction.create({ title: 'Inscripciones', content: 'Consultar el estado', isActive: false, instagramAutoReply: true, instagramKeywords: ['inscripción'], instagramEnrollmentLookup: true });
  assert.deepEqual(await getInstagramReplyPolicy('mi inscripción'), []);
  await BotInstruction.updateOne({ title: 'Inscripciones' }, { isActive: true });
  const matched = await getInstagramReplyPolicy('mi inscripción');
  assert.equal(matched[0].instagramEnrollmentLookup, true);
});

test('a phrase matches whole words, not fragments inside other words', async () => {
  await BotInstruction.create({ title: 'Del', content: 'x', order: 1, isActive: true, instagramAutoReply: true, instagramKeywords: ['del curso'] });
  assert.equal((await getInstagramReplyPolicy('adel curso')).length, 0);
  assert.equal((await getInstagramReplyPolicy('Info del curso por favor')).length, 1);
});

test('comment replies need their own switch: DM-only blocks never answer comments and vice versa', async () => {
  await BotInstruction.deleteMany({});
  await BotInstruction.create({ title: 'Solo DM', content: 'x', order: 1, isActive: true, instagramAutoReply: true, instagramKeywords: ['camisa'] });
  assert.equal((await getInstagramReplyPolicy('info camisa', 'comment')).length, 0);
  assert.equal((await getInstagramReplyPolicy('info camisa')).length, 1);

  await BotInstruction.create({ title: 'Solo comentarios', content: 'y', order: 2, isActive: true, instagramCommentReply: true, instagramKeywords: ['camisa'] });
  assert.deepEqual((await getInstagramReplyPolicy('info camisa', 'comment')).map(item => item.title), ['Solo comentarios']);
  assert.deepEqual((await getInstagramReplyPolicy('info camisa')).map(item => item.title), ['Solo DM']);

  await BotInstruction.updateOne({ title: 'Solo comentarios' }, { isActive: false });
  assert.equal((await getInstagramReplyPolicy('info camisa', 'comment')).length, 0);
});

test('legacy rules without a response mode read as Gemini and carry no fixed text', async () => {
  await BotInstruction.deleteMany({});
  await BotInstruction.collection.insertOne({ title: 'Viejo', content: 'x', order: 1, isActive: true, instagramAutoReply: true, instagramKeywords: ['camisa'], instagramEnrollmentLookup: false, instagramCommentReply: false });
  const [matched] = await getInstagramReplyPolicy('info camisa');
  assert.equal(matched.instagramResponseMode, 'gemini');
  assert.equal(fixedReplyOf([matched]), undefined);
});

test('the fixed reply comes from the matching fixed rule with the lowest order, for DMs and comments alike', async () => {
  await BotInstruction.deleteMany({});
  const rule = { content: 'x', isActive: true, instagramAutoReply: true, instagramCommentReply: true };
  await BotInstruction.create({ ...rule, title: 'Gemini', order: 0, instagramKeywords: ['camisa'] });
  await BotInstruction.create({ ...rule, title: 'Segunda', order: 5, instagramKeywords: ['camisa'], instagramResponseMode: 'fixed', instagramFixedResponse: 'Segunda respuesta' });
  await BotInstruction.create({ ...rule, title: 'Primera', order: 2, instagramKeywords: ['precio'], instagramResponseMode: 'fixed', instagramFixedResponse: 'Primera respuesta' });
  await BotInstruction.create({ ...rule, title: 'Otra', order: 1, instagramKeywords: ['falda'], instagramResponseMode: 'fixed', instagramFixedResponse: 'No coincide' });

  for (const channel of ['dm', 'comment'] as const) {
    assert.equal(fixedReplyOf(await getInstagramReplyPolicy('precio de la camisa', channel)), 'Primera respuesta');
  }
  assert.equal(fixedReplyOf(await getInstagramReplyPolicy('solo camisa')), 'Segunda respuesta');
});

test('fixed rules with the same order are tied by creation id, not by storage order', async () => {
  await BotInstruction.deleteMany({});
  const rule = { content: 'x', order: 3, isActive: true, instagramAutoReply: true, instagramKeywords: ['camisa'], instagramResponseMode: 'fixed' };
  // The newer id is stored first, so only the explicit sort picks the older one.
  await BotInstruction.collection.insertOne({ ...rule, _id: new mongoose.Types.ObjectId('64b7f0000000000000000002'), title: 'Nueva', instagramFixedResponse: 'Nueva' });
  await BotInstruction.collection.insertOne({ ...rule, _id: new mongoose.Types.ObjectId('64b7f0000000000000000001'), title: 'Vieja', instagramFixedResponse: 'Vieja' });
  assert.equal(fixedReplyOf(await getInstagramReplyPolicy('camisa')), 'Vieja');
});

test('a fixed rule with an empty message never sends an empty reply', async () => {
  await BotInstruction.deleteMany({});
  await BotInstruction.collection.insertOne({ title: 'Roto', content: 'x', order: 1, isActive: true, instagramAutoReply: true, instagramKeywords: ['camisa'], instagramResponseMode: 'fixed', instagramFixedResponse: '  ' });
  assert.equal(fixedReplyOf(await getInstagramReplyPolicy('camisa')), undefined);
});

test('Gemini only gets the rules set to let Mila write, never a fixed one', async () => {
  await BotInstruction.deleteMany({});
  const rule = { content: 'x', isActive: true, instagramAutoReply: true, instagramKeywords: ['camisa'] };
  await BotInstruction.create({ ...rule, title: 'Gemini', order: 2 });
  await BotInstruction.collection.insertOne({ ...rule, title: 'Fija rota', order: 1, instagramResponseMode: 'fixed', instagramFixedResponse: '' });
  await BotInstruction.collection.insertOne({ ...rule, title: 'Vieja', order: 3 });
  assert.deepEqual(geminiRulesOf(await getInstagramReplyPolicy('camisa')).map(rule => rule.title), ['Gemini', 'Vieja']);
});

test('WhatsApp fixed reply matches an active phrase before Mila, independently of Instagram', async () => {
  await BotInstruction.deleteMany({});
  await BotInstruction.create({ title: 'Acceso', content: 'x', order: 2, whatsappFixedReplyEnabled: true, whatsappKeywords: ['me inscribí', 'confirmar mi acceso'], whatsappFixedResponse: 'Revisá tu correo y este WhatsApp.' });
  await BotInstruction.create({ title: 'Otra', content: 'x', order: 1, whatsappFixedReplyEnabled: false, whatsappKeywords: ['me inscribí'], whatsappFixedResponse: 'No debe salir' });
  assert.equal(await getWhatsAppFixedReply('Me inscribi al curso Camisas'), 'Revisá tu correo y este WhatsApp.');
  assert.equal(await getWhatsAppFixedReply('Me inscribiría, ¿cómo pago?'), null);
  assert.equal(await getWhatsAppFixedReply('No recibí nada'), null);
});
