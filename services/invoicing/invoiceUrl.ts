const DEFAULT_FRONTEND_URL = 'https://modista-app.com';

/** Public page of an invoice; the token is the only thing that grants access to it. */
export const buildInvoiceUrl = (publicToken: string): string =>
  `${(process.env.FRONTEND_URL ?? DEFAULT_FRONTEND_URL).replace(/\/+$/, '')}/factura/${publicToken}`;
