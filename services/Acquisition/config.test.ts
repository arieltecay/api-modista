import assert from 'node:assert/strict';
import test from 'node:test';
import { getIgnoredReferrerHosts, isAcquisitionTrackingEnabled } from './config.js';

test('tracking is disabled unless the flag is exactly "true"', () => {
  assert.equal(isAcquisitionTrackingEnabled({}), false);
  for (const value of ['', 'false', '1', 'TRUE', 'yes']) {
    assert.equal(isAcquisitionTrackingEnabled({ ACQUISITION_TRACKING_ENABLED: value }), false, value);
  }
  assert.equal(isAcquisitionTrackingEnabled({ ACQUISITION_TRACKING_ENABLED: 'true' }), true);
});

test('ignored referrer hosts include payment gateways, CORS origins and the explicit list', () => {
  const hosts = getIgnoredReferrerHosts({
    CORS_ORIGIN: 'https://www.modista-app.com, http://localhost:5173',
    ACQUISITION_IGNORED_REFERRER_HOSTS: 'Admin.Modista.com, ,other.example.org',
  });
  for (const expected of ['mercadopago.com.ar', 'modista-app.com', 'localhost', 'admin.modista.com', 'other.example.org']) {
    assert.ok(hosts.includes(expected), expected);
  }
  assert.ok(!hosts.includes(''));
});

test('ignored referrer hosts tolerate missing or malformed env values', () => {
  const hosts = getIgnoredReferrerHosts({ CORS_ORIGIN: 'not a url,,' });
  assert.ok(hosts.includes('mercadopago.com.ar'));
});
