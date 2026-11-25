import assert from 'node:assert/strict';
import test from 'node:test';
import { enrollmentMarketingConsent } from './enrollmentConsent.js';

test('a consent lookup failure does not prevent an enrollment', async () => {
  const consent = await enrollmentMarketingConsent(true, async () => { throw new Error('optional lookup unavailable'); });
  assert.equal(consent, false);
});

test('a stalled consent lookup does not prevent an enrollment', async () => {
  const consent = await enrollmentMarketingConsent(true, () => new Promise<boolean>(() => {}), 1);
  assert.equal(consent, false);
});
