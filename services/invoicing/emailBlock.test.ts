import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceEmailBlock } from './emailBlock.js';

test('links to the invoice page', () => {
  const html = invoiceEmailBlock('https://modista-app.com/factura/abc123');

  assert.match(html, /href="https:\/\/modista-app\.com\/factura\/abc123"/);
  assert.match(html, /factura/i);
});

test('escapes the url so it cannot break out of the attribute', () => {
  const html = invoiceEmailBlock('https://x.test/"><script>alert(1)</script>');

  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('"><'), false);
});

test('keeps "$" sequences out of the template replacement', () => {
  assert.equal(invoiceEmailBlock('https://x.test/$&').includes('$&'), false);
});
