import assert from 'node:assert/strict';
import test from 'node:test';
import { instructionInputSchema, instructionUpdateSchema } from './botInstructionSchema.js';

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
