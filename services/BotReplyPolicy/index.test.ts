import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import BotInstruction from '../../models/BotInstruction.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { getInstagramReplyPolicy } from './index.js';

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
