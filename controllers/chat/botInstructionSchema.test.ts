import assert from 'node:assert/strict';
import test from 'node:test';
import { INSTAGRAM_FIXED_RESPONSE_MAX_CHARS, instagramModeError, instructionInputSchema, instructionUpdateSchema } from './botInstructionSchema.js';

test('a partial update never resets the Instagram settings it omits', () => {
  assert.deepEqual(instructionUpdateSchema.parse({ title: 'Nuevo' }), { title: 'Nuevo' });
});

test('a new instruction starts with Instagram disabled', () => {
  const parsed = instructionInputSchema.parse({ title: 'T', content: 'C', order: 1, isActive: true });
  assert.equal(parsed.instagramAutoReply, false);
  assert.deepEqual(parsed.instagramKeywords, []);
});

test('Instagram phrases need at least three characters', () => {
  assert.equal(instructionUpdateSchema.safeParse({ instagramKeywords: ['de'] }).success, false);
});

test('a new or legacy instruction answers Instagram through Gemini unless it asks for a fixed reply', () => {
  const parsed = instructionInputSchema.parse({ title: 'T', content: 'C', order: 1, isActive: true });
  assert.equal(parsed.instagramResponseMode, 'gemini');
  assert.equal(instagramModeError({}), undefined);
});

test('a fixed reply keeps line breaks and emojis, trimmed only at the edges', () => {
  const parsed = instructionUpdateSchema.parse({ instagramResponseMode: 'fixed', instagramFixedResponse: '  Hola 👋\n\nTe paso el link  ' });
  assert.equal(parsed.instagramFixedResponse, 'Hola 👋\n\nTe paso el link');
});

test('a fixed reply must fit in one Instagram message', () => {
  assert.equal(instructionUpdateSchema.safeParse({ instagramFixedResponse: 'a'.repeat(INSTAGRAM_FIXED_RESPONSE_MAX_CHARS) }).success, true);
  assert.equal(instructionUpdateSchema.safeParse({ instagramFixedResponse: 'a'.repeat(INSTAGRAM_FIXED_RESPONSE_MAX_CHARS + 1) }).success, false);
  // 240 emojis are 240 characters (960 bytes): allowed. 300 are 1200 bytes: Meta would reject them.
  assert.equal(instructionUpdateSchema.safeParse({ instagramFixedResponse: '👋'.repeat(240) }).success, true);
  assert.equal(instructionUpdateSchema.safeParse({ instagramFixedResponse: '👋'.repeat(300) }).success, false);
  assert.equal(instructionUpdateSchema.safeParse({ instagramResponseMode: 'otro' }).success, false);
});

test('fixed mode needs a message and cannot be combined with enrollment lookup', () => {
  assert.match(instagramModeError({ instagramResponseMode: 'fixed' }) ?? '', /mensaje/);
  assert.match(instagramModeError({ instagramResponseMode: 'fixed', instagramFixedResponse: '   ' }) ?? '', /mensaje/);
  assert.match(instagramModeError({ instagramResponseMode: 'fixed', instagramFixedResponse: 'Hola', instagramEnrollmentLookup: true }) ?? '', /inscripciones/);
  assert.equal(instagramModeError({ instagramResponseMode: 'fixed', instagramFixedResponse: 'Hola' }), undefined);
  // In Gemini mode a stored fixed text is kept but never used.
  assert.equal(instagramModeError({ instagramResponseMode: 'gemini', instagramFixedResponse: '', instagramEnrollmentLookup: true }), undefined);
});
