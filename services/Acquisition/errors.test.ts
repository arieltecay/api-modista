import assert from 'node:assert/strict';
import test from 'node:test';
import { redactError } from './errors.js';

test('redactError keeps the error name, code and stack frames but never the message', () => {
  const error = Object.assign(new Error('E11000 dup key { visitorId: "a@b.com" }'), { code: 11000, name: 'MongoServerError' });
  const redacted = redactError(error);
  assert.ok(redacted.message.includes('MongoServerError'));
  assert.ok(redacted.message.includes('11000'));
  assert.ok(!redacted.message.includes('a@b.com'));
  assert.ok(!(redacted.stack ?? '').includes('a@b.com'));
  assert.match(redacted.stack ?? '', /\bat\b/);
});

test('redactError handles non-Error values', () => {
  assert.ok(redactError('secret a@b.com').message.length > 0);
  assert.ok(!redactError('secret a@b.com').message.includes('a@b.com'));
  assert.ok(redactError(undefined).message.length > 0);
});
