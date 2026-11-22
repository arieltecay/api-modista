import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import axios from 'axios';
import type { Request, Response } from 'express';
import { handleWebhook } from './instagram-controller.js';
import BotInstruction from '../../models/BotInstruction.js';
import BotWebhookEvent from '../../models/BotWebhookEvent/index.js';
import ConversationMessage from '../../models/ConversationMessage.js';
import Inscription from '../../models/Inscription.js';
import { logger } from '../../services/logger.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';

const SECRET = 'instagram-flow-secret';
const envKeys = ['META_INSTAGRAM_APP_SECRET', 'META_INSTAGRAM_ACCESS_TOKEN', 'META_INSTAGRAM_USER_ID', 'GEMINI_API_KEY'] as const;
const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
const network = { gemini: [] as unknown[], graph: [] as Array<{ message: { text: string } }>, graphFails: false };
let stopDb: () => Promise<void>;

before(async () => {
  process.env.META_INSTAGRAM_APP_SECRET = SECRET;
  process.env.META_INSTAGRAM_ACCESS_TOKEN = 'test-token';
  process.env.META_INSTAGRAM_USER_ID = 'ig-business';
  process.env.GEMINI_API_KEY = 'test-gemini';
  stopDb = await startTestDb();
  await Promise.all([ConversationMessage.init(), BotWebhookEvent.init()]);
});
after(async () => {
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
  await stopDb();
});
beforeEach(async () => {
  network.gemini = [];
  network.graph = [];
  network.graphFails = false;
  mock.method(axios, 'post', async (url: string, payload: never) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      network.gemini.push(payload);
      return { data: { candidates: [{ content: { parts: [{ text: 'Respuesta de IA' }] } }] } };
    }
    if (url.includes('graph.instagram.com')) {
      network.graph.push(payload);
      if (network.graphFails) throw Object.assign(new Error('Graph down'), { response: { status: 500 } });
      return { data: { message_id: 'out-1', recipient_id: 'x' } };
    }
    throw new Error(`Unexpected network call: ${url}`);
  });
  await Promise.all([BotInstruction.deleteMany({}), BotWebhookEvent.deleteMany({}), ConversationMessage.deleteMany({}), Inscription.deleteMany({})]);
});
afterEach(() => mock.restoreAll());

const deliver = async (messaging: Record<string, unknown>[]) => {
  const raw = Buffer.from(JSON.stringify({ object: 'instagram', entry: [{ id: 'ig-business', time: 1, messaging }] }));
  const signature = `sha256=${crypto.createHmac('sha256', SECRET).update(raw).digest('hex')}`;
  const request = { body: JSON.parse(raw.toString()), rawBody: raw, headers: { 'x-hub-signature-256': signature }, get: () => undefined } as unknown as Request;
  let status = 200;
  const response = { status(code: number) { status = code; return response; }, send() { return response; }, sendStatus(code: number) { status = code; return response; } } as unknown as Response;
  await handleWebhook(request, response);
  return status;
};

const receiveDm = (mid: string, text: string, sender = 'ig-customer') =>
  deliver([{ sender: { id: sender }, recipient: { id: 'ig-business' }, timestamp: 1, message: { mid, text } }]);

const addBlock = (overrides: Record<string, unknown>) => BotInstruction.create({ title: 'Bloque', content: 'Contenido', order: 1, isActive: true, instagramAutoReply: true, instagramKeywords: ['camisa'], ...overrides });
const count = (filter: Record<string, unknown>) => ConversationMessage.countDocuments({ platform: 'instagram', ...filter });

test('a matched block answers once through Graph and stores both messages', async () => {
  await addBlock({ title: 'Camisas', content: 'Dictamos cursos de camisas los sábados' });
  await addBlock({ title: 'Faldas', content: 'SECRETO-NO-COINCIDENTE', instagramKeywords: ['falda'] });

  assert.equal(await receiveDm('m-match', 'Info sobre camisas'), 200);

  assert.equal(network.graph.length, 1);
  assert.equal(network.graph[0].message.text, 'Respuesta de IA');
  const prompt = JSON.stringify(network.gemini);
  assert.match(prompt, /sábados/);
  assert.doesNotMatch(prompt, /SECRETO-NO-COINCIDENTE/);
  assert.equal(await count({ direction: 'inbound' }), 1);
  assert.equal(await count({ direction: 'outbound' }), 1);
});

test('an unmatched message is stored and never reaches Gemini or Graph', async () => {
  await addBlock({});

  assert.equal(await receiveDm('m-none', 'Hola, ¿cómo estás?'), 200);

  assert.equal(network.gemini.length, 0);
  assert.equal(network.graph.length, 0);
  assert.equal(await count({ direction: 'inbound' }), 1);
});

