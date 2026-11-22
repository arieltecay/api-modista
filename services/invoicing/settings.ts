import type { InvoicingSettings } from './types.js';

const IVA_CONDITION = 'Responsable Monotributo';
const CUIT_PATTERN = /^\d{11}$/;

const disabled = (reason: string): InvoicingSettings => ({ enabled: false, reason });

const decodePem = (value: string | undefined): string | null => {
  if (!value) return null;
  const pem = Buffer.from(value, 'base64').toString('utf8');
  return pem.includes('-----BEGIN') ? pem : null;
};

/**
 * Reads the invoicing configuration from the environment and decides whether this deployment may issue.
 * Fails closed: anything unclear disables invoicing (payments and emails keep working).
 * - Real (production) invoices only from a Vercel production deployment with ARCA_PRODUCTION_ENABLED=true.
 * - Test (homologation) invoices never from a Vercel production deployment, unless ARCA_ALLOW_TEST_INVOICES=true
 *   (for a beta project that runs as "production" on Vercel).
 */
export const resolveInvoicingSettings = (env: NodeJS.ProcessEnv = process.env): InvoicingSettings => {
  const certificatePem = decodePem(env.ARCA_CERT_B64);
  const privateKeyPem = decodePem(env.ARCA_KEY_B64);
  if (!certificatePem || !privateKeyPem) return disabled('ARCA_CERT_B64 / ARCA_KEY_B64 no configurados');

  const environment = env.ARCA_ENV ?? 'homologation';
  if (environment !== 'homologation' && environment !== 'production') return disabled('ARCA_ENV inválido');

  const isVercelProduction = env.VERCEL_ENV === 'production';
  if (environment === 'production') {
    if (!isVercelProduction) return disabled('Facturación real solo en el deploy de producción de Vercel');
    if (env.ARCA_PRODUCTION_ENABLED !== 'true') return disabled('ARCA_PRODUCTION_ENABLED no es "true"');
  } else if (isVercelProduction && env.ARCA_ALLOW_TEST_INVOICES !== 'true') {
    return disabled('Homologación en un deploy de producción requiere ARCA_ALLOW_TEST_INVOICES=true');
  }

  const cuit = env.ARCA_CUIT ?? '';
  const pointOfSale = Number(env.ARCA_POINT_OF_SALE);
  if (!CUIT_PATTERN.test(cuit)) return disabled('ARCA_CUIT inválido');
  if (!Number.isInteger(pointOfSale) || pointOfSale < 1) return disabled('ARCA_POINT_OF_SALE inválido');
  if (!env.ARCA_EMITTER_NAME || !env.ARCA_EMITTER_ADDRESS) return disabled('Faltan ARCA_EMITTER_NAME / ARCA_EMITTER_ADDRESS');

  return {
    enabled: true,
    config: { cuit, pointOfSale, environment, certificatePem, privateKeyPem },
    emitter: { legalName: env.ARCA_EMITTER_NAME, cuit, address: env.ARCA_EMITTER_ADDRESS, ivaCondition: IVA_CONDITION },
  };
};
