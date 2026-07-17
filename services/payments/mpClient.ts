import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import { logger } from '../logger.js';

const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;

if (!accessToken) {
  logger.error('MERCADO_PAGO_ACCESS_TOKEN no está configurado. Las operaciones de MP fallarán.');
}

export const mpClient = new MercadoPagoConfig({
  accessToken: accessToken || '',
  options: { timeout: 10000 },
});

export const mpPreference = new Preference(mpClient);
export const mpPayment = new Payment(mpClient);

export const isMercadoPagoConfigured = (): boolean => Boolean(accessToken);
