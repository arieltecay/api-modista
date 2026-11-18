import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLIENT_CLOCK_FUTURE_TOLERANCE_MS,
  CLIENT_CLOCK_MAX_AGE_MS,
  isWithinClientClockWindow,
  toCleanPath,
  toReferrerHost,
} from './sanitize.js';

test('toReferrerHost keeps only the lowercase host, without www, path, query or credentials', () => {
  assert.equal(toReferrerHost('https://l.instagram.com/?u=secret-token#frag', []), 'l.instagram.com');
  assert.equal(toReferrerHost('HTTPS://WWW.Google.com/search?q=x', []), 'google.com');
  assert.equal(toReferrerHost('https://user:pw@l.facebook.com:443/x', []), 'l.facebook.com');
  assert.equal(toReferrerHost('l.facebook.com', []), 'l.facebook.com');
});

test('toReferrerHost drops empty, invalid and non-web referrers', () => {
  for (const value of [undefined, '', '   ', 'not a url', 'javascript:alert(1)', 'http://', 'ftp://files.example.com/x']) {
    assert.equal(toReferrerHost(value, []), undefined, String(value));
  }
});

test('toReferrerHost drops own and ignored hosts, including subdomains, but not lookalikes', () => {
  const ignored = ['modista-app.com', 'mercadopago.com.ar'];
  assert.equal(toReferrerHost('https://modista-app.com/lp/x', ignored), undefined);
  assert.equal(toReferrerHost('https://www.modista-app.com/', ignored), undefined);
  assert.equal(toReferrerHost('https://checkout.mercadopago.com.ar/pay', ignored), undefined);
  assert.equal(toReferrerHost('https://notmodista-app.com/', ignored), 'notmodista-app.com');
  assert.equal(toReferrerHost('https://modista-app.com.evil.com/', ignored), 'modista-app.com.evil.com');
});

test('toCleanPath strips query and hash and requires a site-relative path', () => {
  assert.equal(toCleanPath('/lp/curso?email=a@b.com#x'), '/lp/curso');
  assert.equal(toCleanPath('/'), '/');
  for (const value of ['lp/curso', 'https://evil.com/x', '//evil.com/x', '', '?x=1']) {
    assert.equal(toCleanPath(value), undefined, value);
  }
});

test('toCleanPath strips the query even when it contains line breaks and rejects control characters', () => {
  assert.equal(toCleanPath('/lp?email=a@b.com\nx'), '/lp');
  assert.equal(toCleanPath('/lp#a\rb'), '/lp');
  assert.equal(toCleanPath('/lp?x=1\u2028y'), '/lp');
  for (const value of ['/lp\nfoo?x=1', '/lp\u0000', '/l\tp']) {
    assert.equal(toCleanPath(value), undefined, JSON.stringify(value));
  }
});

test('toReferrerHost caps the host length', () => {
  const host = toReferrerHost(`https://${'a'.repeat(300)}.com/x`, []);
  assert.ok(host === undefined || host.length <= 253);
});

test('client clock window accepts recent and slightly future times, rejects the rest', () => {
  const now = new Date('2026-11-18T12:00:00.000Z');
  const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);
  assert.equal(isWithinClientClockWindow(at(0), now), true);
  assert.equal(isWithinClientClockWindow(at(-CLIENT_CLOCK_MAX_AGE_MS), now), true);
  assert.equal(isWithinClientClockWindow(at(-CLIENT_CLOCK_MAX_AGE_MS - 1), now), false);
  assert.equal(isWithinClientClockWindow(at(CLIENT_CLOCK_FUTURE_TOLERANCE_MS), now), true);
  assert.equal(isWithinClientClockWindow(at(CLIENT_CLOCK_FUTURE_TOLERANCE_MS + 1), now), false);
  assert.equal(isWithinClientClockWindow(new Date('invalid'), now), false);
});