test('a Graph failure returns 500 and the retry sends one reply without duplicating the inbound', async () => {
  await addBlock({});
  network.graphFails = true;
  assert.equal(await receiveDm('m-retry-send', 'Quiero una camisa'), 500);
  assert.equal(await count({ direction: 'outbound' }), 0);

  network.graphFails = false;
  assert.equal(await receiveDm('m-retry-send', 'Quiero una camisa'), 200);
  assert.equal(await receiveDm('m-retry-send', 'Quiero una camisa'), 200);

  assert.equal(await count({ direction: 'inbound' }), 1);
  assert.equal(await count({ direction: 'outbound' }), 1);
  assert.equal(network.graph.filter(call => call.message.text === 'Respuesta de IA').length, 2);
});

test('a message that keeps failing is dropped after three attempts', async () => {
  await addBlock({});
  network.graphFails = true;
  for (let attempt = 0; attempt < 3; attempt += 1) assert.equal(await receiveDm('m-dead', 'Quiero una camisa'), 500);
  const sentBefore = network.graph.length;

  assert.equal(await receiveDm('m-dead', 'Quiero una camisa'), 200);
  assert.equal(network.graph.length, sentBefore);
});

test('a block with enrollment lookup still answers other questions through Gemini', async () => {
  await addBlock({ instagramEnrollmentLookup: true });

  assert.equal(await receiveDm('m-lookup-other', '¿Cuándo empieza el curso de camisa?'), 200);

  assert.equal(network.gemini.length, 1);
  assert.equal(network.graph[0].message.text, 'Respuesta de IA');
});

test('enrollment lookup replies with course and status only, and skips Gemini', async () => {
  await addBlock({ instagramKeywords: ['inscripción'], instagramEnrollmentLookup: true });
  await Inscription.create({ nombre: 'Ana', apellido: 'Paz', email: 'ana@example.com', celular: '+54 9 381 555 1234', courseId: 'c-1', courseTitle: 'Una camisa', coursePrice: 100, paymentStatus: 'paid' });

  assert.equal(await receiveDm('m-enroll', 'Mi inscripción: ana@example.com, celular 381 555 1234'), 200);

  assert.equal(network.gemini.length, 0);
  const reply = network.graph[0].message.text;
  assert.match(reply, /Una camisa: figura como pagada/);
  assert.doesNotMatch(reply, /ana@example\.com|555 1234|Paz|100/);
});

test('without the lookup flag an enrollment question never exposes stored data', async () => {
  await addBlock({ instagramKeywords: ['inscripción'], instagramEnrollmentLookup: false });
  await Inscription.create({ nombre: 'Ana', apellido: 'Paz', email: 'ana@example.com', celular: '+54 9 381 555 1234', courseId: 'c-1', courseTitle: 'Una camisa', coursePrice: 100, paymentStatus: 'paid' });

  assert.equal(await receiveDm('m-no-lookup', 'Mi inscripción: ana@example.com, celular 381 555 1234'), 200);

  assert.equal(network.graph.length, 1);
  assert.equal(network.graph[0].message.text, 'Respuesta de IA');
  assert.doesNotMatch(JSON.stringify(network.gemini), /Una camisa|figura como pagada/);
});

const lastSummary = (info: ReturnType<typeof mock.method>) => {
  const call = info.mock.calls.map(c => c.arguments as unknown[]).reverse().find(args => String(args[0]).includes('Resumen'));
  assert.ok(call, 'expected a webhook summary log');
  return call[1] as Record<string, unknown>;
};

test('each webhook logs a summary of what it stored and ignored, without message content', async () => {
  const info = mock.method(logger, 'info');
  const base = { sender: { id: 'ig-customer' }, recipient: { id: 'ig-business' }, timestamp: 1 };

  await receiveDm('m-sum-text', 'Mensaje privado del cliente');
  assert.deepEqual(lastSummary(info), { texts: 1, echoes: 0, nonText: 0, ignored: [] });
  assert.doesNotMatch(JSON.stringify(lastSummary(info)), /privado|ig-customer|m-sum/);

  await deliver([{ ...base, message: { mid: 'm-sum-echo', text: 'Yo', is_echo: true } }]);
  assert.deepEqual(lastSummary(info), { texts: 0, echoes: 1, nonText: 0, ignored: [] });

  await deliver([{ ...base, message: { mid: 'm-sum-img', attachments: [{ type: 'image' }] } }]);
  assert.deepEqual(lastSummary(info), { texts: 0, echoes: 0, nonText: 1, ignored: [] });

  await deliver([{ ...base, read: { mid: 'm-sum-read' } }]);
  assert.deepEqual(lastSummary(info), { texts: 0, echoes: 0, nonText: 0, ignored: ['read'] });
});
