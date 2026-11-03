import assert from 'node:assert/strict';
import type { Request } from 'express';
import test from 'node:test';
import { getClientIpAddress, normalizeClientIpAddress } from './clientIpAddress.js';

type RequestIp = Pick<Request, 'ip' | 'socket'>;

const makeRequest = (ip: string | undefined, remoteAddress: string | undefined): RequestIp => ({
  ip,
  socket: { remoteAddress } as RequestIp['socket'],
});

test('prefers the client IP resolved by Express over the proxy socket', () => {
  assert.equal(getClientIpAddress(makeRequest('203.0.113.10', '10.0.0.1')), '203.0.113.10');
});

test('keeps valid IPv6 addresses', () => {
  assert.equal(getClientIpAddress(makeRequest('2001:db8::10', '10.0.0.1')), '2001:db8::10');
});

test('normalizes IPv4-mapped IPv6 addresses', () => {
  assert.equal(getClientIpAddress(makeRequest('::ffff:203.0.113.10', undefined)), '203.0.113.10');
});

test('uses the socket address when Express has no valid client IP', () => {
  assert.equal(getClientIpAddress(makeRequest('not-an-ip', '198.51.100.7')), '198.51.100.7');
});

test('omits invalid addresses instead of returning an empty value', () => {
  assert.equal(getClientIpAddress(makeRequest('not-an-ip', 'also-not-an-ip')), undefined);
});

test('normalizes legacy forwarded IP chains to the first client address', () => {
  assert.equal(normalizeClientIpAddress('203.0.113.10, 10.0.0.1'), '203.0.113.10');
});

test('omits an invalid first value from a legacy forwarded chain', () => {
  assert.equal(normalizeClientIpAddress('unknown, 10.0.0.1'), undefined);
});
