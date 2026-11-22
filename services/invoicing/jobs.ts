import { logger } from '../logger.js';
import { resolveIssueDeps } from './index.js';
import { sendInvoiceEmail } from './notify.js';
import { retryInvoiceById, retryPendingInvoices, type RetrySummary } from './retry.js';

/** What the admin endpoints call; the controller only knows this shape. */
export const adminInvoicesServices = {
  retry: async (invoiceId: string) => {
    const resolved = resolveIssueDeps();
    if ('reason' in resolved) return { kind: 'disabled' as const, reason: resolved.reason };

    const result = await retryInvoiceById(invoiceId, { deps: resolved.deps });
    return result ? { kind: 'done' as const, result } : { kind: 'not_found' as const };
  },
  resend: (invoiceId: string) => sendInvoiceEmail(invoiceId),
};

/** Scheduled job: finishes the invoices left `pending` and emails them. Does nothing while invoicing is off. */
export const runInvoiceRetryJob = async (): Promise<RetrySummary | { skipped: string }> => {
  const resolved = resolveIssueDeps();
  if ('reason' in resolved) {
    logger.info(`[Invoicing] Reintento omitido: ${resolved.reason}`);
    return { skipped: resolved.reason };
  }
  return retryPendingInvoices({ deps: resolved.deps });
};
