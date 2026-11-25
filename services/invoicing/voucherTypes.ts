import type { VoucherKind } from './types.js';

/** ARCA voucher type codes: Factura C and Nota de Crédito C. */
export const VOUCHER_CODES: Record<VoucherKind, number> = { invoice: 11, credit_note: 13 };
