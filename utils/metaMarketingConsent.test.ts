import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isMetaMarketingConsentCurrent,
  isMetaMarketingConsentGranted,
  META_MARKETING_CONSENT_MAX_AGE_MS,
  META_MARKETING_CONSENT_VERSION,
} from './metaMarketingConsent.js';

test('accepts Meta tracking only with an explicit grant and current policy version', () => {
  assert.equal(
    isMetaMarketingConsentGranted('granted', META_MARKETING_CONSENT_VERSION),
    true
  );
});

test('denies Meta tracking when consent is missing, denied, or from an old policy version', () => {
  assert.equal(isMetaMarketingConsentGranted(undefined, META_MARKETING_CONSENT_VERSION), false);
  assert.equal(isMetaMarketingConsentGranted('denied', META_MARKETING_CONSENT_VERSION), false);
  assert.equal(isMetaMarketingConsentGranted('granted', 'old-version'), false);
});

test('expires Meta consent after one year and rejects invalid or future timestamps', () => {
  const now = new Date('2026-11-03T00:00:00.000Z');
  assert.equal(isMetaMarketingConsentCurrent(new Date(now.getTime() - META_MARKETING_CONSENT_MAX_AGE_MS), now), true);
  assert.equal(isMetaMarketingConsentCurrent(new Date(now.getTime() - META_MARKETING_CONSENT_MAX_AGE_MS - 1), now), false);
  assert.equal(isMetaMarketingConsentCurrent(new Date(now.getTime() + 1), now), false);
  assert.equal(isMetaMarketingConsentCurrent(new Date('invalid'), now), false);
});
