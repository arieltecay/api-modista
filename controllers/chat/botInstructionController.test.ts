import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import type { Request, Response } from 'express';
import BotInstruction from '../../models/BotInstruction.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { createInstruction, updateInstruction } from './botInstructionController.js';

let stopDb: () => Promise<void>;
before(async () => { stopDb = await startTestDb(); });
after(async () => stopDb());
beforeEach(async () => { await BotInstruction.deleteMany({}); });

const call = async (handler: (req: Request, res: Response) => Promise<unknown>, body: unknown, id?: string) => {
  let status = 200;
  let payload: any;
  const res = { status(code: number) { status = code; return res; }, json(value: unknown) { payload = value; return res; } } as unknown as Response;
  await handler({ body, params: { id } } as unknown as Request, res);
  return { status, payload };
};

const base = { title: 'Precios', content: 'Contexto para Mila', order: 1, isActive: true, instagramAutoReply: true, instagramKeywords: ['precio'] };

test('creating a fixed reply stores the mode and the exact message, apart from the Mila context', async () => {
  const { status, payload } = await call(createInstruction, { ...base, instagramResponseMode: 'fixed', instagramFixedResponse: 'Hola 👋\nEl precio está en la web' });
  assert.equal(status, 201);
  const stored = await BotInstruction.findById(payload._id).lean();
  assert.equal(stored?.instagramResponseMode, 'fixed');
  assert.equal(stored?.instagramFixedResponse, 'Hola 👋\nEl precio está en la web');
  assert.equal(stored?.content, 'Contexto para Mila');
});

test('creating a fixed rule without a message is rejected', async () => {
  assert.equal((await call(createInstruction, { ...base, instagramResponseMode: 'fixed' })).status, 400);
  assert.equal((await call(createInstruction, { ...base, instagramResponseMode: 'fixed', instagramFixedResponse: '   ', instagramEnrollmentLookup: true })).status, 400);
  assert.equal(await BotInstruction.countDocuments(), 0);
});

test('one rule can send a fixed reply and also look up enrollments', async () => {
  const { status, payload } = await call(createInstruction, { ...base, instagramResponseMode: 'fixed', instagramFixedResponse: 'Hola', instagramEnrollmentLookup: true });
  assert.equal(status, 201);
  const stored = await BotInstruction.findById(payload._id).lean();
  assert.equal(stored?.instagramResponseMode, 'fixed');
  assert.equal(stored?.instagramEnrollmentLookup, true);
});

test('an update is checked against the stored rule, so a partial change cannot leave a contradictory rule', async () => {
  const fixed = await BotInstruction.create({ ...base, instagramResponseMode: 'fixed', instagramFixedResponse: 'Hola' });
  const id = String(fixed._id);

  assert.equal((await call(updateInstruction, { instagramFixedResponse: '  ' }, id)).status, 400);
  assert.equal((await call(updateInstruction, { instagramResponseMode: 'fixed', instagramFixedResponse: '' }, id)).status, 400);
  assert.equal((await BotInstruction.findById(id).lean())?.instagramFixedResponse, 'Hola');
  assert.equal((await call(updateInstruction, { instagramEnrollmentLookup: true }, id)).status, 200);

  const renamed = await call(updateInstruction, { title: 'Precios 2026' }, id);
  assert.equal(renamed.status, 200);
  assert.equal(renamed.payload.instagramResponseMode, 'fixed');
  assert.equal(renamed.payload.instagramFixedResponse, 'Hola');
});

test('turning a Gemini rule into a fixed one needs a message, stored or sent', async () => {
  const gemini = await BotInstruction.create(base);
  const id = String(gemini._id);
  assert.equal((await call(updateInstruction, { instagramResponseMode: 'fixed' }, id)).status, 400);
  const { status, payload } = await call(updateInstruction, { instagramResponseMode: 'fixed', instagramFixedResponse: 'Hola' }, id);
  assert.equal(status, 200);
  assert.equal(payload.instagramResponseMode, 'fixed');
});

test('switching back to Gemini keeps the fixed text for later and an unknown id is a 404', async () => {
  const fixed = await BotInstruction.create({ ...base, instagramResponseMode: 'fixed', instagramFixedResponse: 'Hola' });
  const { payload } = await call(updateInstruction, { instagramResponseMode: 'gemini' }, String(fixed._id));
  assert.equal(payload.instagramResponseMode, 'gemini');
  assert.equal(payload.instagramFixedResponse, 'Hola');
  assert.equal((await call(updateInstruction, { title: 'x' }, '64b7f0000000000000000000')).status, 404);
});

test('a legacy rule without the new fields still updates and reads as Gemini', async () => {
  const { insertedId } = await BotInstruction.collection.insertOne({ ...base, instagramEnrollmentLookup: true, instagramCommentReply: false });
  const { status, payload } = await call(updateInstruction, { title: 'Viejo' }, String(insertedId));
  assert.equal(status, 200);
  assert.equal(payload.instagramResponseMode, 'gemini');
});
