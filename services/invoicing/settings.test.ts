import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestIdentity } from '../../utils/testing/arcaIdentity.js';
import { resolveInvoicingSettings } from './settings.js';

const identity = createTestIdentity();
const b64 = (value: string) => Buffer.from(value).toString('base64');

const baseEnv = (overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({
  ARCA_CERT_B64: b64(identity.certificatePem),
  ARCA_KEY_B64: b64(identity.privateKeyPem),
  ARCA_CUIT: '27346513670',
  ARCA_POINT_OF_SALE: '1',
  ARCA_EMITTER_NAME: 'GUEVARA MICAELA DENISE',
  ARCA_EMITTER_ADDRESS: 'San Miguel de Tucumán',
  ...overrides,
});

test('is enabled in homologation by default and decodes the PEM files', () => {
  const settings = resolveInvoicingSettings(baseEnv());

  assert.equal(settings.enabled, true);
  if (!settings.enabled) return;
  assert.equal(settings.config.environment, 'homologation');
  assert.equal(settings.config.pointOfSale, 1);
  assert.equal(settings.config.cuit, '27346513670');
  assert.equal(settings.config.certificatePem, identity.certificatePem);
  assert.equal(settings.config.privateKeyPem, identity.privateKeyPem);
  assert.deepEqual(settings.emitter, {
    legalName: 'GUEVARA MICAELA DENISE',
    cuit: '27346513670',
    address: 'San Miguel de Tucumán',
    ivaCondition: 'Responsable Monotributo',
  });
});

test('is disabled, not an error, when the certificate or key is missing', () => {
  const noCert = resolveInvoicingSettings(baseEnv({ ARCA_CERT_B64: undefined }));
  const noKey = resolveInvoicingSettings(baseEnv({ ARCA_KEY_B64: undefined }));

  assert.equal(noCert.enabled, false);
  assert.equal(noKey.enabled, false);
});

test('production needs ARCA_PRODUCTION_ENABLED to be exactly "true"', () => {
  const production = { ARCA_ENV: 'production', VERCEL_ENV: 'production' };

  for (const flag of [undefined, 'false', 'TRUE', '1', '']) {
    const settings = resolveInvoicingSettings(baseEnv({ ...production, ARCA_PRODUCTION_ENABLED: flag }));
    assert.equal(settings.enabled, false, `flag ${String(flag)}`);
  }
  const enabled = resolveInvoicingSettings(baseEnv({ ...production, ARCA_PRODUCTION_ENABLED: 'true' }));
  assert.equal(enabled.enabled, true);
  if (enabled.enabled) assert.equal(enabled.config.environment, 'production');
});

test('a Vercel production deployment never issues test invoices to real customers', () => {
  const settings = resolveInvoicingSettings(baseEnv({ ARCA_ENV: 'homologation', VERCEL_ENV: 'production' }));
  assert.equal(settings.enabled, false);
});

test('a beta project running as Vercel production can opt in to test invoices', () => {
  const settings = resolveInvoicingSettings(
    baseEnv({ ARCA_ENV: 'homologation', VERCEL_ENV: 'production', ARCA_ALLOW_TEST_INVOICES: 'true' })
  );
  assert.equal(settings.enabled, true);
});

test('a preview deployment never issues real invoices', () => {
  const settings = resolveInvoicingSettings(
    baseEnv({ ARCA_ENV: 'production', ARCA_PRODUCTION_ENABLED: 'true', VERCEL_ENV: 'preview' })
  );
  assert.equal(settings.enabled, false);
});

test('rejects an unknown environment, a bad point of sale or a malformed CUIT', () => {
  assert.equal(resolveInvoicingSettings(baseEnv({ ARCA_ENV: 'prod' })).enabled, false);
  assert.equal(resolveInvoicingSettings(baseEnv({ ARCA_POINT_OF_SALE: 'abc' })).enabled, false);
  assert.equal(resolveInvoicingSettings(baseEnv({ ARCA_POINT_OF_SALE: '0' })).enabled, false);
  assert.equal(resolveInvoicingSettings(baseEnv({ ARCA_CUIT: '123' })).enabled, false);
});

test('requires the emitter name and address to print on the invoice', () => {
  assert.equal(resolveInvoicingSettings(baseEnv({ ARCA_EMITTER_NAME: undefined })).enabled, false);
  assert.equal(resolveInvoicingSettings(baseEnv({ ARCA_EMITTER_ADDRESS: undefined })).enabled, false);
});

test('explains why it is disabled without leaking secrets', () => {
  const settings = resolveInvoicingSettings(baseEnv({ ARCA_ENV: 'production', VERCEL_ENV: 'production' }));

  assert.equal(settings.enabled, false);
  if (settings.enabled) return;
  assert.match(settings.reason, /ARCA_PRODUCTION_ENABLED/);
  assert.equal(settings.reason.includes('PRIVATE KEY'), false);
});
