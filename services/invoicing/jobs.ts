import { logger } from '../logger.js';
import { issueCreditNote, resendCreditNote, retryCreditNote, retryPendingCreditNotes, type CreditNoteRetrySummary } from './creditNote.js';
import { resolveIssueDeps } from './index.js';
import { sendInvoiceEmail } from './notify.js';
import { retryInvoiceById, retryPendingInvoices, type RetrySummary } from './retry.js';
import type { CreditNoteInput, CreditNoteOutcome, IssueInvoiceDeps } from './types.js';

/** Time for the whole job; invoices go first but leave a slice for the credit notes. */
const JOB_BUDGET_MS = 25_000;
const INVOICES_BUDGET_MS = 18_000;

type Disabled = { kind: 'disabled'; reason: string };

const withDeps = async <T>(run: (deps: IssueInvoiceDeps) => Promise<T>): Promise<T | Disabled> => {
  const resolved = resolveIssueDeps();
  return 'reason' in resolved ? { kind: 'disabled', reason: resolved.reason } : run(resolved.deps);
};

/** What the admin endpoints call; the controller only knows this shape. */
export const adminInvoicesServices = {
  retry: (invoiceId: string) =>
    withDeps(async (deps) => {
      const result = await retryInvoiceById(invoiceId, { deps });
      return result ? { kind: 'done' as const, result } : { kind: 'not_found' as const };
    }),
  resend: (invoiceId: string) => sendInvoiceEmail(invoiceId),
  issueCreditNote: (input: CreditNoteInput) => withDeps<CreditNoteOutcome>((deps) => issueCreditNote(input, { deps })),
  retryCreditNote: (invoiceId: string) => withDeps<CreditNoteOutcome>((deps) => retryCreditNote(invoiceId, { deps })),
  resendCreditNote: (invoiceId: string) => resendCreditNote(invoiceId),
};

/** Scheduled job: finishes the invoices and credit notes left `pending` and emails them. Does nothing while invoicing is off. */
export const runInvoiceRetryJob = async (): Promise<(RetrySummary & { creditNotes: CreditNoteRetrySummary }) | { skipped: string }> => {
  const resolved = resolveIssueDeps();
  if ('reason' in resolved) {
    logger.info(`[Invoicing] Reintento omitido: ${resolved.reason}`);
    return { skipped: resolved.reason };
  }
  const startedAt = Date.now();
  const invoices = await retryPendingInvoices({ deps: resolved.deps, budgetMs: INVOICES_BUDGET_MS });
  const creditNotes = await retryPendingCreditNotes({ deps: resolved.deps, budgetMs: JOB_BUDGET_MS - (Date.now() - startedAt) });
  return { ...invoices, creditNotes };
};
