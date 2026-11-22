import assert from 'node:assert/strict';
import test from 'node:test';
import { ArcaUnavailableError } from './errors.js';
import { createHttpsTransport } from './transport.js';

const transport = createHttpsTransport();

test('refuses hosts outside afip.gov.ar before opening any connection', async () => {
  await assert.rejects(transport({ url: 'https://evil.example.com/ws', soapAction: '', body: '<a/>' }), ArcaUnavailableError);
  await assert.rejects(transport({ url: 'https://afip.gov.ar.evil.com/ws', soapAction: '', body: '<a/>' }), ArcaUnavailableError);
});

test('refuses plain http even for an ARCA host', async () => {
  await assert.rejects(transport({ url: 'http://wsaahomo.afip.gov.ar/ws', soapAction: '', body: '<a/>' }), ArcaUnavailableError);
});
